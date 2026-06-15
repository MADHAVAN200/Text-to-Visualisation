const express = require('express');
const router = express.Router();
const path = require('path');
const queriesRouter = require('./queries');
const aiEngine = require('./ai-engine');

// List all dashboards
router.get('/', (req, res) => {
  const db = req.app.get('db');
  db.all(`SELECT id, name, description, created_at FROM dashboards ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Create a new dashboard
router.post('/', (req, res) => {
  const { name, description } = req.body;
  const db = req.app.get('db');
  
  if (!name) return res.status(400).json({ error: 'Dashboard name is required.' });

  const createdAt = new Date().toISOString();
  // Default user_id = 1 for ease of use
  const userId = 1;

  db.run(
    `INSERT INTO dashboards (user_id, name, description, created_at) VALUES (?, ?, ?, ?)`,
    [userId, name, description || '', createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, name, description, created_at: createdAt });
    }
  );
});

// Get detailed dashboard with all its widgets, visualizations, and their queries
router.get('/:id', (req, res) => {
  const dashboardId = req.params.id;
  const db = req.app.get('db');

  db.get(`SELECT * FROM dashboards WHERE id = ?`, [dashboardId], (err, dashboard) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!dashboard) return res.status(404).json({ error: 'Dashboard not found.' });

    // Fetch widgets joined with visualization, query details
    db.all(
      `SELECT w.id as widget_id, w.position_x, w.position_y, w.width, w.height, 
              v.id as visualization_id, v.chart_type, v.chart_config,
              q.id as query_id, q.question, q.generated_sql, q.database_id
       FROM dashboard_widgets w
       JOIN visualizations v ON w.visualization_id = v.id
       JOIN query_history q ON v.query_id = q.id
       WHERE w.dashboard_id = ?`,
      [dashboardId],
      (widgetErr, widgets) => {
        if (widgetErr) return res.status(500).json({ error: widgetErr.message });
        
        // Parse JSON configs
        const formattedWidgets = widgets.map(w => ({
          id: w.widget_id,
          position_x: w.position_x,
          position_y: w.position_y,
          width: w.width,
          height: w.height,
          visualization: {
            id: w.visualization_id,
            chart_type: w.chart_type,
            chart_config: JSON.parse(w.chart_config)
          },
          query: {
            id: w.query_id,
            question: w.question,
            generated_sql: w.generated_sql,
            database_id: w.database_id
          }
        }));

        res.json({
          ...dashboard,
          widgets: formattedWidgets
        });
      }
    );
  });
});

// Delete a dashboard and its widgets
router.delete('/:id', (req, res) => {
  const dashboardId = req.params.id;
  const db = req.app.get('db');

  db.serialize(() => {
    db.run(`DELETE FROM dashboard_widgets WHERE dashboard_id = ?`, [dashboardId]);
    db.run(`DELETE FROM dashboards WHERE id = ?`, [dashboardId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Dashboard deleted.' });
    });
  });
});

// Add a widget (visualization) to a dashboard
router.post('/:id/widgets', (req, res) => {
  const dashboardId = req.params.id;
  const { visualization_id, position_x, position_y, width, height } = req.body;
  const db = req.app.get('db');

  if (!visualization_id) {
    return res.status(400).json({ error: 'Visualization ID is required.' });
  }

  db.run(
    `INSERT INTO dashboard_widgets (dashboard_id, visualization_id, position_x, position_y, width, height)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      dashboardId,
      visualization_id,
      position_x || 0,
      position_y || 0,
      width || 4,
      height || 3
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        id: this.lastID,
        dashboard_id: parseInt(dashboardId),
        visualization_id,
        position_x: position_x || 0,
        position_y: position_y || 0,
        width: width || 4,
        height: height || 3
      });
    }
  );
});

// Rearrange and resize widgets (update coordinates for all widgets)
router.put('/:id/widgets/layout', (req, res) => {
  const dashboardId = req.params.id;
  const { layout } = req.body; // Array: [{ widget_id: int, position_x: int, position_y: int, width: int, height: int }]
  const db = req.app.get('db');

  if (!layout || !Array.isArray(layout)) {
    return res.status(400).json({ error: 'Layout array is required.' });
  }

  db.serialize(() => {
    let hasError = false;
    const stmt = db.prepare(
      `UPDATE dashboard_widgets 
       SET position_x = ?, position_y = ?, width = ?, height = ? 
       WHERE id = ? AND dashboard_id = ?`
    );

    for (const item of layout) {
      stmt.run(
        [item.position_x, item.position_y, item.width, item.height, item.widget_id, dashboardId],
        (err) => {
          if (err) {
            console.error('Failed to update widget layout:', err.message);
            hasError = true;
          }
        }
      );
    }

    stmt.finalize((err) => {
      if (err || hasError) {
        return res.status(500).json({ error: 'Failed to update some layout coordinates.' });
      }
      res.json({ success: true, message: 'Dashboard layout updated successfully.' });
    });
  });
});

// Delete a widget from dashboard
router.delete('/widgets/:id', (req, res) => {
  const widgetId = req.params.id;
  const db = req.app.get('db');

  db.run(`DELETE FROM dashboard_widgets WHERE id = ?`, [widgetId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Widget removed from dashboard.' });
  });
});

// POST /recommend - AI dashboard recommendation and schema-based auto-generation
router.post('/recommend', async (req, res) => {
  const { database_id, api_key } = req.body;
  const db = req.app.get('db');
  const userId = 1; // Default guest user
  const createdAt = new Date().toISOString();

  if (!database_id) {
    return res.status(400).json({ error: 'database_id is required for dashboard recommendation.' });
  }

  // Resolve API key
  const resolvedApiKey = (api_key && api_key.trim() && !api_key.startsWith('YOUR_'))
    ? api_key.trim()
    : process.env.GROQ_API_KEY;

  try {
    // 1. Get database details
    const database = await new Promise((resolve, reject) => {
      db.get(`SELECT name FROM connected_databases WHERE id = ?`, [database_id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!database) {
      return res.status(404).json({ error: 'Database not found.' });
    }

    // 2. Fetch successful queries with visualizations
    let successQueries = await new Promise((resolve, reject) => {
      db.all(
        `SELECT v.id as visualization_id, q.question, v.chart_type
         FROM visualizations v
         JOIN query_history q ON v.query_id = q.id
         WHERE q.database_id = ? AND q.status = 'success'
         ORDER BY q.created_at DESC`,
        [database_id],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    let autoGenerated = false;

    // 3. If fewer than 3 visual queries exist, trigger schema auto-generation
    if (successQueries.length < 3) {
      const schemaText = await aiEngine.getSchemaText(database_id, db);
      let recommendedQuestions = [];

      // Try LLM question recommendation if schema exists and we have Groq initialized
      const groq = aiEngine.getGroqClient(resolvedApiKey);
      if (groq && schemaText) {
        try {
          const prompt = `You are a business intelligence assistant analyzing a database schema.
Here is the Database Schema:
${schemaText}

Please recommend exactly 4 highly relevant, analytical business questions that a user would want to visualize on a dashboard.
Provide the questions in a clean list, one per line. Do not add numbers, introductions, bullet characters (* or -), or descriptions. Just the raw question text.
Ensure they are readable questions.

Example output:
Total revenue by product category
Monthly orders trend over time
Top 10 highest-value customers
Inventory stock levels by warehouse`;

          const response = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 512,
          });

          const rawQuestions = response.choices[0]?.message?.content?.trim() || '';
          const parsedQuestions = rawQuestions
            .split('\n')
            .map(q => q.trim().replace(/^[-*\d.\s]+/, ''))
            .filter(q => q.length > 5);

          if (parsedQuestions.length >= 2) {
            recommendedQuestions = parsedQuestions.slice(0, 4);
          }
        } catch (err) {
          console.warn('[AI Recommendation] Failed to generate custom questions, using templates:', err.message);
        }
      }

      // Templates fallback for default sandbox sales DB if LLM fails or is offline
      if (recommendedQuestions.length === 0) {
        recommendedQuestions = [
          "What are the total sales by category?",
          "Show the monthly sales trend.",
          "Top 5 products by revenue.",
          "Count of customers by segment."
        ];
      }

      const generatedVisualizations = [];
      for (const question of recommendedQuestions) {
        try {
          const { sql, source } = await aiEngine.generateSql(question, database_id, db, resolvedApiKey);
          const { valid, error: valErr } = aiEngine.validateSql(sql);
          if (!valid) continue;

          const { rows, columns, executionTime } = await queriesRouter.executeQuery(database_id, sql, db);
          if (!rows || rows.length === 0) continue;

          const chart = await aiEngine.recommendChart(question, columns, rows, resolvedApiKey);
          const insights = await aiEngine.generateInsights(question, columns, rows, resolvedApiKey);

          const { vizId } = await queriesRouter.saveQueryAndVisualization(db, {
            userId,
            dbId: database_id,
            question,
            sql,
            executionTime,
            chart,
            insights,
            createdAt
          });

          if (vizId) {
            generatedVisualizations.push({
              visualization_id: vizId,
              question,
              chart_type: chart.chart_type
            });
          }
        } catch (pipeErr) {
          console.warn(`[AI Recommendation] Pipeline failed for: "${question}" - ${pipeErr.message}`);
        }
      }

      successQueries = [...generatedVisualizations, ...successQueries];
      autoGenerated = true;
    }

    if (successQueries.length === 0) {
      return res.status(400).json({ error: 'Could not auto-generate any charts because database tables might be empty.' });
    }

    // 4. Create the recommended dashboard
    const dashboardName = autoGenerated 
      ? `AI Auto-Generated Dashboard`
      : `AI Recommended Dashboard (${database.name})`;
    const dashboardDesc = autoGenerated
      ? `Automatically generated dashboard compiling insights from tables in ${database.name}.`
      : `AI compiled dashboard recommended from your recent query history on ${database.name}.`;

    const dashboardId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO dashboards (user_id, name, description, created_at) VALUES (?, ?, ?, ?)`,
        [userId, dashboardName, dashboardDesc, createdAt],
        function (err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });

    // 5. Add unique widgets (limit to 6 widgets)
    const uniqueVizs = [];
    const questionsSeen = new Set();
    
    for (const q of successQueries) {
      if (!questionsSeen.has(q.question) && uniqueVizs.length < 6) {
        questionsSeen.add(q.question);
        uniqueVizs.push(q);
      }
    }

    const insertWidget = (vizId, x, y, w, h) => {
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO dashboard_widgets (dashboard_id, visualization_id, position_x, position_y, width, height)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [dashboardId, vizId, x, y, w, h],
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    };

    for (let i = 0; i < uniqueVizs.length; i++) {
      const viz = uniqueVizs[i];
      const x = (i % 2) * 6;
      const y = Math.floor(i / 2) * 4;
      const w = 6;
      const h = 4;
      await insertWidget(viz.visualization_id, x, y, w, h);
    }

    res.json({
      success: true,
      dashboard_id: dashboardId,
      name: dashboardName,
      widget_count: uniqueVizs.length,
      auto_generated: autoGenerated
    });

  } catch (err) {
    console.error('[AI Recommendation] Auto-dashboard generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /widgets/:id - Update widget visual configurations or title
router.put('/widgets/:id', (req, res) => {
  const widgetId = req.params.id;
  const { chart_type, chart_config, question } = req.body;
  const db = req.app.get('db');

  db.serialize(() => {
    // 1. Get the visualization_id and query_id for this widget
    db.get(
      `SELECT w.visualization_id, v.query_id FROM dashboard_widgets w
       JOIN visualizations v ON w.visualization_id = v.id
       WHERE w.id = ?`,
      [widgetId],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Widget not found.' });

        const { visualization_id, query_id } = row;

        const updateViz = () => {
          if (chart_type || chart_config) {
            const updates = [];
            const params = [];
            if (chart_type) {
              updates.push('chart_type = ?');
              params.push(chart_type);
            }
            if (chart_config) {
              updates.push('chart_config = ?');
              params.push(JSON.stringify(chart_config));
            }
            params.push(visualization_id);

            db.run(
              `UPDATE visualizations SET ${updates.join(', ')} WHERE id = ?`,
              params,
              (vErr) => {
                if (vErr) return res.status(500).json({ error: vErr.message });
                res.json({ success: true, message: 'Widget customized successfully.' });
              }
            );
          } else {
            res.json({ success: true, message: 'Widget title updated successfully.' });
          }
        };

        // 2. Update query title (question) if provided
        if (question) {
          db.run(
            `UPDATE query_history SET question = ? WHERE id = ?`,
            [question, query_id],
            (qErr) => {
              if (qErr) return res.status(500).json({ error: qErr.message });
              updateViz();
            }
          );
        } else {
          updateViz();
        }
      }
    );
  });
});

// POST /:id/widgets/import-query - Import query history as a widget
router.post('/:id/widgets/import-query', (req, res) => {
  const dashboardId = req.params.id;
  const { query_id, chart_type } = req.body;
  const db = req.app.get('db');
  const createdAt = new Date().toISOString();

  if (!query_id) {
    return res.status(400).json({ error: 'query_id is required for importing.' });
  }

  db.serialize(() => {
    // 1. Check if the query exists
    db.get(
      `SELECT database_id, question, generated_sql FROM query_history WHERE id = ?`,
      [query_id],
      (qErr, queryRow) => {
        if (qErr) return res.status(500).json({ error: qErr.message });
        if (!queryRow) return res.status(404).json({ error: 'Query not found in history.' });

        // 2. Check if a visualization already exists for this query
        db.get(
          `SELECT id, chart_type, chart_config FROM visualizations WHERE query_id = ?`,
          [query_id],
          (vErr, vizRow) => {
            if (vErr) return res.status(500).json({ error: vErr.message });

            const addWidgetToDashboard = (vizId) => {
              db.run(
                `INSERT INTO dashboard_widgets (dashboard_id, visualization_id, position_x, position_y, width, height)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [dashboardId, vizId, 0, 0, 6, 4],
                function (wErr) {
                  if (wErr) return res.status(500).json({ error: wErr.message });
                  res.status(201).json({
                    success: true,
                    widget_id: this.lastID,
                    visualization_id: vizId
                  });
                }
              );
            };

            if (vizRow) {
              // Visualization exists, just use it
              addWidgetToDashboard(vizRow.id);
            } else {
              // Create default visualization
              const type = chart_type || 'bar';
              const config = {
                chart_type: type,
                x_axis: '', // Will fall back or be custom mapped
                y_axis: [],
                colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
              };

              db.run(
                `INSERT INTO visualizations (query_id, chart_type, chart_config, created_at)
                 VALUES (?, ?, ?, ?)`,
                [query_id, type, JSON.stringify(config), createdAt],
                function (insErr) {
                  if (insErr) return res.status(500).json({ error: insErr.message });
                  addWidgetToDashboard(this.lastID);
                }
              );
            }
          }
        );
      }
    );
  });
});

// GET /:id/ai-insights - Generate AI insights for the dashboard
router.get('/:id/ai-insights', async (req, res) => {
  const dashboardId = req.params.id;
  const db = req.app.get('db');
  const api_key = req.query.api_key;

  const resolvedApiKey = (api_key && api_key.trim() && !api_key.startsWith('YOUR_'))
    ? api_key.trim()
    : process.env.GROQ_API_KEY;

  try {
    // 1. Fetch dashboard name and description
    const dashboard = await new Promise((resolve, reject) => {
      db.get(`SELECT name, description FROM dashboards WHERE id = ?`, [dashboardId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found.' });
    }

    // 2. Fetch all widgets in this dashboard
    const widgets = await new Promise((resolve, reject) => {
      db.all(
        `SELECT w.id as widget_id, w.width, w.height, 
                v.chart_type, v.chart_config,
                q.question, q.generated_sql, q.database_id
         FROM dashboard_widgets w
         JOIN visualizations v ON w.visualization_id = v.id
         JOIN query_history q ON v.query_id = q.id
         WHERE w.dashboard_id = ?`,
        [dashboardId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    if (widgets.length === 0) {
      return res.json({
        insights: `### Executive Summary\nNo charts found on this dashboard. Go to the Edit Mode or Query Workspace to add some charts!`
      });
    }

    // 3. Run queries for each widget to gather data samples
    const widgetsWithData = [];
    for (const widget of widgets) {
      try {
        const result = await queriesRouter.executeQuery(widget.database_id, widget.generated_sql, db);
        widgetsWithData.push({
          question: widget.question,
          chart_type: widget.chart_type,
          data: result.rows || []
        });
      } catch (execErr) {
        console.warn(`[Dashboard AI] Failed to fetch data for widget "${widget.question}":`, execErr.message);
        widgetsWithData.push({
          question: widget.question,
          chart_type: widget.chart_type,
          data: []
        });
      }
    }

    // 4. Send to AI Engine to write summary and cross-cutting insights
    const insights = await aiEngine.generateDashboardInsights(
      dashboard.name,
      dashboard.description,
      widgetsWithData,
      resolvedApiKey
    );

    res.json({ insights });

  } catch (err) {
    console.error('[Dashboard AI] Insights pipeline failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
