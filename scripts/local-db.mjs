import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
export function localDatabase(filename=':memory:'){
 const db=new DatabaseSync(filename);
 db.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY NOT NULL)');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
  if(db.prepare('SELECT name FROM _local_migrations WHERE name=?').get(file))continue;
  let sql=fs.readFileSync('drizzle/'+file,'utf8').replace(/CREATE TABLE (?!IF NOT EXISTS)/g,'CREATE TABLE IF NOT EXISTS ');
  // Older preview files predate the ledger; do not apply an existing column twice.
  if(file==='0003_trip_archive.sql'&&db.prepare('PRAGMA table_info(itineraries)').all().some(column=>column.name==='deleted_at'))sql=sql.replace('ALTER TABLE itineraries ADD COLUMN deleted_at TEXT;','');
  db.exec('BEGIN');try{db.exec(sql);db.prepare('INSERT INTO _local_migrations (name) VALUES (?)').run(file);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');db.close();throw error;}
 }
 const result={prepare(sql){return {bind(...values){return {sql,values,async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:r.changes}};}};}};},async batch(statements){db.exec('BEGIN');try{const results=statements.map(({sql,values})=>{const r=db.prepare(sql).run(...values);return {meta:{changes:r.changes}};});db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}},close(){db.close();}};
 return result;
}
