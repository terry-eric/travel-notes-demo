import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,handleTrips} from '../server/api.js';
import {handleSharing} from '../server/sharing.js';
import {sessionFor,ensureLegacy,LEGACY_TRIP_ID} from '../server/trips.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {seedDays} from '../public/seed.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const origin='https://trip.example',owner='owner@example.com',alice='alice@example.com',bob='bob@example.com';
function request(path='/api/trip',method='GET',body,email=owner,overrides={}){return new Request(origin+path,{method,headers:{...(email?{'oai-authenticated-user-id':email}:{}),Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-1',...overrides},body:body===undefined?undefined:JSON.stringify(body)});}
const endpoint=id=>'/api/trip?trip='+id;
const shares=id=>'/api/shares?trip='+id;
async function create(env,email,title='新旅行',startDate='2027-12-30',endDate='2028-01-02',more={}){const response=await handleTrips(request('/api/trips','POST',{title,startDate,endDate,...more},email),env);assert.equal(response.status,201);return response.json();}
const stop=(name,id='stop-one')=>({id,name,time:'09:00',q:'Taipei Main Station',tag:'交通',desc:'',mode:'walking',duration:15});

test('each signed-in account creates independent calendar trips; cross-year and leap dates are authoritative',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  assert.deepEqual((await(await handleTrips(request('/api/trips','GET',undefined,alice),env)).json()).trips,[]);
  const a=await create(env,alice),b=await create(env,bob,'東京','2028-02-28','2028-03-01',{timezone:'Asia/Tokyo'});
  assert.equal(a.days.length,4);assert.deepEqual(a.days.map(day=>day.isoDate),['2027-12-30','2027-12-31','2028-01-01','2028-01-02']);assert.equal(a.days[0].week,'週四');assert.equal(a.trip.timezone,'Asia/Taipei');
  assert.deepEqual(b.days.map(day=>day.isoDate),['2028-02-28','2028-02-29','2028-03-01']);assert.equal(b.trip.timezone,'Asia/Tokyo');
  a.days[0].stops.push(stop('台北車站'));a.days[0].date='evil';a.days[0].color='url(evil)';a.days[0].isoDate='1999-01-01';
  const saved=await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:0,mutationId:'first-save',trip:{title:'改名的旅行'}},alice),env);assert.equal(saved.status,200);
  const data=await(await handleApi(request(endpoint(a.trip.id),'GET',undefined,alice),env)).json();assert.equal(data.trip.title,'改名的旅行');assert.equal(data.days[0].date,'12/30');assert.equal(data.days[0].isoDate,'2027-12-30');assert.match(data.days[0].color,/^#[a-f0-9]{6}$/);assert.equal(data.days[0].stops[0].name,'台北車站');assert.equal(data.previous[0].stops.length,0);
  assert.equal((await handleApi(request(endpoint(a.trip.id),'GET',undefined,bob),env)).status,403);
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:1,mutationId:'steal'},bob),env)).status,403);
  assert.equal((await handleApi(request('/api/trip','GET',undefined,alice),env)).status,403);
  const list=await(await handleTrips(request('/api/trips','GET',undefined,alice),env)).json();assert.equal(list.trips.length,1);assert.equal(list.trips[0].role,'owner');assert.equal(list.trips[0].canShare,true);assert.equal(list.trips[0].revision,1);
  assert.equal((await sessionFor(request('/api/session','GET',undefined,alice),env)).status,200);assert.equal((await(await sessionFor(request('/api/session?trip='+a.trip.id,'GET',undefined,alice),env)).json()).trip.id,a.trip.id);
 }finally{DB.close();}
});

test('invites are trip-scoped, editors share CAS, viewers have no previous snapshot, and revocation is immediate',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  const a=await create(env,alice),b=await create(env,bob,'自己的行程');
  for(const [email,role] of [[bob,'editor'],['viewer@example.com','viewer']])assert.equal((await handleSharing(request(shares(a.trip.id),'PUT',{email,role,enabled:true},alice),env)).status,200);
  assert.equal((await handleSharing(request(shares(a.trip.id),'GET',undefined,bob),env)).status,403);
  assert.equal((await handleSharing(request(shares(b.trip.id),'PUT',{email:alice,role:'editor',enabled:true},alice),env)).status,403);
  a.days[0].stops.push(stop('共同編輯'));
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:0,mutationId:'bob-edit'},bob),env)).status,200);
  const viewer=await(await handleApi(request(endpoint(a.trip.id),'GET',undefined,'viewer@example.com'),env)).json();assert.equal(viewer.previous,null);assert.equal(viewer.days[0].stops[0].name,'共同編輯');
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:1,mutationId:'viewer-edit'},'viewer@example.com'),env)).status,403);
  assert.equal((await handleApi(request(endpoint(a.trip.id)+'&revision=1','GET',undefined,bob),env)).status,204);
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:0,mutationId:'stale'},alice),env)).status,409);
  const retry=await(await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:0,mutationId:'bob-edit'},bob),env)).json();assert.equal(retry.revision,1);
  await handleSharing(request(shares(a.trip.id),'PUT',{email:bob,role:'editor',enabled:false},alice),env);
  assert.equal((await handleApi(request(endpoint(a.trip.id)+'&revision=1','GET',undefined,bob),env)).status,403);
  assert.equal((await sessionFor(request('/api/session?trip='+a.trip.id,'GET',undefined,bob),env)).status,403);
  const list=await(await handleTrips(request('/api/trips','GET',undefined,bob),env)).json();assert.deepEqual(list.trips.map(t=>t.id),[b.trip.id]);
  assert.equal((await handleApi(request(endpoint(b.trip.id),'GET',undefined,bob),env)).status,200);
 }finally{DB.close();}
});

test('legacy migration preserves data, revision, undo and membership exactly and is idempotent',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  const days=structuredClone(seedDays);days[0].stops[0].name='已安排好的北海道旅行';
  await DB.prepare('INSERT INTO trips (user_id,payload,previous,revision,mutation_id,updated_at) VALUES (?,?,?,?,?,?)').bind(owner,JSON.stringify(days),JSON.stringify(seedDays),9,'old-mutation','old-time').run();
  await DB.prepare('INSERT INTO trip_members (email,role,enabled,updated_at) VALUES (?,?,?,?)').bind(bob,'editor',1,'old-time').run();
  await ensureLegacy(DB,owner);await ensureLegacy(DB,owner);
  let data=await(await handleApi(request(),env)).json();assert.equal(data.trip.id,LEGACY_TRIP_ID);assert.equal(data.trip.timezone,'Asia/Tokyo');assert.equal(data.revision,9);assert.equal(data.days[0].stops[0].name,days[0].stops[0].name);assert.equal(data.previous[0].stops[0].name,seedDays[0].stops[0].name);
  assert.equal((await handleApi(request('/api/trip','GET',undefined,bob),env)).status,200);
  await handleSharing(request('/api/shares','PUT',{email:bob,role:'editor',enabled:false}),env);await ensureLegacy(DB,owner);
  assert.equal((await handleApi(request('/api/trip','GET',undefined,bob),env)).status,403);
  const row=await DB.prepare('SELECT payload,revision FROM trips WHERE user_id=?').bind(owner).first();assert.equal(row.revision,9);assert.equal(JSON.parse(row.payload)[0].stops[0].name,days[0].stops[0].name);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM itineraries WHERE id=?').bind(LEGACY_TRIP_ID).first()).count,1);
  await assert.rejects(DB.prepare('UPDATE trips SET revision=10 WHERE user_id=?').bind(owner).run(),/read-only/);
  await assert.rejects(DB.prepare('UPDATE trip_members SET enabled=1 WHERE email=?').bind(bob).run(),/read-only/);
 }finally{DB.close();}
});

test('mutations require current client, exact origin, JSON, bounded body, valid calendar and immutable dates',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  const body={title:'旅行',startDate:'2027-01-01',endDate:'2027-01-02'};
  assert.equal((await handleTrips(request('/api/trips','POST',body,alice,{Origin:'https://evil.example'}),env)).status,403);
  assert.equal((await handleTrips(request('/api/trips','POST',body,alice,{Origin:''}),env)).status,403);
  assert.equal((await handleTrips(request('/api/trips','POST',body,alice,{'Content-Type':'text/plain'}),env)).status,415);
  assert.equal((await handleTrips(request('/api/trips','POST',body,alice,{'X-Trip-Client':'merge-1'}),env)).status,428);
  assert.equal((await handleTrips(request('/api/trips','POST',{...body,extra:'🧳'.repeat(1500)},alice),env)).status,413);
  for(const values of [{startDate:'2027-02-29'},{startDate:'2027-01-03'},{endDate:'2027-03-02'},{timezone:'fake/zone'},{title:' '}])assert.equal((await handleTrips(request('/api/trips','POST',{...body,...values},alice),env)).status,400);
  const a=await create(env,alice,'兩個月','2027-01-01','2027-03-01');assert.equal(a.days.length,60);
  const write={days:a.days,revision:0,mutationId:'write'};
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',write,alice,{'X-Trip-Client':'merge-1'}),env)).status,428);
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',{...write,days:a.days.slice(1)},alice),env)).status,400);
  assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',{...write,trip:{startDate:'2027-01-02'}},alice),env)).status,400);
  a.days[0].stops.push(stop('惡意識別碼','" onfocus=evil'));assert.equal((await handleApi(request(endpoint(a.trip.id),'PUT',write,alice),env)).status,400);
  assert.equal((await handleApi(request(endpoint('unknown-trip-id'),'GET',undefined,alice),env)).status,403);
  assert.equal((await handleTrips(request('/api/trips','GET',undefined,null),env)).status,401);
 }finally{DB.close();}
});

test('creation requests are idempotent by owner-bound UUID and cannot expose another owner trip',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  const creationId=crypto.randomUUID(),body={creationId,title:'只建立一次',startDate:'2027-01-01',endDate:'2027-01-01'};
  const responses=await Promise.all([handleTrips(request('/api/trips','POST',body,alice),env),handleTrips(request('/api/trips','POST',body,alice),env)]);assert.ok(responses.every(r=>[200,201].includes(r.status)));
  assert.equal((await(await handleTrips(request('/api/trips','GET',undefined,alice),env)).json()).trips.length,1);
  assert.equal((await handleTrips(request('/api/trips','POST',body,bob),env)).status,409);
 }finally{DB.close();}
});

test('reapplying schema migration preserves new edits and cannot re-enable a revoked legacy invite',async()=>{
 const filename=path.join(os.tmpdir(),'trip-migration-'+crypto.randomUUID()+'.sqlite');let DB=localDatabase(filename);
 try{
  await DB.prepare('INSERT INTO trips (user_id,payload,previous,revision,mutation_id,updated_at) VALUES (?,?,?,?,?,?)').bind(owner,JSON.stringify(seedDays),null,4,'last-old-save','old-time').run();
  await DB.prepare('INSERT INTO trip_members (email,role,enabled,updated_at) VALUES (?,?,?,?)').bind(bob,'editor',1,'old-time').run();
  await ensureLegacy(DB,owner);
  const env={DB,OWNER_EMAIL:owner},data=await(await handleApi(request(),env)).json();data.days[0].stops[0].name='切換後的新修改';
  assert.equal((await handleApi(request('/api/trip','PUT',{days:data.days,revision:4,mutationId:'new-save'}),env)).status,200);
  await handleSharing(request('/api/shares','PUT',{email:bob,role:'editor',enabled:false}),env);
  DB.close();DB=localDatabase(filename);
  const loaded=await(await handleApi(request(),{DB,OWNER_EMAIL:owner})).json();assert.equal(loaded.revision,5);assert.equal(loaded.days[0].stops[0].name,'切換後的新修改');
  assert.equal((await handleApi(request('/api/trip','GET',undefined,bob),{DB,OWNER_EMAIL:owner})).status,403);
  assert.equal((await DB.prepare('SELECT revision FROM trips WHERE user_id=?').bind(owner).first()).revision,4);
 }finally{DB.close();fs.rmSync(filename,{force:true});}
});

test('an editor downgraded while saving cannot write even after the initial access read',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  const a=await create(env,alice);await handleSharing(request(shares(a.trip.id),'PUT',{email:bob,role:'editor',enabled:true},alice),env);
  a.days[0].stops.push(stop('不應儲存'));
  const race={...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){const statement=prepared.bind(...values);if(!sql.startsWith('UPDATE itineraries SET'))return statement;return {...statement,async run(){await DB.prepare("UPDATE itinerary_members SET role='viewer' WHERE trip_id=? AND email=?").bind(a.trip.id,bob).run();return statement.run();}};}};}};
  const result=await handleApi(request(endpoint(a.trip.id),'PUT',{days:a.days,revision:0,mutationId:'race-write'},bob),{...env,DB:race});assert.equal(result.status,403);
  const loaded=await(await handleApi(request(endpoint(a.trip.id),'GET',undefined,alice),env)).json();assert.equal(loaded.revision,0);assert.equal(loaded.days[0].stops.length,0);
 }finally{DB.close();}
});

test('an unchanged revision poll reports permission downgrades without returning trip data',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner};try{
  const a=await create(env,alice);
  await handleSharing(request(shares(a.trip.id),'PUT',{email:bob,role:'editor',enabled:true},alice),env);
  const before=await handleApi(request(endpoint(a.trip.id)+'&revision=0','GET',undefined,bob),env);assert.equal(before.status,204);assert.equal(before.headers.get('X-Trip-Role'),'editor');
  await handleSharing(request(shares(a.trip.id),'PUT',{email:bob,role:'viewer',enabled:true},alice),env);
  const after=await handleApi(request(endpoint(a.trip.id)+'&revision=0','GET',undefined,bob),env);assert.equal(after.status,204);assert.equal(after.headers.get('X-Trip-Role'),'viewer');assert.equal(await after.text(),'');
  const snapshot=await(await handleApi(request(endpoint(a.trip.id),'GET',undefined,bob),env)).json();assert.equal(snapshot.role,'viewer');assert.equal(snapshot.previous,null);
  const owned=await(await handleApi(request(endpoint(a.trip.id),'GET',undefined,alice),env)).json();assert.equal(owned.role,'owner');
 }finally{DB.close();}
});
