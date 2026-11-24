const lookup = {
  database: 'SELECT id FROM connected_databases WHERE id=? AND user_id=?',
  dashboard: 'SELECT id FROM dashboards WHERE id=? AND user_id=?',
  query: 'SELECT q.id FROM query_history q JOIN connected_databases d ON d.id=q.database_id AND d.user_id=q.user_id WHERE q.id=? AND q.user_id=?',
  visualization: 'SELECT v.id FROM visualizations v JOIN query_history q ON q.id=v.query_id JOIN connected_databases d ON d.id=q.database_id AND d.user_id=q.user_id WHERE v.id=? AND q.user_id=?',
  widget: 'SELECT w.id FROM dashboard_widgets w JOIN dashboards d ON d.id=w.dashboard_id WHERE w.id=? AND d.user_id=?'
};

function owns(kind, ids) {
  return async (req, res, next) => {
    try {
      for (const id of [].concat(ids(req))) {
        const row = await new Promise((resolve, reject) => req.app.get('db').get(
          lookup[kind], [id, req.user.id], (err, result) => err ? reject(err) : resolve(result)));
        if (!row) return res.status(404).json({ error: 'Resource unavailable.' });
      }
      next();
    } catch (err) { next(err); }
  };
}
module.exports = owns;
