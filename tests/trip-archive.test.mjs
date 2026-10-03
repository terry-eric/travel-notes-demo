import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,handleTrips} from '../server/api.js';
import {handleSharing} from '../server/sharing.js';
import {sessionFor,LEGACY_TRIP_ID,ensureLegacy} from '../server/trips.js';
import {localDatabase} from '../scripts/local-db.mjs';
const origin='https://trip.example',legacyOwner='owner@example.com',alice='alice@example.com',bob='bob@example.com',viewer='viewer@example.com',revoked='revoked@example.com';
const request=(path,method='GET',body,email=alice,extra={})=>new Request(origin+path,{method,headers:{'oai-authenticated-user-id':email,Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-1',...extra},body:body===undefined?undefined:JSON.stringify(body)});
const tripPath=id=>'/api/trip?trip='+id,sharePath=id=>'/api/shares?trip='+id;
const bodyFor=(extra={})=>({creationId:crypto.randomUUID(),title:'我的旅行',startDate:'2028-01-01',endDate:'2028-01-02',...extra});
async function create(env,body=bodyFor(),email=alice){const response=await handleTrips(request('/api/trips','POST',body,email),env);assert.equal(response.status,201);return response.json();}
const catalogue=(env,email=alice)=>handleTrips(request('/api/trips','GET',undefined,email),env).then(r=>r.json());
const remove=(env,id,revision,email=alice)=>handleTrips(request('/api/trips','DELETE',{id,revision},email),env);
const restore=(env,id,revision,email=alice)=>handleTrips(request('/api/trips','PUT',{id,action:'restore',revision},email),env);

test('only the owner can archive and recover a trip; data and enabled invitations survive recovery',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacyOwner};try{
  const created=await create(env);const id=created.trip.id;
  created.days[0].stops.push({id:'saved-stop',name:'旅館',time:'14:00',q:'台北車站',tag:'住宿',desc:'保留的備註',mode:'transit',duration:60});
  const saved=await(await handleApi(request(tripPath(id),'PUT',{days:created.days,revision:0,mutationId:'save-before-delete'}),env)).json();
  for(const [email,role,enabled] of [[bob,'editor',true],[viewer,'viewer',true],[revoked,'editor',false]])assert.equal((await handleSharing(request(sharePath(id),'PUT',{email,role,enabled}),env)).status,200);
  for(const stranger of [bob,viewer,revoked,'stranger@example.com']){
   assert.equal((await remove(env,id,1,stranger)).status,403);assert.equal((await restore(env,id,1,stranger)).status,403);
  }
  assert.equal((await remove(env,id,0)).status,409);
  assert.deepEqual(await(await remove(env,id,1)).json(),{ok:true,id,deleted:true});
  const own=await catalogue(env);assert.equal(own.trips.length,0);assert.equal(own.deletedTrips.length,1);assert.equal(own.deletedTrips[0].id,id);assert.equal(own.deletedTrips[0].revision,2);assert.match(own.deletedTrips[0].deletedAt,/^\d{4}-/);
  for(const email of [alice,bob,viewer]){
   assert.equal((await handleApi(request(tripPath(id),'GET',undefined,email),env)).status,403);
   assert.equal((await handleApi(request(tripPath(id)+'&revision=2','GET',undefined,email),env)).status,403);
   assert.equal((await sessionFor(request('/api/session?trip='+id,'GET',undefined,email),env)).status,403);
   assert.equal((await handleSharing(request(sharePath(id),'GET',undefined,email),env)).status,403);
   assert.equal((await handleApi(request(tripPath(id),'PUT',{days:saved.days,revision:2,mutationId:'resurrect-write'},email),env)).status,403);
  }
  assert.deepEqual((await catalogue(env,bob)).deletedTrips,[]);assert.deepEqual((await catalogue(env,bob)).trips,[]);
  assert.equal((await restore(env,id,1)).status,409);
  assert.deepEqual(await(await restore(env,id,2)).json(),{ok:true,id,deleted:false});
  const data=await(await handleApi(request(tripPath(id)),env)).json();assert.equal(data.revision,3);assert.deepEqual(data.days,saved.days);assert.deepEqual(data.previous,saved.previous);
  assert.equal((await handleApi(request(tripPath(id),'GET',undefined,bob),env)).status,200);
  assert.equal((await(await handleApi(request(tripPath(id),'GET',undefined,viewer),env)).json()).previous,null);
  assert.equal((await handleApi(request(tripPath(id),'GET',undefined,revoked),env)).status,403);
  assert.equal((await catalogue(env)).deletedTrips.length,0);
 }finally{DB.close();}
});

test('lost replies are safe to retry, archived creation retries do not restore, and stale recovery cannot undo a later deletion',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacyOwner};try{
  const body=bodyFor(),created=await create(env,body),id=created.trip.id;
  assert.equal((await remove(env,id,0)).status,200);assert.equal((await remove(env,id,0)).status,200);assert.equal((await catalogue(env)).deletedTrips[0].revision,1);
  const retry=await handleTrips(request('/api/trips','POST',body),env);assert.equal(retry.status,409);assert.match((await retry.json()).error,/已刪除/);
  assert.equal((await restore(env,id,1)).status,200);assert.equal((await restore(env,id,1)).status,200);assert.equal((await catalogue(env)).trips[0].revision,2);
  assert.equal((await remove(env,id,0)).status,409);assert.equal((await remove(env,id,2)).status,200);
  assert.equal((await restore(env,id,1)).status,409);assert.equal((await catalogue(env)).deletedTrips[0].revision,3);
 }finally{DB.close();}
});

test('archive frees active capacity and restore respects the atomic 100 active trip limit',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacyOwner};try{
  const first=await create(env),id=first.trip.id;
  const inserts=Array.from({length:99},()=>DB.prepare('INSERT INTO itineraries (id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) SELECT ?,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at FROM itineraries WHERE id=?').bind(crypto.randomUUID(),id));await DB.batch(inserts);
  assert.equal((await catalogue(env)).trips.length,100);
  assert.equal((await handleTrips(request('/api/trips','POST',bodyFor()),env)).status,400);
  assert.equal((await remove(env,id,0)).status,200);const replacement=await create(env);assert.equal((await catalogue(env)).trips.length,100);
  assert.equal((await restore(env,id,1)).status,400);assert.equal((await catalogue(env)).deletedTrips[0].id,id);
  assert.equal((await remove(env,replacement.trip.id,0)).status,200);assert.equal((await restore(env,id,1)).status,200);assert.equal((await catalogue(env)).trips.length,100);
 }finally{DB.close();}
});

test('in-flight content and invite writes cannot mutate an archived trip after their access read',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacyOwner};try{
  const created=await create(env),id=created.trip.id;
  const withRace=match=>({...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){const statement=prepared.bind(...values);if(!match(sql))return statement;return {...statement,async run(){await DB.prepare("UPDATE itineraries SET deleted_at='archived',revision=revision+1,mutation_id='' WHERE id=?").bind(id).run();return statement.run();}};}};}});
  created.days[0].stops.push({id:'must-not-save',name:'不應儲存',time:'09:00'});
  const contentRace=await handleApi(request(tripPath(id),'PUT',{days:created.days,revision:0,mutationId:'late-save'}),{...env,DB:withRace(sql=>sql.startsWith('UPDATE itineraries SET title='))});assert.equal(contentRace.status,403);
  const row=await DB.prepare('SELECT payload,revision FROM itineraries WHERE id=?').bind(id).first();assert.equal(row.revision,1);assert.equal(JSON.parse(row.payload)[0].stops.length,0);
  assert.equal((await restore(env,id,1)).status,200);
  const inviteRace=await handleSharing(request(sharePath(id),'PUT',{email:bob,role:'editor',enabled:true}),{...env,DB:withRace(sql=>sql.startsWith('INSERT INTO itinerary_members '))});assert.equal(inviteRace.status,403);
  assert.equal(await DB.prepare('SELECT email FROM itinerary_members WHERE trip_id=? AND email=?').bind(id,bob).first(),null);
 }finally{DB.close();}
});

test('delete and recovery enforce exact origin, current client, JSON format and bounded validated bodies',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacyOwner};try{
  const created=await create(env),id=created.trip.id,body={id,revision:0};
  for(const method of ['DELETE','PUT']){
   const data=method==='PUT'?{...body,action:'restore'}:body;
   assert.equal((await handleTrips(request('/api/trips',method,data,alice,{Origin:'https://evil.example'}),env)).status,403);
   assert.equal((await handleTrips(request('/api/trips',method,data,alice,{'X-Trip-Client':'merge-1'}),env)).status,428);
   assert.equal((await handleTrips(request('/api/trips',method,data,alice,{'Content-Type':'text/plain'}),env)).status,415);
   assert.equal((await handleTrips(request('/api/trips',method,{...data,extra:'🧳'.repeat(1500)}),env)).status,413);
   assert.equal((await handleTrips(request('/api/trips',method,{...data,revision:-1}),env)).status,400);
   assert.equal((await handleTrips(request('/api/trips',method,{...data,id:'bad id'}),env)).status,400);
  }
  assert.equal((await handleTrips(request('/api/trips','PUT',{...body,action:'remove'}),env)).status,400);
  assert.equal((await restore(env,'unknown-id',0)).status,403);
  assert.equal((await catalogue(env)).trips.length,1);
 }finally{DB.close();}
});

test('archiving the legacy trip remains archived across initialization and recovers its original content',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacyOwner};try{
  const before=await(await handleApi(request('/api/trip','GET',undefined,legacyOwner),env)).json();assert.equal(before.trip.id,LEGACY_TRIP_ID);
  assert.equal((await remove(env,LEGACY_TRIP_ID,0,legacyOwner)).status,200);await ensureLegacy(DB,legacyOwner);
  assert.equal((await handleApi(request('/api/trip','GET',undefined,legacyOwner),env)).status,403);
  const own=await catalogue(env,legacyOwner);assert.equal(own.trips.length,0);assert.equal(own.deletedTrips[0].id,LEGACY_TRIP_ID);
  assert.equal((await restore(env,LEGACY_TRIP_ID,1,legacyOwner)).status,200);
  const recovered=await(await handleApi(request('/api/trip','GET',undefined,legacyOwner),env)).json();assert.deepEqual(recovered.days,before.days);assert.equal(recovered.revision,2);
 }finally{DB.close();}
});
