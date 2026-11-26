const sqlite = require('../node_modules/sqlite3');
const mysql = require('../node_modules/mysql2/promise');
const fs = require('node:fs');
(async()=>{
  const config = JSON.parse(fs.readFileSync(process.argv[3]));
  const source = new sqlite.Database(process.argv[2], sqlite.OPEN_READONLY);
  const read = table => new Promise((resolve,reject)=>source.all('SELECT * FROM '+table,(e,r)=>e?reject(e):resolve(r)));
  const client = await mysql.createConnection({host:config.host,port:config.port,user:config.username,password:config.password,database:config.database_name});
  try {
    await client.query('CREATE TABLE countries(country_id INTEGER PRIMARY KEY,country_of_origin VARCHAR(120))');
    await client.query('CREATE TABLE ratings(rating_id INTEGER PRIMARY KEY,country_id INTEGER,total_cup_points DOUBLE,number_of_bags DOUBLE,aroma DOUBLE,processing_method VARCHAR(120),grading_date DATE,FOREIGN KEY(country_id) REFERENCES countries(country_id))');
    for (const table of ['countries','ratings']) {
      const rows = await read(table);
      await client.query('INSERT INTO '+table+' VALUES ?', [rows.map(row=>Object.values(row))]);
    }
  } finally {source.close();await client.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
