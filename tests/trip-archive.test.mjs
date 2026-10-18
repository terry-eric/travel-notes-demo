import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,handleTrips} from '../server/api.js';
import {handleSharing} from '../server/sharing.js';
import {LEGACY_TRIP_ID,ensureLegacy} from '../server/trips.js';
import {localDatabase} from '../scripts/local-db.mjs';
const origin='https://trip.example',legacy='owner@example.com',owner='alice@example.com',editor='bob@example.com',viewer='viewer@example.com';
const req=(path,method='GET',body,email=owner,extra={})=>new Request(origin+path,{method,headers:{'oai-authenticated-user-id':email,Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-2',...extra},body:body===undefined?undefined:JSON.stringify(body)});
const path=id=>'/api/trip?trip='+id,share=id=>'/api/shares?trip='+id,creation=()=>({creationId:crypto.randomUUID(),title:'旅行',startDate:'2028-01-01',endDate:'2028-01-02'});
async function create(env,body=creation(),email=owner){const r=await handleTrips(req('/api/trips','POST',body,email),env);assert.equal(r.status,201);return r.json();}
const remove=(env,id,revision,email=owner)=>handleTrips(req('/api/trips','DELETE',{id,revision,permanent:true},email),env);
const stored=(DB,id)=>DB.prepare('SELECT * FROM itineraries WHERE id=?').bind(id).first();
const marker=(DB,id)=>DB.prepare('SELECT * FROM deleted_itineraries WHERE id=?').bind(id).first();
const list=env=>handleTrips(req('/api/trips'),env).then(r=>r.json());
const race=(DB,match,action)=>({...DB,prepare(sql){const p=DB.prepare(sql);return {bind(...values){const s=p.bind(...values);if(!match(sql))return s;return {...s,async run(){await action();return s.run();}};}};}});
test('owner CAS permanent purge removes content/undo/ACL/creators and retains unrelated travel and login sessions',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const a=await create(env),id=a.trip.id,b=await create(env,creation(),editor),bBefore=await stored(DB,b.trip.id);
  a.days[0].stops.push({id:'stop-one',name:'private fixture'});assert.equal((await handleApi(req(path(id),'PUT',{days:a.days,revision:0,mutationId:'save'}),env)).status,200);
  for(const [email,role] of [[editor,'editor'],[viewer,'viewer']])assert.equal((await handleSharing(req(share(id),'PUT',{email,role,enabled:true}),env)).status,200);
  await DB.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?)').bind('synthetic-session',owner,'synthetic-subject',1,9999999999).run();
  for(const email of [editor,viewer,'stranger@example.com'])assert.equal((await remove(env,id,1,email)).status,403);
  assert.equal((await remove(env,id,0)).status,409);assert.equal(await marker(DB,id),null);
  assert.deepEqual(await(await remove(env,id,1)).json(),{ok:true,id,deleted:true,permanent:true});assert.equal(await stored(DB,id),null);
  assert.deepEqual({...await marker(DB,id)},{id,owner_email:owner,revision:1});
  for(const table of ['itinerary_members','stop_creators','deleted_stops'])assert.equal((await DB.prepare('SELECT count(*) count FROM '+table+' WHERE trip_id=?').bind(id).first()).count,0);
  assert.deepEqual(await stored(DB,b.trip.id),bBefore);assert.equal((await DB.prepare('SELECT count(*) count FROM auth_sessions').bind().first()).count,1);
  assert.deepEqual((await list(env)).trips,[]);assert.deepEqual((await list(env)).deletedTrips,[]);
  for(const email of [owner,editor,viewer])assert.equal((await handleApi(req(path(id),'GET',undefined,email),env)).status,403);
 }finally{DB.close();}
});
test('lost replies are idempotent and creation/restore/old save/direct insert cannot resurrect a purged id',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const body=creation(),a=await create(env,body),id=a.trip.id;
  assert.equal((await remove(env,id,0)).status,200);assert.equal((await remove(env,id,0)).status,200);assert.equal((await remove(env,id,0,editor)).status,403);
  assert.equal((await remove(env,id,1)).status,403);assert.equal((await handleTrips(req('/api/trips','POST',body),env)).status,409);
  assert.equal((await handleTrips(req('/api/trips','PUT',{id,revision:0,action:'restore'}),env)).status,405);
  assert.equal((await handleApi(req(path(id),'PUT',{days:a.days,revision:0,mutationId:'old-save'}),env)).status,403);
  await assert.rejects(DB.prepare("INSERT INTO itineraries (id,owner_email,title,start_date,end_date,payload,created_at,updated_at) VALUES (?,?,?,'2028-01-01','2028-01-02','[]','now','now')").bind(id,owner,'restore').run(),/cannot be recreated/);
  assert.equal((await create(env)).trip.title,'旅行');
 }finally{DB.close();}
});
test('old archived rows remain untouched and hidden while active creation capacity is available',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const a=await create(env),id=a.trip.id;
  await DB.batch(Array.from({length:99},()=>DB.prepare('INSERT INTO itineraries (id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at,deleted_at) SELECT ?,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at,? FROM itineraries WHERE id=?').bind(crypto.randomUUID(),'archived',id)));
  const before=await DB.prepare('SELECT * FROM itineraries WHERE deleted_at IS NOT NULL ORDER BY id').bind().all();
  assert.equal((await list(env)).trips.length,1);assert.deepEqual((await list(env)).deletedTrips,[]);
  await create(env);assert.deepEqual(await DB.prepare('SELECT * FROM itineraries WHERE deleted_at IS NOT NULL ORDER BY id').bind().all(),before);
  assert.equal((await DB.prepare('SELECT count(*) count FROM deleted_itineraries').bind().first()).count,0);
 }finally{DB.close();}
});
test('CAS races cannot purge newer content; in-flight content and invitation writes cannot target a purged trip',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const a=await create(env),id=a.trip.id;
  const stale=race(DB,sql=>sql.startsWith('DELETE FROM itineraries WHERE'),()=>DB.prepare('UPDATE itineraries SET revision=revision+1 WHERE id=?').bind(id).run());
  assert.equal((await remove({...env,DB:stale},id,0)).status,409);assert.equal(await marker(DB,id),null);assert.equal((await stored(DB,id)).revision,1);
  a.days[0].stops.push({id:'late-stop',name:'late'});
  const late=race(DB,sql=>sql.startsWith('UPDATE itineraries SET title=?,payload='),async()=>assert.equal((await remove(env,id,1)).status,200));
  assert.equal((await handleApi(req(path(id),'PUT',{days:a.days,revision:1,mutationId:'late'}),{...env,DB:late})).status,403);
  const b=await create(env),other=b.trip.id;
  const invite=race(DB,sql=>sql.startsWith('INSERT INTO itinerary_members '),async()=>assert.equal((await remove(env,other,0)).status,200));
  assert.equal((await handleSharing(req(share(other),'PUT',{email:editor,role:'editor',enabled:true}),{...env,DB:invite})).status,403);
  assert.equal(await DB.prepare('SELECT email FROM itinerary_members WHERE trip_id=?').bind(other).first(),null);
 }finally{DB.close();}
});
test('purge trigger failure rolls back the parent deletion, marker, invitations and creator ledger together',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const a=await create(env),id=a.trip.id;a.days[0].stops.push({id:'keep-stop',name:'keep'});
  assert.equal((await handleApi(req(path(id),'PUT',{days:a.days,revision:0,mutationId:'saved'}),env)).status,200);
  await handleSharing(req(share(id),'PUT',{email:editor,role:'editor',enabled:true}),env);const before=await stored(DB,id);
  await DB.prepare("CREATE TRIGGER synthetic_failure BEFORE DELETE ON stop_creators BEGIN SELECT RAISE(ABORT,'synthetic purge rollback'); END").bind().run();
  assert.equal((await remove(env,id,1)).status,503);assert.deepEqual(await stored(DB,id),before);assert.equal(await marker(DB,id),null);
  assert.equal((await DB.prepare('SELECT count(*) count FROM itinerary_members WHERE trip_id=?').bind(id).first()).count,1);
  assert.equal((await DB.prepare('SELECT count(*) count FROM stop_creators WHERE trip_id=?').bind(id).first()).count,1);
 }finally{DB.close();}
});
test('legacy purge erases only its recovery row and ACL and missing migration marker cannot recreate its contents',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  await DB.prepare("INSERT INTO trips VALUES (?,'[]',NULL,4,'old','now')").bind(legacy).run();
  await DB.prepare("INSERT INTO trips VALUES (?,'[]',NULL,8,'other','now')").bind(editor).run();
  await DB.prepare("INSERT INTO trip_members VALUES (?,'editor',1,'now')").bind(owner).run();await ensureLegacy(DB,legacy);
  assert.equal((await remove(env,LEGACY_TRIP_ID,4,legacy)).status,200);assert.equal(await DB.prepare('SELECT user_id FROM trips WHERE user_id=?').bind(legacy).first(),null);
  assert.equal((await DB.prepare('SELECT revision FROM trips WHERE user_id=?').bind(editor).first()).revision,8);assert.equal((await DB.prepare('SELECT count(*) count FROM trip_members').bind().first()).count,0);
  await DB.prepare("DELETE FROM app_migrations WHERE name='legacy-members-v1'").bind().run();await ensureLegacy(DB,legacy);
  assert.equal(await stored(DB,LEGACY_TRIP_ID),null);assert.equal((await handleApi(req('/api/trip','GET',undefined,legacy),env)).status,403);
 }finally{DB.close();}
});
test('permanent-deletion consent is explicit with current client, exact origin, JSON and bounded validated body',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const a=await create(env),id=a.trip.id,body={id,revision:0,permanent:true};
  for(const [extra,status] of [[{Origin:'https://evil.example'},403],[{'X-Trip-Client':'merge-1'},428],[{'Content-Type':'text/plain'},415]])assert.equal((await handleTrips(req('/api/trips','DELETE',body,owner,extra),env)).status,status);
  for(const invalid of [{id,revision:0},{...body,permanent:'true'},{...body,revision:-1},{...body,id:'bad id'}])assert.equal((await handleTrips(req('/api/trips','DELETE',invalid),env)).status,400);
  assert.equal((await handleTrips(req('/api/trips','DELETE',{...body,extra:'🧳'.repeat(1500)}),env)).status,413);assert.equal((await list(env)).trips.length,1);
 }finally{DB.close();}
});
