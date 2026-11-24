const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Open connection to metadata database
const dbPath = process.env.METADATA_DB_PATH || path.join(__dirname, '../ai-engine/metadata.db');
const db = new sqlite3.Database(dbPath);
const run = sql => new Promise((resolve, reject) => db.run(sql, err => err ? reject(err) : resolve()));
async function migrate() {
  await run('BEGIN IMMEDIATE');
  try {
    const columns = table => new Promise((resolve, reject) =>
      db.all('PRAGMA table_info(' + table + ')', (err, rows) => err ? reject(err) : resolve(rows.map(r => r.name))));
    if (!(await columns('connected_databases')).includes('user_id')) {
      await run('ALTER TABLE connected_databases ADD COLUMN user_id INTEGER');
      // Guest-era ownership cannot be attributed to a verified identity.
      for (const table of ['dashboards', 'query_history']) {
        await run('ALTER TABLE ' + table + ' ADD COLUMN legacy_user_id INTEGER');
        await run('UPDATE ' + table + ' SET legacy_user_id = user_id, user_id = NULL');
      }
    }
    if (!(await columns('dashboards')).includes('layout_json')) await run('ALTER TABLE dashboards ADD COLUMN layout_json TEXT');
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

// Share db reference through app
app.set('db', db);

// Simple JWT Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access token required' });
  
  const jwt = require('jsonwebtoken');
  const secret = require('./secret');
  
  jwt.verify(token, secret, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Expose authenticate token middleware
app.set('authenticateToken', authenticateToken);

// Routes
const authRouter = require('./routes/auth');
const databasesRouter = require('./routes/databases');
const queriesRouter = require('./routes/queries');
const dashboardsRouter = require('./routes/dashboards');
const aiRouter = require('./routes/ai');

app.use('/api/auth', authRouter);
app.use('/api/databases', authenticateToken, databasesRouter);
app.use('/api/queries', authenticateToken, queriesRouter);
app.use('/api/dashboards', authenticateToken, dashboardsRouter);
app.use('/api/ai', authenticateToken, aiRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', api: 'voice2viz-express-api' });
});

// Start Express Server
migrate().then(() => app.listen(PORT, () => console.log('Listening on', PORT)))
  .catch(err => { console.error('Metadata migration failed:', err.message); process.exit(1); });
