const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const mysql = require('mysql2/promise');

function encryptionKey() {
  if (process.env.DB_CREDENTIAL_KEY) {
    const key = Buffer.from(process.env.DB_CREDENTIAL_KEY,'base64');
    if (key.length !== 32) throw new Error('DB_CREDENTIAL_KEY must encode 32 bytes.');
    return key;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Configure DB_CREDENTIAL_KEY for remote connections.');
  const file = path.join(require('os').homedir(),'.text2viz-connection-key');
  try { fs.writeFileSync(file,crypto.randomBytes(32),{flag:'wx',mode:0o600}); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  return fs.readFileSync(file);
}

function seal(config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config)),cipher.final()]);
  return ['v1',iv,cipher.getAuthTag(),ciphertext].map(x=>Buffer.isBuffer(x)?x.toString('base64'):x).join(':');
}

function config(row) {
  const [version,iv,tag,data] = row.connection_string.split(':');
  if (version !== 'v1') throw new Error('Reconnect this legacy source to store its credentials securely.');
  const decipher = crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64'));
  decipher.setAuthTag(Buffer.from(tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]));
}

const pgQuote = name => '"' + name.replaceAll('"','""') + '"';
function period(engine, field, monthly) {
  if (engine === 'mysql') return "DATE_FORMAT("+field+", '"+(monthly?'%Y-%m':'%Y')+"')";
  if (engine === 'postgresql' || engine === 'supabase') return "to_char(CAST("+field+" AS timestamp), '"+(monthly?'YYYY-MM':'YYYY')+"')";
  return "strftime('"+(monthly?'%Y-%m':'%Y')+"', "+field+")";
}

const sessions = new (require('node:async_hooks').AsyncLocalStorage)();
async function planningSession(row, operation) {
  if (row.db_type === 'sqlite') return operation();
  return withSession(row,(query,schema)=>sessions.run({credential:row.connection_string,query,schema},operation));
}

async function withSession(row, operation) {
  const current = sessions.getStore();
  if (current && current.credential === row.connection_string) return operation(current.query,current.schema);
  const {password,tls,schema} = config(row);
  const options = {host:row.host,port:Number(row.port),user:row.username,password,database:row.database_name,
    ssl:tls ? {rejectUnauthorized:true} : undefined};
  if (row.db_type === 'mysql') {
    const client = await mysql.createConnection({...options,connectTimeout:8000,dateStrings:true,decimalNumbers:true,supportBigNumbers:true});
    try {
      await client.query("SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@sql_mode,''), 'ANSI_QUOTES')");
      await client.query('SET SESSION max_execution_time=30000');
      await client.query('START TRANSACTION READ ONLY');
      return await operation(async (sql,params=[])=>{
        const [rows,fields] = await client.execute(sql,params);
        return {rows,columns:fields.map(f=>f.name)};
      },schema);
    } finally { await client.end(); }
  }
  const client = new Client({...options,connectionTimeoutMillis:8000,statement_timeout:30000});
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL search_path TO '+pgQuote(schema)+', pg_catalog');
    return await operation(async(sql,params=[])=>{
      const result = await client.query({text:sql,values:params,queryMode:'extended'});
      // pg represents exact numeric and bigint as strings. Keep unsafe integers as strings.
      for (const f of result.fields.filter(f=>[20,1700].includes(f.dataTypeID))) {
        for (const row of result.rows) {
          const raw = row[f.name];
          if (raw != null && Math.abs(Number(raw)) <= Number.MAX_SAFE_INTEGER) row[f.name] = Number(raw);
        }
      }
      return {rows:result.rows,columns:result.fields.map(f=>f.name)};
    },schema);
  } finally { await client.end(); }
}

async function describe(row) {
  return withSession(row,async(query,schema)=>{
    const my = row.db_type === 'mysql';
    const param = my ? '?' : '$1';
    const columns = (await query('SELECT table_name AS table_name,column_name AS column_name,data_type AS data_type,is_nullable AS is_nullable FROM information_schema.columns WHERE table_schema='+param+' ORDER BY table_name,ordinal_position',[schema])).rows;
    const primaryKeys = (await query(my ?
      "SELECT table_name AS tbl,column_name AS col,ordinal_position AS pk FROM information_schema.key_column_usage WHERE table_schema=? AND constraint_name='PRIMARY' ORDER BY tbl,pk" :
      "SELECT t.relname AS tbl,a.attname AS col,k.ord AS pk FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE i.indisprimary AND k.ord<=i.indnkeyatts AND n.nspname=$1 ORDER BY tbl,pk",[schema])).rows;
    const foreignKeys = (await query(my ?
      'SELECT table_name AS child,constraint_name AS id,ordinal_position AS seq,referenced_table_name AS parent,column_name AS child_key,referenced_column_name AS parent_key FROM information_schema.key_column_usage WHERE table_schema=? AND referenced_table_schema=table_schema ORDER BY child,id,seq' :
      "SELECT t.relname AS child,c.oid AS id,k.ord AS seq,p.relname AS parent,a.attname AS child_key,b.attname AS parent_key FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(x,y,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.x JOIN pg_attribute b ON b.attrelid=p.oid AND b.attnum=k.y WHERE c.contype='f' AND n.nspname=$1 AND t.relnamespace=p.relnamespace ORDER BY child,id,seq",[schema])).rows;
    return {columns,primaryKeys,foreignKeys};
  });
}
module.exports = {seal,period,withSession,describe,planningSession};
