import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {handleApi,handleTrips} from '../server/api.js';
import {handleSharing} from '../server/sharing.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {LEGACY_TRIP_ID} from '../server/trips.js';
const origin='https://trip.example',owner='alice@example.com',editor='bob@example.com',legacy='owner@example.com';
const request=(pathname,method='GET',body,email=owner)=>new Request(origin+pathname,{method,headers:{'oai-authenticated-user-id':email,Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-1'},body:body===undefined?undefined:JSON.stringify(body)});
const tripPath=id=>'/api/trip?trip='+id;
const stop=(id,name=id,more={})=>({id,name,time:'09:00',...more});
async function create(env,email=owner){const response=await handleTrips(request('/api/trips','POST',{title:'旅行',startDate:'2028-01-01',endDate:'2028-01-02'},email),env);assert.equal(response.status,201);return response.json();}
async function invite(env,id,email=editor,role='editor',inviter=owner){assert.equal((await handleSharing(request('/api/shares?trip='+id,'PUT',{email,role,enabled:true},inviter),env)).status,200);}
async function save(env,data,email=owner,mutationId=crypto.randomUUID()){const response=await handleApi(request(tripPath(data.trip.id),'PUT',{days:data.days,revision:data.revision,mutationId},email),env);assert.equal(response.status,200);return response.json();}
async function read(env,id,email=owner){const response=await handleApi(request(tripPath(id),'GET',undefined,email),env);assert.equal(response.status,200);return response.json();}
const ledger=(DB,id)=>DB.prepare('SELECT stop_id,created_by FROM stop_creators WHERE trip_id=? ORDER BY stop_id').bind(id).all();
const stored=(DB,id)=>DB.prepare('SELECT payload,previous,revision,mutation_id FROM itineraries WHERE id=?').bind(id).first();
const flatten=data=>data.days.flatMap(day=>day.stops);
const racing=(DB,action)=>({...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){const statement=prepared.bind(...values);if(!sql.startsWith('UPDATE itineraries SET title=?,payload='))return statement;return {...statement,async run(){await action();return statement.run();}};}};}});

test('new owner/editor stops use the authenticated normalized creator and discard forged attribution',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);const id=data.trip.id;await invite(env,id);
  data.days[0].stops.push(stop('owner-stop','起點',{createdBy:editor}),stop('owner-import','匯入景點',{createdBy:'attacker@example.com'}));
  data=await save(env,data,' ALICE@EXAMPLE.COM ');assert.deepEqual(flatten(data).map(s=>s.createdBy),[owner,owner]);
  data.days[1].stops.push(stop('editor-stop','編輯者新增',{createdBy:owner}),stop('editor-import','GPT 匯入',{createdBy:{email:owner}}));
  data=await save(env,data,' BOB@EXAMPLE.COM ');assert.deepEqual(flatten(data).map(s=>s.createdBy),[owner,owner,editor,editor]);
  const loaded=await read(env,id,editor);assert.deepEqual(flatten(loaded).map(s=>s.createdBy),[owner,owner,editor,editor]);
  assert.equal(loaded.previous[0].stops[0].createdBy,owner);
  assert.deepEqual((await ledger(DB,id)).results.map(r=>r.created_by),[editor,editor,owner,owner]);
 }finally{DB.close();}
});

test('existing attribution survives old clients, edits, reordering and moving stops between days',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);const id=data.trip.id;await invite(env,id);
  data.days[0].stops.push(stop('first'));data=await save(env,data);
  data.days[0].stops.push(stop('second'));data=await save(env,data,editor);
  const [first,second]=data.days[0].stops;delete first.createdBy;second.createdBy=owner;first.name='改名';second.time='10:00';
  data.days[0].stops=[second];data.days[1].stops=[first];data=await save(env,data,editor);
  assert.equal(data.days[0].stops[0].createdBy,editor);assert.equal(data.days[1].stops[0].createdBy,owner);assert.equal(data.days[1].stops[0].name,'改名');
  assert.deepEqual(data.previous[0].stops.map(s=>s.createdBy),[owner,editor]);
 }finally{DB.close();}
});

test('undo restores creators immediately and after both content snapshots have forgotten a deleted stop',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);const id=data.trip.id;await invite(env,id);
  data.days[0].stops.push(stop('historic'));data=await save(env,data);const oldDraft=structuredClone(data.days[0].stops[0]);
  data.days[0].stops=[];data=await save(env,data,editor);assert.equal(data.previous[0].stops[0].createdBy,owner);
  data.days=data.previous;data=await save(env,data,editor);assert.equal(data.days[0].stops[0].createdBy,owner);
  data.days[0].stops=[];data=await save(env,data,editor);
  data.days[1].stops.push(stop('unrelated'));data=await save(env,data,editor);
  assert.equal(data.previous.flatMap(d=>d.stops).some(s=>s.id==='historic'),false);
  oldDraft.createdBy=editor;data.days[0].stops.push(oldDraft);data=await save(env,data,editor);
  assert.equal(data.days[0].stops[0].createdBy,owner);assert.equal(data.days[1].stops[0].createdBy,editor);
  assert.equal((await ledger(DB,id)).results.find(r=>r.stop_id==='historic').created_by,owner);
 }finally{DB.close();}
});

test('legacy unknown creators remain unassigned through edits, deletion, multi-save history and restoration',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await read(env,LEGACY_TRIP_ID,legacy);await invite(env,LEGACY_TRIP_ID,editor,'editor',legacy);
  const original=structuredClone(data.days[0].stops[0]),legacyId=original.id;assert.equal(original.createdBy,undefined);
  data.days[0].stops[0].createdBy=editor;data.days[0].stops[0].name='調整旧景點';data=await save(env,data,editor);assert.equal(data.days[0].stops[0].createdBy,undefined);
  data.days[0].stops.shift();data=await save(env,data,editor);
  data.days[1].stops.push(stop('new-after-legacy'));data=await save(env,data,editor);
  original.createdBy=legacy;data.days[0].stops.unshift(original);data=await save(env,data,editor);
  assert.equal(data.days[0].stops[0].createdBy,undefined);assert.equal(data.days[1].stops.at(-1).createdBy,editor);
  assert.equal((await ledger(DB,LEGACY_TRIP_ID)).results.find(r=>r.stop_id===legacyId).created_by,null);
 }finally{DB.close();}
});

test('creator history survives database reloads and is isolated by trip even when stop IDs match',async()=>{
 const filename=path.join(os.tmpdir(),'trip-attribution-'+crypto.randomUUID()+'.sqlite');let DB=localDatabase(filename),env={DB,OWNER_EMAIL:legacy};try{
  let a=await create(env),b=await create(env,editor);a.days[0].stops.push(stop('same-id'));b.days[0].stops.push(stop('same-id'));a=await save(env,a);b=await save(env,b,editor);
  a.days[0].stops=[];a=await save(env,a);a=await save(env,a);
  DB.close();DB=localDatabase(filename);env={...env,DB};a=await read(env,a.trip.id);await invite(env,a.trip.id);
  a.days[0].stops.push(stop('same-id','恢復',{createdBy:editor}));a=await save(env,a,editor);
  assert.equal(a.days[0].stops[0].createdBy,owner);assert.equal((await read(env,b.trip.id,editor)).days[0].stops[0].createdBy,editor);
 }finally{DB.close();fs.rmSync(filename,{force:true});}
});

test('failed revision, role and archive guards do not create attribution ghost records',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);const id=data.trip.id;await invite(env,id);
  const late=structuredClone(data);late.days[0].stops.push(stop('failed-cas'));
  const revisionRace=racing(DB,()=>DB.prepare('UPDATE itineraries SET revision=revision+1 WHERE id=?').bind(id).run());
  assert.equal((await handleApi(request(tripPath(id),'PUT',{days:late.days,revision:0,mutationId:'late-cas'},editor),{...env,DB:revisionRace})).status,409);
  data=await read(env,id);data.days[0].stops.push(stop('failed-role'));
  const roleRace=racing(DB,()=>DB.prepare("UPDATE itinerary_members SET role='viewer' WHERE trip_id=? AND email=?").bind(id,editor).run());
  assert.equal((await handleApi(request(tripPath(id),'PUT',{days:data.days,revision:1,mutationId:'late-role'},editor),{...env,DB:roleRace})).status,403);
  data.days[0].stops=[stop('failed-archive')];
  const archiveRace=racing(DB,()=>DB.prepare("UPDATE itineraries SET deleted_at='archived',revision=revision+1 WHERE id=?").bind(id).run());
  assert.equal((await handleApi(request(tripPath(id),'PUT',{days:data.days,revision:1,mutationId:'late-archive'}),{...env,DB:archiveRace})).status,403);
  assert.deepEqual((await ledger(DB,id)).results,[]);assert.equal(JSON.parse((await stored(DB,id)).payload)[0].stops.length,0);
 }finally{DB.close();}
});

test('an attribution trigger failure rolls back the entire content save, revision and undo snapshot',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);data.days[0].stops.push(stop('existing'));data=await save(env,data);const id=data.trip.id,before=await stored(DB,id),beforeLedger=await ledger(DB,id);
  await DB.prepare("CREATE TRIGGER reject_creator_test BEFORE INSERT ON stop_creators WHEN NEW.stop_id='rollback-stop' BEGIN SELECT RAISE(ABORT,'test creator rollback'); END").bind().run();
  data.days[0].stops.push(stop('rollback-stop'));
  const response=await handleApi(request(tripPath(id),'PUT',{days:data.days,revision:data.revision,mutationId:'rolled-back'}),env);assert.equal(response.status,503);
  assert.deepEqual(await stored(DB,id),before);assert.deepEqual(await ledger(DB,id),beforeLedger);
 }finally{DB.close();}
});

test('lost-reply retries do not change creator history or consume new stop IDs from the replay body',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const data=await create(env),id=data.trip.id;await invite(env,id);data.days[0].stops.push(stop('first-save'));
  const saved=await save(env,data,owner,'lost-reply'),before=await stored(DB,id);
  data.days[0].stops[0].createdBy=editor;data.days[0].stops.push(stop('ignored-replay'));
  const response=await handleApi(request(tripPath(id),'PUT',{days:data.days,revision:0,mutationId:'lost-reply'},editor),env);assert.equal(response.status,200);const replay=await response.json();
  assert.deepEqual(replay.days,saved.days);assert.deepEqual(await stored(DB,id),before);
  assert.deepEqual((await ledger(DB,id)).results.map(r=>r.stop_id),['first-save']);
  data.days=saved.days;data.revision=saved.revision;const unchanged=await save(env,data,editor);assert.equal(unchanged.days[0].stops[0].createdBy,owner);assert.equal((await ledger(DB,id)).results.length,1);
 }finally{DB.close();}
});

test('ledger creators and unknown tombstones override omitted, invalid or contradictory stored payload attribution',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);const id=data.trip.id;data.days[0].stops.push(stop('known'));data=await save(env,data);
  data.days[0].stops[0].createdBy=editor;data.days[0].stops.push(stop('invalid-stored','旧資料',{createdBy:'bad creator'}));
  await DB.prepare('UPDATE itineraries SET payload=?,previous=? WHERE id=?').bind(JSON.stringify(data.days),JSON.stringify(data.days),id).run();
  let loaded=await read(env,id);assert.equal(loaded.days[0].stops[0].createdBy,owner);assert.equal(loaded.previous[0].stops[0].createdBy,owner);assert.equal(loaded.days[0].stops[1].createdBy,undefined);
  data.days[0].stops[0].createdBy={email:editor};data.days[0].stops[1].createdBy=owner;
  await DB.prepare('UPDATE itineraries SET payload=?,previous=? WHERE id=?').bind(JSON.stringify(data.days),JSON.stringify(data.days),id).run();
  loaded=await read(env,id);assert.equal(loaded.days[0].stops[0].createdBy,owner);assert.equal(loaded.days[0].stops[1].createdBy,undefined);assert.equal(loaded.previous[0].stops[1].createdBy,undefined);
  await invite(env,id,'viewer@example.com','viewer');const visible=await read(env,id,'viewer@example.com');assert.equal(visible.days[0].stops[0].createdBy,owner);assert.equal(visible.previous,null);
 }finally{DB.close();}
});

test('creator lookup is snapshot-scoped, skips unchanged polls and keeps database failures separate from body validation',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  let data=await create(env);const id=data.trip.id;data.days[0].stops.push(stop('incoming'));data=await save(env,data);const lookups=[];
  const lookupDB={...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){if(sql.startsWith('SELECT stop_id,created_by FROM stop_creators')){assert.match(sql,/stop_id IN \(SELECT value FROM json_each\(\?\)\)/);lookups.push(values);}
   return prepared.bind(...values);}};}};
  const scoped={...env,DB:lookupDB};await read(scoped,id);assert.deepEqual(JSON.parse(lookups[0][1]),['incoming']);lookups.length=0;
  assert.equal((await handleApi(request(tripPath(id)+'&revision='+data.revision),scoped)).status,204);assert.equal(lookups.length,0);
  const failedDB={...DB,prepare(sql){if(sql.startsWith('SELECT stop_id,created_by FROM stop_creators'))return {bind(){return {async all(){throw Error('test ledger unavailable');}};}};return DB.prepare(sql);}};
  assert.equal((await handleApi(request(tripPath(id),'PUT',{days:[],revision:data.revision,mutationId:'invalid-body'}),{...env,DB:failedDB})).status,400);
  assert.equal((await handleApi(request(tripPath(id),'PUT',{days:data.days,revision:data.revision,mutationId:'storage-error'}),{...env,DB:failedDB})).status,503);
  assert.equal((await handleApi(request(tripPath(id)),{...env,DB:failedDB})).status,503);
 }finally{DB.close();}
});

test('additive migration backfills current and undo IDs, is repeatable, and never rewrites legacy data or tombstones',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f<'0004').sort())db.exec(fs.readFileSync('drizzle/'+file,'utf8'));
  const current=[{stops:[stop('current','Current',{createdBy:' ALICE@EXAMPLE.COM '}),stop('recover'),stop('unknown'),{name:'Synthetic ID'},stop('invalid','Invalid',{createdBy:'bad@ example.com'}),stop('object-creator','Object',{createdBy:{email:owner}}),'not JSON',null,3,{},stop('after-scalars')]}];
  const previous=[{stops:[stop('current','Old',{createdBy:editor}),stop('recover','Recovered',{createdBy:editor}),stop('deleted','Deleted',{createdBy:owner}),stop('unknown')]}];
  db.prepare('INSERT INTO itineraries(id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('migration-test',owner,'旅程','2028-01-01','2028-01-01','Asia/Taipei',JSON.stringify(current),JSON.stringify(previous),9,'old-save','old-time','old-time');
  db.prepare('INSERT INTO itineraries(id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('malformed-test',owner,'舊資料','2028-01-01','2028-01-01','Asia/Taipei','not JSON','[null,3,"not JSON",{}]',1,'old-save','old-time','old-time');
  const before=db.prepare('SELECT * FROM itineraries').all(),sql=fs.readFileSync('drizzle/0004_stop_creators.sql','utf8');db.exec(sql);db.exec(sql);
  const rows=db.prepare('SELECT stop_id,created_by FROM stop_creators WHERE trip_id=? ORDER BY stop_id').all('migration-test');const byId=Object.fromEntries(rows.map(r=>[r.stop_id,r.created_by]));
  assert.equal(byId.current,owner);assert.equal(byId.recover,editor);assert.equal(byId.deleted,owner);assert.equal(byId.unknown,null);assert.equal(byId['legacy-0-3'],null);assert.equal(byId.invalid,null);assert.equal(byId['object-creator'],null);assert.equal(byId['after-scalars'],null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stop_creators WHERE trip_id=?').get('malformed-test').count,0);
  assert.deepEqual(db.prepare('SELECT * FROM itineraries').all(),before);
  current[0].stops.find(s=>s.id==='unknown').createdBy=editor;db.prepare('UPDATE itineraries SET payload=? WHERE id=?').run(JSON.stringify(current),'migration-test');db.exec(sql);
  assert.equal(db.prepare('SELECT created_by FROM stop_creators WHERE trip_id=? AND stop_id=?').get('migration-test','unknown').created_by,null);
 }finally{db.close();}
});
