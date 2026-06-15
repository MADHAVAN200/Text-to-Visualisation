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
// Sync schema for an existing connection
router.post('/:id/sync', async (req, res) => {
  const dbId = req.params.id;
  const db = req.app.get('db');

  db.get(`SELECT db_type, database_name FROM connected_databases WHERE id = ?`, [dbId], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Database connection not found.' });

    try {
      const response = await axios.post(`${PYTHON_ENGINE_URL}/parse-schema`, {
        database_id: parseInt(dbId)
      });
      res.json({ success: true, tables: response.data.tables });
    } catch (apiErr) {
      console.warn('FastAPI sync failed, trying JS sync fallback:', apiErr.message);
      
      if (row.db_type.toLowerCase() === 'sqlite') {
        try {
          const path = require('path');
          const projectRoot = path.resolve(__dirname, '../../');
          const targetDbPath = path.resolve(projectRoot, row.database_name);
          const tables = await parseSqliteSchemaJS(parseInt(dbId), targetDbPath, db);
          res.json({ success: true, tables });
        } catch (jsErr) {
          res.status(500).json({ error: 'Schema parsing failed: ' + jsErr.message });
        }
      } else {
        res.status(500).json({ error: 'FastAPI offline and JS parser only supports SQLite: ' + apiErr.message });
      }
    }
  });
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

// Seed and Load Demo Sandbox Database
router.post('/seed-sandbox', async (req, res) => {
  const db = req.app.get('db');
  const { exec } = require('child_process');
  const path = require('path');
  
  const projectRoot = path.resolve(__dirname, '../../');
  const scriptPath = path.resolve(projectRoot, 'ai-engine/init_db.py');
  
  // 1. Run the database seeding script
  exec(`python "${scriptPath}"`, { cwd: projectRoot }, (execErr, stdout, stderr) => {
    if (execErr) {
      console.error('Failed to seed sandbox database:', execErr.message);
      return res.status(500).json({ error: 'Failed to seed sample database: ' + execErr.message });
    }

    // 2. Define SQLite connection details
    const name = "Retail Analytics Sandbox (Demo)";
    const db_type = "sqlite";
    const database_name = "ai-engine/sample_sales.db";
    const connStr = "";
    const createdAt = new Date().toISOString();

    // 3. Register or Retrieve existing database connection id
    db.get(`SELECT id FROM connected_databases WHERE database_name = ?`, [database_name], (err, existingDb) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const insertOrSync = (dbId) => {
        // Trigger schema sync on the Python FastAPI AI Engine
        axios.post(`${PYTHON_ENGINE_URL}/parse-schema`, {
          database_id: dbId
        }).then(response => {
          res.json({
            success: true,
            id: dbId,
            name,
            db_type,
            database_name,
            created_at: createdAt,
            tables: response.data.tables
          });
        }).catch(async (apiErr) => {
          console.warn('FastAPI schema sync failed during seed-sandbox, falling back to local JS SQLite parser:', apiErr.message);
          try {
            const targetDbPath = path.resolve(projectRoot, database_name);
            const tables = await parseSqliteSchemaJS(dbId, targetDbPath, db);
            res.json({
              success: true,
              id: dbId,
              name,
              db_type,
              database_name,
              created_at: createdAt,
              tables
            });
          } catch (jsErr) {
            console.error('Local JS SQLite parser also failed:', jsErr.message);
            res.json({
              success: true,
              id: dbId,
              name,
              db_type,
              database_name,
              created_at: createdAt,
              warning: 'Sandbox database connected, but failed to sync schema metadata automatically: ' + jsErr.message
            });
          }
        });
      };

      if (existingDb) {
        insertOrSync(existingDb.id);
      } else {
        db.run(
          `INSERT INTO connected_databases (name, db_type, database_name, connection_string, created_at) 
           VALUES (?, ?, ?, ?, ?)`,
          [name, db_type, database_name, connStr, createdAt],
          function (insErr) {
            if (insErr) return res.status(500).json({ error: insErr.message });
            insertOrSync(this.lastID);
          }
        );
      }
    });
  });
});

// Javascript-based SQLite Schema Parser Fallback
function parseSqliteSchemaJS(dbId, dbFilePath, metadataDb) {
  return new Promise((resolve, reject) => {
    const sqlite3 = require('sqlite3').verbose();
    const targetDb = new sqlite3.Database(dbFilePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });

    targetDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';", [], (tblErr, tables) => {
      if (tblErr) {
        targetDb.close();
        return reject(tblErr);
      }

      const tableNames = tables.map(t => t.name);
      
      metadataDb.serialize(() => {
        metadataDb.run("DELETE FROM schema_metadata WHERE database_id = ?", [dbId]);

        let completed = 0;
        if (tableNames.length === 0) {
          targetDb.close();
          return resolve([]);
        }

        tableNames.forEach(tableName => {
          // Get columns info
          targetDb.all(`PRAGMA table_info(${tableName});`, [], (colErr, columns) => {
            if (colErr) {
              targetDb.close();
              return reject(colErr);
            }

            // Get foreign keys
            targetDb.all(`PRAGMA foreign_key_list(${tableName});`, [], (fkErr, fks) => {
              if (fkErr) {
                targetDb.close();
                return reject(fkErr);
              }

              // Build foreign keys map
              const fkMap = {};
              fks.forEach(fk => {
                const fromCol = fk.from;
                const toTable = fk.table;
                const toCol = fk.to;
                fkMap[fromCol] = { table: toTable, column: toCol };
              });

              columns.forEach(col => {
                const colName = col.name;
                const colType = col.type;
                const notnull = col.notnull;
                const isPk = col.pk > 0;
                const isFk = !!fkMap[colName];
                const fTable = isFk ? fkMap[colName].table : null;
                const fCol = isFk ? fkMap[colName].column : null;

                metadataDb.run(
                  `INSERT INTO schema_metadata (
                    database_id, table_name, column_name, data_type, 
                    nullable, primary_key, foreign_key, foreign_to_table, foreign_to_column
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    dbId, tableName, colName, colType,
                    notnull === 0 ? 1 : 0, isPk ? 1 : 0, isFk ? 1 : 0, fTable, fCol
                  ]
                );
              });

              completed++;
              if (completed === tableNames.length) {
                targetDb.close();
                resolve(tableNames);
              }
            });
          });
        });
      });
    });
  });
}

module.exports = router;
