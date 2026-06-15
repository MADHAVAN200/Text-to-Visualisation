/**
 * queries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * NLQ (Natural Language Query) routes.
 * Pipeline:
 *   1. Use Groq LLM (via ai-engine.js) to generate SQL from natural language
 *   2. Validate SQL for safety
 *   3. Execute SQL against the connected database (SQLite native / PostgreSQL / MySQL)
 *   4. Use Groq LLM to generate rich narrative insights
 *   5. Use Groq LLM to recommend the best chart type
 *   6. Save to query_history, visualizations, ai_insights tables
 *   7. Return full result to frontend
 *
 * If Groq API is unavailable, all steps fall back gracefully to rule-based logic.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const sqlite3  = require('sqlite3').verbose();

const aiEngine = require('./ai-engine');

const PROJECT_ROOT  = path.resolve(__dirname, '../../');
const META_DB_PATH  = path.resolve(PROJECT_ROOT, 'ai-engine/metadata.db');

// ── DB helpers ────────────────────────────────────────────────────────────────

function getDbConnectionParams(dbId, metaDb) {
  return new Promise((resolve, reject) => {
    metaDb.get(
      `SELECT db_type, database_name, host, port, username, connection_string
       FROM connected_databases WHERE id = ?`,
      [dbId],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error(`Database ID ${dbId} not found in metadata.`));
        resolve(row);
      }
    );
  });
}

function executeSqliteQuery(dbFilePath, sqlQuery) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbFilePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`Cannot open database: ${err.message}`));
      db.run('PRAGMA busy_timeout=3000;');
    });
    const startTime = Date.now();
    db.all(sqlQuery, [], (err, rows) => {
      db.close();
      const executionTime = parseFloat(((Date.now() - startTime) / 1000).toFixed(4));
      if (err) return reject(new Error(err.message));
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      resolve({ rows, columns, executionTime });
    });
  });
}

async function executeQuery(dbId, sqlQuery, metaDb) {
  const params = await getDbConnectionParams(dbId, metaDb);
  const dbType = params.db_type.toLowerCase();

  if (dbType === 'sqlite') {
    const dbFilePath = path.resolve(PROJECT_ROOT, params.database_name);
    return executeSqliteQuery(dbFilePath, sqlQuery);
  }

  // PostgreSQL / MySQL support (requires Python engine or future native driver)
  throw new Error(`Direct execution for ${params.db_type} databases requires the Python AI Engine. Please start it or use SQLite.`);
}

// ── User ID from JWT ──────────────────────────────────────────────────────────

function extractUserId(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return 1;
  try {
    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'voice2viz_jwt_secret_key_12345';
    const decoded = jwt.verify(token, secret);
    return decoded.id || 1;
  } catch {
    return 1;
  }
}

// ── Save results to metadata DB ───────────────────────────────────────────────

function saveQueryAndVisualization(metaDb, { userId, dbId, question, sql, executionTime, chart, insights, createdAt }) {
  return new Promise((resolve) => {
    metaDb.run(
      `INSERT INTO query_history (user_id, database_id, question, generated_sql, execution_time, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'success', ?)`,
      [userId, dbId, question, sql, executionTime, createdAt],
      function (histErr) {
        const queryId = this?.lastID || null;
        if (histErr || !queryId) {
          console.warn('[DB] Failed to save query history:', histErr?.message);
          return resolve({ queryId: null, vizId: null });
        }

        // Save insights
        insights.forEach(insight => {
          metaDb.run(
            `INSERT INTO ai_insights (query_id, insight, created_at) VALUES (?, ?, ?)`,
            [queryId, insight, createdAt]
          );
        });

        // Save visualization
        metaDb.run(
          `INSERT INTO visualizations (query_id, chart_type, chart_config, created_at) VALUES (?, ?, ?, ?)`,
          [queryId, chart.chart_type || 'table', JSON.stringify(chart), createdAt],
          function (vizErr) {
            const vizId = this?.lastID || null;
            if (vizErr) console.warn('[DB] Failed to save visualization:', vizErr.message);
            resolve({ queryId, vizId });
          }
        );
      }
    );
  });
}

// ── POST /queries/ask ─────────────────────────────────────────────────────────

router.post('/ask', async (req, res) => {
  const { question, database_id, api_key, sql_query } = req.body;
  const metaDb  = req.app.get('db');
  const userId  = extractUserId(req);
  const createdAt = new Date().toISOString();

  // Resolve API key: frontend-supplied key > .env GROQ_API_KEY
  const resolvedApiKey = (api_key && api_key.trim() && !api_key.startsWith('YOUR_'))
    ? api_key.trim()
    : process.env.GROQ_API_KEY;

  if (!question && !sql_query) {
    return res.status(400).json({ error: 'A question or sql_query is required.' });
  }
  if (!database_id) {
    return res.status(400).json({ error: 'database_id is required.' });
  }

  try {
    // ── Step 1: Generate SQL ──────────────────────────────────────────────────
    let finalSql;
    let sqlSource;

    if (sql_query) {
      // Direct SQL provided (from dashboard reload or "Execute SQL Override")
      finalSql  = sql_query;
      sqlSource = 'direct';
    } else {
      const { sql, source } = await aiEngine.generateSql(
        question, database_id, metaDb, resolvedApiKey
      );
      finalSql  = sql;
      sqlSource = source;
    }

    // ── Step 2: Validate SQL ──────────────────────────────────────────────────
    const { valid, error: validationError } = aiEngine.validateSql(finalSql);
    if (!valid) {
      metaDb.run(
        `INSERT INTO query_history (user_id, database_id, question, generated_sql, execution_time, status, error_message, created_at)
         VALUES (?, ?, ?, ?, 0, 'failed', ?, ?)`,
        [userId, database_id, question || 'Direct SQL', finalSql || '', `Security block: ${validationError}`, createdAt]
      );
      return res.status(400).json({ error: `SQL validation failed: ${validationError}`, sql: finalSql });
    }

    // ── Cache Layer: Check if results already exist ──────────────────────────
    const crypto = require('crypto');
    const queryHash = crypto.createHash('md5').update(`${database_id}_${finalSql}`).digest('hex');

    const cachedResponse = await new Promise((resolve) => {
      metaDb.get(
        `SELECT result_json, created_at FROM query_results_cache WHERE query_hash = ?`,
        [queryHash],
        (err, row) => {
          if (err || !row) return resolve(null);

          // Cache TTL: 5 minutes (300,000 ms)
          const cacheAge = Date.now() - new Date(row.created_at).getTime();
          if (cacheAge > 300000) {
            metaDb.run(`DELETE FROM query_results_cache WHERE query_hash = ?`, [queryHash]);
            return resolve(null);
          }

          try {
            resolve(JSON.parse(row.result_json));
          } catch (_) {
            resolve(null);
          }
        }
      );
    });

    if (cachedResponse) {
      console.log(`[Cache Hit] Returning cached response for hash ${queryHash}`);
      
      if (question === '__dashboard_reload__') {
        return res.json({
          query_id: null,
          visualization_id: null,
          sql: finalSql,
          sql_source: sqlSource,
          ai_powered: false,
          results: cachedResponse.results,
          chart: {},
          insights: []
        });
      }

      return res.json({
        query_id: cachedResponse.query_id || null,
        visualization_id: cachedResponse.visualization_id || null,
        sql: finalSql,
        sql_source: sqlSource,
        ai_powered: cachedResponse.ai_powered || false,
        results: cachedResponse.results,
        chart: cachedResponse.chart || {},
        insights: cachedResponse.insights || [],
        cached: true
      });
    }

    // ── Step 3: Execute Query ─────────────────────────────────────────────────
    const { rows, columns, executionTime } = await executeQuery(database_id, finalSql, metaDb);

    // ── Step 4: Handle Dashboard Reload Bypass ───────────────────────────────
    if (question === '__dashboard_reload__') {
      const responseToCache = {
        results: {
          success: true,
          columns,
          rows,
          row_count: rows.length,
          execution_time: executionTime
        },
        chart: {},
        insights: []
      };

      // Save to cache database
      metaDb.run(
        `INSERT OR REPLACE INTO query_results_cache (query_hash, result_json, created_at) VALUES (?, ?, ?)`,
        [queryHash, JSON.stringify(responseToCache), new Date().toISOString()]
      );

      return res.json({
        query_id: null,
        visualization_id: null,
        sql: finalSql,
        sql_source: sqlSource,
        ai_powered: false,
        results: responseToCache.results,
        chart: {},
        insights: []
      });
    }

    // ── Step 5: Generate Insights (LLM) ──────────────────────────────────────
    const insights = await aiEngine.generateInsights(
      question || 'Data query', columns, rows, resolvedApiKey
    );

    // ── Step 6: Recommend Chart (LLM) ────────────────────────────────────────
    const chart = await aiEngine.recommendChart(
      question || 'Data query', columns, rows, resolvedApiKey
    );

    // ── Step 7: Persist to DB ─────────────────────────────────────────────────
    const { queryId, vizId } = await saveQueryAndVisualization(metaDb, {
      userId, dbId: database_id,
      question: question || 'Direct SQL',
      sql: finalSql,
      executionTime, chart, insights, createdAt
    });

    // Save full response in cache
    const responseToCache = {
      query_id: queryId,
      visualization_id: vizId,
      ai_powered: sqlSource === 'llm' || sqlSource === 'llm-fallback',
      results: {
        success: true,
        columns,
        rows,
        row_count: rows.length,
        execution_time: executionTime
      },
      chart,
      insights
    };

    metaDb.run(
      `INSERT OR REPLACE INTO query_results_cache (query_hash, result_json, created_at) VALUES (?, ?, ?)`,
      [queryHash, JSON.stringify(responseToCache), new Date().toISOString()]
    );

    // ── Step 8: Respond ───────────────────────────────────────────────────────
    return res.json({
      query_id: queryId,
      visualization_id: vizId,
      sql: finalSql,
      sql_source: sqlSource,
      ai_powered: sqlSource === 'llm' || sqlSource === 'llm-fallback',
      results: responseToCache.results,
      chart,
      insights,
    });

  } catch (err) {
    console.error('[Query] Pipeline error:', err.message);

    // Try to log the failure
    try {
      metaDb.run(
        `INSERT INTO query_history (user_id, database_id, question, generated_sql, execution_time, status, error_message, created_at)
         VALUES (?, ?, ?, ?, 0, 'failed', ?, ?)`,
        [userId, database_id, question || 'Unknown', sql_query || '', err.message, createdAt]
      );
    } catch (_) {}

    return res.status(500).json({ error: err.message });
  }
});

// ── GET /queries/history ──────────────────────────────────────────────────────

router.get('/history', (req, res) => {
  const db = req.app.get('db');
  db.all(
    `SELECT q.id, q.question, q.generated_sql, q.execution_time, q.status, q.created_at,
            d.name AS database_name
     FROM query_history q
     LEFT JOIN connected_databases d ON q.database_id = d.id
     ORDER BY q.created_at DESC LIMIT 50`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// ── GET /queries/history/:id ──────────────────────────────────────────────────

router.get('/history/:id', async (req, res) => {
  const queryId = req.params.id;
  const metaDb  = req.app.get('db');

  metaDb.get(`SELECT * FROM query_history WHERE id = ?`, [queryId], (err, queryInfo) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!queryInfo) return res.status(404).json({ error: 'Query record not found.' });

    metaDb.get(`SELECT * FROM visualizations WHERE query_id = ?`, [queryId], (vizErr, viz) => {
      if (vizErr) return res.status(500).json({ error: vizErr.message });

      metaDb.all(`SELECT insight FROM ai_insights WHERE query_id = ?`, [queryId], async (insErr, insightRows) => {
        if (insErr) return res.status(500).json({ error: insErr.message });

        const insights   = insightRows.map(r => r.insight);
        const chartConfig = viz ? JSON.parse(viz.chart_config) : null;

        if (queryInfo.status !== 'success') {
          return res.json({
            query_id: queryInfo.id, question: queryInfo.question,
            sql: queryInfo.generated_sql, results: null,
            chart: null, insights: [], error: queryInfo.error_message
          });
        }

        try {
          const { rows, columns, executionTime } = await executeQuery(
            queryInfo.database_id, queryInfo.generated_sql, metaDb
          );
          res.json({
            query_id: queryInfo.id,
            question: queryInfo.question,
            sql: queryInfo.generated_sql,
            results: { success: true, columns, rows, row_count: rows.length, execution_time: executionTime },
            chart: chartConfig,
            insights,
          });
        } catch (execErr) {
          res.json({
            query_id: queryInfo.id, question: queryInfo.question,
            sql: queryInfo.generated_sql,
            results: { success: false, columns: [], rows: [], row_count: 0, error: execErr.message },
            chart: chartConfig, insights
          });
        }
      });
    });
  });
});

router.executeQuery = executeQuery;
router.saveQueryAndVisualization = saveQueryAndVisualization;

module.exports = router;
