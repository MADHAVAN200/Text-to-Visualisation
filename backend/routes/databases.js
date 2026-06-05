const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');

const PYTHON_ENGINE_URL = process.env.PYTHON_ENGINE_URL || 'http://127.0.0.1:5000';

// Get all databases
router.get('/', (req, res) => {
  const db = req.app.get('db');
  db.all(`SELECT id, name, db_type, host, port, username, database_name, created_at FROM connected_databases ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Add a connection
router.post('/connect', async (req, res) => {
  const { name, db_type, host, port, username, database_name, password, connection_string } = req.body;
  const db = req.app.get('db');

  if (!name || !db_type) {
    return res.status(400).json({ error: 'Database name and type are required.' });
  }

  if (db_type.toLowerCase() === 'sqlite' && !database_name) {
    return res.status(400).json({ error: 'SQLite database file path is required.' });
  }

  // Generate connection string if not provided
  let connStr = connection_string || '';
  if (!connStr) {
    if (db_type.toLowerCase() === 'postgresql') {
      connStr = `postgresql://${username}:${password}@${host}:${port || 5432}/${database_name}`;
    } else if (db_type.toLowerCase() === 'mysql') {
      // For mysql, we store password comma-separated
      connStr = `${host},${port || 3306},${username},${password},${database_name}`;
    }
  }

  const createdAt = new Date().toISOString();

  // Insert into metadata db
  db.run(
    `INSERT INTO connected_databases (name, db_type, host, port, username, database_name, connection_string, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, db_type, host, port, username, database_name, connStr, createdAt],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const newDbId = this.lastID;
      
      // Trigger Python Schema Parsing
      try {
        const response = await axios.post(`${PYTHON_ENGINE_URL}/parse-schema`, {
          database_id: newDbId
        });
        
        res.status(201).json({
          id: newDbId,
          name,
          db_type,
          host,
          port,
          username,
          database_name,
          created_at: createdAt,
          tables: response.data.tables
        });
      } catch (apiErr) {
        console.error('Python schema parsing failed during connect:', apiErr.response?.data || apiErr.message);
        // We still connected, return with warning
        res.status(201).json({
          id: newDbId,
          name,
          db_type,
          host,
          port,
          username,
          database_name,
          created_at: createdAt,
          warning: 'Database added, but failed to sync schema. Please check Python AI Engine connection and click "Sync Schema" in connections page.'
        });
      }
    }
  );
});

// Sync schema for an existing connection
router.post('/:id/sync', async (req, res) => {
  const dbId = req.params.id;
  try {
    const response = await axios.post(`${PYTHON_ENGINE_URL}/parse-schema`, {
      database_id: parseInt(dbId)
    });
    res.json({ success: true, tables: response.data.tables });
  } catch (apiErr) {
    console.error('Python schema sync failed:', apiErr.response?.data || apiErr.message);
    res.status(500).json({ error: apiErr.response?.data?.detail || apiErr.message });
  }
});

// Get detailed schema metadata for a database ID
router.get('/:id/schema', (req, res) => {
  const dbId = req.params.id;
  const db = req.app.get('db');

  db.all(
    `SELECT table_name, column_name, data_type, nullable, primary_key, foreign_key, foreign_to_table, foreign_to_column 
     FROM schema_metadata 
     WHERE database_id = ? 
     ORDER BY table_name, id`,
    [dbId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Format as table structures
      const schema = {};
      rows.forEach(row => {
        if (!schema[row.table_name]) {
          schema[row.table_name] = [];
        }
        schema[row.table_name].push({
          column: row.column_name,
          type: row.data_type,
          nullable: row.nullable === 1,
          isPrimary: row.primary_key === 1,
          isForeign: row.foreign_key === 1,
          foreignTable: row.foreign_to_table,
          foreignColumn: row.foreign_to_column
        });
      });
      
      res.json(schema);
    }
  );
});

// Delete a connection
router.delete('/:id', (req, res) => {
  const dbId = req.params.id;
  const db = req.app.get('db');

  db.serialize(() => {
    db.run(`DELETE FROM schema_metadata WHERE database_id = ?`, [dbId]);
    db.run(`DELETE FROM connected_databases WHERE id = ?`, [dbId], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Database connection deleted.' });
    });
  });
});

module.exports = router;
