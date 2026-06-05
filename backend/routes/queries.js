const express = require('express');
const router = express.Router();
const axios = require('axios');

const PYTHON_ENGINE_URL = process.env.PYTHON_ENGINE_URL || 'http://127.0.0.1:5000';

// Trigger Natural Language Query Lifecycle
router.post('/ask', async (req, res) => {
  const { question, database_id, api_key } = req.body;
  const db = req.app.get('db');
  
  // Try to read user from JWT header (if available, otherwise set default user_id = 1)
  let user_id = 1;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    try {
      const token = authHeader.split(' ')[1];
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'voice2viz_jwt_secret_key_12345';
      const decoded = jwt.verify(token, secret);
      user_id = decoded.id;
    } catch (e) {
      // ignore token error, fallback to default user
    }
  }

  if (!question || !database_id) {
    return res.status(400).json({ error: 'Question and database ID are required.' });
  }

  try {
    // Phase 1: Generate SQL Query
    const genSqlResponse = await axios.post(`${PYTHON_ENGINE_URL}/generate-sql`, {
      question,
      database_id,
      api_key
    });

    const { sql, is_valid, validation_error } = genSqlResponse.data;

    if (!is_valid) {
      // Log failed query
      const createdAt = new Date().toISOString();
      db.run(
        `INSERT INTO query_history (user_id, database_id, question, generated_sql, execution_time, status, error_message, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_id, database_id, question, sql || '', 0, 'failed', `Security Validation Error: ${validation_error}`, createdAt]
      );
      return res.status(400).json({ error: `SQL security block: ${validation_error}`, sql });
    }

    // Phase 2: Execute SQL and get results + recommended chart configuration
    const executeResponse = await axios.post(`${PYTHON_ENGINE_URL}/execute-query`, {
      database_id,
      sql_query: sql,
      question
    });

    const queryResults = executeResponse.data;
    
    if (!queryResults.success) {
      // Log failed query
      const createdAt = new Date().toISOString();
      db.run(
        `INSERT INTO query_history (user_id, database_id, question, generated_sql, execution_time, status, error_message, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_id, database_id, question, sql, queryResults.execution_time || 0, 'failed', queryResults.error, createdAt]
      );
      return res.status(400).json({ error: queryResults.error, sql });
    }

    // Phase 3: Generate Insights on query results
    let insights = [];
    try {
      const insightsResponse = await axios.post(`${PYTHON_ENGINE_URL}/generate-insights`, {
        query_results: queryResults,
        api_key
      });
      insights = insightsResponse.data.insights || [];
    } catch (insightErr) {
      console.error('Insight generation failed:', insightErr.message);
      // fallback to basic list
      insights = ["Data query executed successfully."];
    }

    // Save query execution to history
    const createdAt = new Date().toISOString();
    db.run(
      `INSERT INTO query_history (user_id, database_id, question, generated_sql, execution_time, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user_id, database_id, question, sql, queryResults.execution_time, 'success', createdAt],
      function (historyErr) {
        if (historyErr) {
          console.error('Failed to log query history:', historyErr.message);
          return res.json({
            sql,
            results: queryResults,
            chart: queryResults.chart_recommendation,
            insights
          });
        }

        const queryId = this.lastID;

        // Save insights to metadata database
        insights.forEach(insight => {
          db.run(`INSERT INTO ai_insights (query_id, insight, created_at) VALUES (?, ?, ?)`, [queryId, insight, createdAt]);
        });

        // Save visualization settings to metadata database
        const chartRec = queryResults.chart_recommendation || {};
        db.run(
          `INSERT INTO visualizations (query_id, chart_type, chart_config, created_at) VALUES (?, ?, ?, ?)`,
          [queryId, chartRec.chart_type || 'table', JSON.stringify(chartRec), createdAt],
          function (vizErr) {
            res.json({
              query_id: queryId,
              visualization_id: this ? this.lastID : null,
              sql,
              results: {
                columns: queryResults.columns,
                rows: queryResults.rows,
                row_count: queryResults.row_count,
                execution_time: queryResults.execution_time
              },
              chart: chartRec,
              insights
            });
          }
        );
      }
    );

  } catch (apiError) {
    console.error('AI Engine query cycle failed:', apiError.response?.data || apiError.message);
    res.status(500).json({ error: `Connection to Python AI Engine failed: ${apiError.message}` });
  }
});

// Get Query History list
router.get('/history', (req, res) => {
  const db = req.app.get('db');
  db.all(
    `SELECT q.id, q.question, q.generated_sql, q.execution_time, q.status, q.created_at, d.name as database_name
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

// Fetch detailed results and config for a past query (re-running or from cache)
router.get('/history/:id', (req, res) => {
  const queryId = req.params.id;
  const db = req.app.get('db');

  db.get(`SELECT * FROM query_history WHERE id = ?`, [queryId], (err, queryInfo) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!queryInfo) return res.status(404).json({ error: 'Query record not found.' });

    // Fetch visualization
    db.get(`SELECT * FROM visualizations WHERE query_id = ?`, [queryId], (vizErr, viz) => {
      if (vizErr) return res.status(500).json({ error: vizErr.message });

      // Fetch insights
      db.all(`SELECT insight FROM ai_insights WHERE query_id = ?`, [queryId], async (insightsErr, insightRows) => {
        if (insightsErr) return res.status(500).json({ error: insightsErr.message });

        const insights = insightRows.map(r => r.insight);
        const chartConfig = viz ? JSON.parse(viz.chart_config) : null;

        // If it was a success, let's re-execute the SQL to get the latest rows for rendering
        if (queryInfo.status === 'success') {
          try {
            const executeResponse = await axios.post(`${PYTHON_ENGINE_URL}/execute-query`, {
              database_id: queryInfo.database_id,
              sql_query: queryInfo.generated_sql,
              question: queryInfo.question
            });

            const results = executeResponse.data;
            res.json({
              query_id: queryInfo.id,
              question: queryInfo.question,
              sql: queryInfo.generated_sql,
              results: {
                columns: results.columns,
                rows: results.rows,
                row_count: results.row_count,
                execution_time: results.execution_time
              },
              chart: chartConfig || results.chart_recommendation,
              insights
            });
          } catch (execErr) {
            // If execution fails now (e.g. database unlinked), return empty results but keep details
            res.json({
              query_id: queryInfo.id,
              question: queryInfo.question,
              sql: queryInfo.generated_sql,
              results: { columns: [], rows: [], row_count: 0, execution_time: 0, error: 'Database execution failed: ' + execErr.message },
              chart: chartConfig,
              insights
            });
          }
        } else {
          res.json({
            query_id: queryInfo.id,
            question: queryInfo.question,
            sql: queryInfo.generated_sql,
            results: null,
            chart: null,
            insights: [],
            error: queryInfo.error_message
          });
        }
      });
    });
  });
});

module.exports = router;
