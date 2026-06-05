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
const dbPath = path.join(__dirname, '../ai-engine/metadata.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to metadata database:', err.message);
  } else {
    console.log('Connected to metadata database at:', dbPath);
  }
});

// Share db reference through app
app.set('db', db);

// Simple JWT Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access token required' });
  
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'voice2viz_jwt_secret_key_12345';
  
  jwt.verify(token, secret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
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

app.use('/api/auth', authRouter);
app.use('/api/databases', databasesRouter);
app.use('/api/queries', queriesRouter);
app.use('/api/dashboards', dashboardsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', api: 'voice2viz-express-api' });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Express API Server listening on port ${PORT}`);
});
