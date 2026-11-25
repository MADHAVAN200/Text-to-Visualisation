const express = require('express');
const router = express.Router();
const owns = require('../ownership');
const path = require('path');
const queriesRouter = require('./queries');
const aiEngine = require('./ai-engine');

// List all dashboards
router.get('/', (req, res) => {
  const db = req.app.get('db');
  db.all(`SELECT id, name, description, created_at FROM dashboards WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id], (err, rows) => {
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
  const userId = req.user.id;

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
router.get('/:id', owns('dashboard', r => r.params.id), (req, res) => {
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

// PUT /:id/report - Persist the full free-form report canvas (Power BI-grade builder).
// Stores the serialized ReportState blob in dashboards.layout_json (source of truth
// for the new builder) and, best-effort, mirrors SQL-backed chart widgets into the
// legacy dashboard_widgets table so older readers (Dashboard home, legacy GET) still
// render. Non-chart widgets (text, slicer, narrative) live only in layout_json.
router.put('/:id/report', owns('dashboard', r => r.params.id), owns('visualization', r => (r.body.widgets || []).map(w => w.visualization_id)), (req, res) => {
  const dashboardId = req.params.id;
  const { layout_json, widgets } = req.body;
  const db = req.app.get('db');

  if (typeof layout_json !== 'string') {
    return res.status(400).json({ error: 'layout_json (string) is required.' });
  }

  db.run(
    `UPDATE dashboards SET layout_json = ? WHERE id = ?`,
    [layout_json, dashboardId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Dashboard not found.' });

      // Best-effort legacy mirror. Never fatal: layout_json remains authoritative.
      if (Array.isArray(widgets)) {
        const valid = widgets.filter(w => w && w.visualization_id);
        db.serialize(() => {
          db.run(`DELETE FROM dashboard_widgets WHERE dashboard_id = ?`, [dashboardId], (delErr) => {
            if (delErr) console.warn('[Report Save] Legacy widget clear failed:', delErr.message);
          });
          if (valid.length > 0) {
            const stmt = db.prepare(
              `INSERT INTO dashboard_widgets (dashboard_id, visualization_id, position_x, position_y, width, height)
               VALUES (?, ?, ?, ?, ?, ?)`
            );
            valid.forEach(w => {
              stmt.run([
                dashboardId,
                w.visualization_id,
                Math.round(w.position_x || 0),
                Math.round(w.position_y || 0),
                Math.round(w.width || 6),
                Math.round(w.height || 4),
              ], (insErr) => {
                if (insErr) console.warn('[Report Save] Legacy widget insert failed:', insErr.message);
              });
            });
            stmt.finalize();
          }
        });
      }

      res.json({ success: true, message: 'Report layout saved.' });
    }
  );
});

// Delete a dashboard and its widgets
router.delete('/:id', owns('dashboard', r => r.params.id), (req, res) => {
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
router.post('/:id/widgets', owns('dashboard', r => r.params.id), owns('visualization', r => r.body.visualization_id), (req, res) => {
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
router.put('/:id/widgets/layout', owns('dashboard', r => r.params.id), (req, res) => {
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
router.delete('/widgets/:id', owns('widget', r => r.params.id), (req, res) => {
  const widgetId = req.params.id;
  const db = req.app.get('db');

  db.run(`DELETE FROM dashboard_widgets WHERE id = ?`, [widgetId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Widget removed from dashboard.' });
  });
});

// POST /recommend - AI dashboard recommendation and schema-based auto-generation
router.post('/recommend', owns('database', r => r.body.database_id), async (req, res) => {
  try {
    await createRequestedDashboard(req, res);
  } catch (err) {
    if (!err.clarification) console.error('[AI Recommendation] Auto-dashboard generation failed:', err);
    res.status(err.status || 500).json({ error: err.message, clarification: err.clarification });
  }
});

// PUT /widgets/:id - Update widget visual configurations or title
router.put('/widgets/:id', owns('widget', r => r.params.id), (req, res) => {
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
router.post('/:id/widgets/import-query', owns('dashboard', r => r.params.id), owns('query', r => r.body.query_id), (req, res) => {
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
router.get('/:id/ai-insights', owns('dashboard', r => r.params.id), async (req, res) => {
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

// Publish the whole report in a single insert after all measures have executed.
async function createRequestedDashboard(req, res) {
  const { objective = '', database_id } = req.body;
  if (typeof objective !== 'string') return res.status(400).json({error: 'Expected a dashboard request.'});
  const goal = objective.trim().replace(/[.!?]$/, '');
  const db = req.app.get('db');
  const specs = await require('./schema-dashboard')(objective, database_id, db, req.body.api_key, req.body.choices);
  const widgets = [];
  for (const {type, value, question, sql, x, allowNull} of specs) {
    const {rows} = await queriesRouter.executeQuery(database_id, sql, db);
    if (!rows.length || (!allowNull && rows.every(row => row[value] == null))) return res.status(422).json({error:'No metric values in the requested period.'});
    const detail = type !== 'kpi';
    widgets.push({id:type + widgets.length, type:'chart', chartType:type, title:question, question, sql, databaseId:Number(database_id),
      fields:{xAxis:x, values:[{field:value, agg:'NONE'}]}, formatting:{},
      x:24, y:widgets.length ? widgets.at(-1).y + widgets.at(-1).h + 16 : 20, w:detail ? 760 : 320, h:detail ? 350 : 130, z:widgets.length + 1});
  }
  const report = {version: 1, themeId:'midnight', pages:[{id:'overview',name:'Overview',widgets}],activePageId:'overview',canvasWidth:1200,globalFilters:[]};
  const id = await new Promise((resolve,reject) => db.run(
    'INSERT INTO dashboards(user_id,name,description,created_at,layout_json) VALUES(?,?,?,?,?)',
    [req.user.id, goal || 'Database overview', objective, new Date().toISOString(), JSON.stringify(report)],
    function(err) { err ? reject(err) : resolve(this.lastID); }));
  res.status(201).json({dashboard_id:id, widget_count:widgets.length});
}
module.exports = router;
