const express = require('express');
const router = express.Router();

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

module.exports = router;
