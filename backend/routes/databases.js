const express = require('express');
const router = express.Router();
const owns = require('../ownership');
const fs = require('fs');

const remote = require('../remote-source');
// Get all databases
router.get('/', (req, res) => {
  const db = req.app.get('db');
  db.all(`SELECT id, name, db_type, host, port, username, database_name, created_at FROM connected_databases WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id], (err, rows) => {
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

  if (db_type.toLowerCase() === 'sqlite' && !allowedFile(database_name, req.user.id)) {
    return res.status(400).json({ error: 'Choose the retail sample or a SQLite file provisioned in your account directory.' });
  }
  if (!['sqlite','postgresql','supabase','mysql'].includes(db_type)) return res.status(400).json({error:'Unsupported database engine.'});
  let connStr = '';
  let discovered;
  if (db_type !== 'sqlite') {
    if (![host, username, database_name, password].every(v => typeof v === 'string' && v.length) || !Number.isInteger(Number(port)) || port < 1 || port > 65535) {
      return res.status(400).json({error:'Enter host, port, database name, username and password.'});
    }
    try {
      const schema = db_type === 'mysql' ? database_name : (req.body.schema || 'public');
      connStr = remote.seal({password,schema,tls:db_type === 'supabase' || req.body.tls !== false});
      discovered = await remote.describe({db_type,host,port,username,database_name,connection_string:connStr});
      if (!discovered.columns.length) return res.status(400).json({error:'No visible columns. Check database, schema, and read permissions.'});
    } catch (err) { return res.status(400).json({error:'Connection failed: '+err.message}); }
  }
  const createdAt = new Date().toISOString();

  // Insert into metadata db
  db.run(
    `INSERT INTO connected_databases (user_id, name, db_type, host, port, username, database_name, connection_string, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, name, db_type, host, port, username, database_name, connStr, createdAt],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const newDbId = this.lastID;
      
      try {
        const tables = await syncSchema(newDbId, db_type, database_name, db, discovered);

        res.status(201).json({
          id: newDbId,
          name,
          db_type,
          host,
          port,
          username,
          database_name,
          created_at: createdAt,
          tables
        });
      } catch (apiErr) {
        db.run('DELETE FROM connected_databases WHERE id=?',[newDbId],()=>res.status(400).json({error:'Schema sync failed: '+apiErr.message}));
      }
    }
  );
});

async function syncSchema(id, type, file, metadata, discovered) {
  if (type.toLowerCase() === 'sqlite') {
    const source = require('path').resolve(__dirname, '../../', file);
    return parseSqliteSchemaJS(id, source, metadata);
  }
  const source = discovered || await remote.describe(await require('./queries').getDbConnectionParams(id,metadata));
  const write = (sql,args) => new Promise((resolve,reject)=>metadata.run(sql,args,err=>err?reject(err):resolve()));
  await write('DELETE FROM schema_metadata WHERE database_id=?',[id]);
  for (const col of source.columns) {
    const pk = source.primaryKeys.some(k=>k.tbl===col.table_name && k.col===col.column_name);
    const fk = source.foreignKeys.find(k=>k.child===col.table_name && k.child_key===col.column_name);
    await write('INSERT INTO schema_metadata(database_id,table_name,column_name,data_type,nullable,primary_key,foreign_key,foreign_to_table,foreign_to_column) VALUES(?,?,?,?,?,?,?,?,?)',
      [id,col.table_name,col.column_name,col.data_type,Number(col.is_nullable==='YES'),Number(pk),Number(!!fk),fk?.parent,fk?.parent_key]);
  }
  return [...new Set(source.columns.map(c=>c.table_name))];
}

router.post('/:id/sync', owns('database', r => r.params.id), (req, res) => {
  const db = req.app.get('db');
  db.get('SELECT db_type, database_name FROM connected_databases WHERE id=?', [req.params.id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Connection unavailable.' });
    try {
      const tables = await syncSchema(req.params.id, row.db_type, row.database_name, db);
      res.json({ success: true, tables });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
});

// Get detailed schema metadata for a database ID
router.get('/:id/schema', owns('database', r => r.params.id), (req, res) => {
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

// Get table preview data
router.get('/:id/preview/:tableName', owns('database', r => r.params.id), async (req, res) => {
  const dbId = req.params.id;
  const tableName = req.params.tableName;
  const db = req.app.get('db');

  try {
    const queriesRouter = require('./queries');
    const result = await queriesRouter.executeQuery(dbId, `SELECT * FROM "${tableName.replaceAll('"','""')}" LIMIT 100`, db);
    res.json(result);
  } catch (err) {
    console.error(`Preview execution error for table ${tableName}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a connection
router.delete('/:id', owns('database', r => r.params.id), (req, res) => {
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
router.post('/seed-sandbox', async (req, res, next) => {
  const db = req.app.get('db');
  const file = 'ai-engine/sample_sales.db';
  const name = 'Retail Analytics Sandbox (Demo)';
  try {
    const source = require('path').resolve(__dirname, '../../', file);
    await fs.promises.access(source);
    const existing = await new Promise((resolve, reject) => db.get(
      'SELECT id FROM connected_databases WHERE user_id=? AND database_name=?', [req.user.id, file],
      (err, row) => err ? reject(err) : resolve(row)));
    const id = existing?.id || await new Promise((resolve, reject) => db.run(
      'INSERT INTO connected_databases(user_id,name,db_type,database_name,created_at) VALUES (?,?,?,?,?)',
      [req.user.id, name, 'sqlite', file, new Date().toISOString()],
      function(err) { err ? reject(err) : resolve(this.lastID); }));
    const tables = await parseSqliteSchemaJS(id, source, db);
    res.json({ success: true, id, name, db_type: 'sqlite', database_name: file, tables });
  } catch (err) { next(err); }
});

function allowedFile(file, userId) {
  const path = require('path');
  const project = path.resolve(__dirname, '../../');
  try {
    const real = fs.realpathSync(path.resolve(project, file));
    if (real === path.join(project, 'ai-engine', 'sample_sales.db')) return true;
    const root = path.resolve(process.env.SQLITE_SOURCE_ROOT || path.join(project, 'sources'), String(userId));
    const relative = path.relative(root, real);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.statSync(real).isFile();
  } catch { return false; }
}

// Javascript-based SQLite Schema Parser Fallback
async function parseSqliteSchemaJS(dbId, dbFilePath, metadataDb) {
  const sqlite3 = require('sqlite3');
  const db = new sqlite3.Database(dbFilePath, sqlite3.OPEN_READONLY);
  const read = sql => new Promise((resolve, reject) => db.all(sql, (err, rows) => err ? reject(err) : resolve(rows)));
  const write = (sql, params) => new Promise((resolve, reject) => metadataDb.run(sql, params, err => err ? reject(err) : resolve()));
  try {
    const tables = await read("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const metadata = [];
    for (const {name} of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const keys = await read('PRAGMA foreign_key_list(' + quoted + ')');
      for (const col of await read('PRAGMA table_info(' + quoted + ')')) {
        const key = keys.find(k => k.from === col.name);
        metadata.push([dbId, name, col.name, col.type, Number(!col.notnull), Number(!!col.pk), Number(!!key), key?.table, key?.to]);
      }
    }
    await write('DELETE FROM schema_metadata WHERE database_id=?', [dbId]);
    for (const row of metadata) await write('INSERT INTO schema_metadata(database_id,table_name,column_name,data_type,nullable,primary_key,foreign_key,foreign_to_table,foreign_to_column) VALUES(?,?,?,?,?,?,?,?,?)', row);
    return tables.map(t => t.name);
  } finally { db.close(); }
}

module.exports = router;
