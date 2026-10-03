import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,handleTrips} from '../server/api.js';
import {handleSharing} from '../server/sharing.js';
import {localDatabase} from '../scripts/local-db.mjs';
const origin='https://trip.example',owner='alice@example.com',editor='editor@example.com',viewer='viewer@example.com',legacy='owner@example.com';
const request=(path,method='GET',body,email=owner,extra={})=>new Request(origin+path,{method,headers:{'oai-authenticated-user-id':email,Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-1',...extra},body:body===undefined?undefined:JSON.stringify(body)});
const tripPath=id=>'/api/trip?trip='+id;
async function create(env,email=owner){const response=await handleTrips(request('/api/trips','POST',{title:'原始旅程',startDate:'2028-01-01',endDate:'2028-01-02'},email),env);assert.equal(response.status,201);return response.json();}
const rename=(env,id,title='新的旅行名稱',baseTitle='原始旅程',revision=0,mutationId='rename-one',email=owner)=>handleTrips(request('/api/trips','PATCH',{id,title,baseTitle,revision,mutationId},email),env);
const stored=(DB,id)=>DB.prepare('SELECT * FROM itineraries WHERE id=?').bind(id).first();

test('title-only renames persist in snapshots and catalogues while content, undo, dates, timezone and memberships remain unchanged',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id;initial.days[0].stops.push({id:'hotel',name:'旅館',time:'15:00',desc:'已規劃的備註',tag:'住宿',q:'台北車站',duration:60,mode:'transit'});
  await handleApi(request(tripPath(id),'PUT',{days:initial.days,revision:0,mutationId:'days-before-rename'}),env);
  await handleSharing(request('/api/shares?trip='+id,'PUT',{email:editor,role:'editor',enabled:true}),env);
  const before=await stored(DB,id),membersBefore=await DB.prepare('SELECT * FROM itinerary_members WHERE trip_id=?').bind(id).all();
  const response=await rename(env,id,'  東京春日旅行  ','原始旅程',1);assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.trip.title,'東京春日旅行');assert.equal(result.revision,2);assert.equal(result.role,'owner');assert.equal(result.days,undefined);
  const after=await stored(DB,id);for(const field of ['payload','previous','start_date','end_date','timezone','owner_email','created_at','mutation_id','deleted_at'])assert.equal(after[field],before[field],field+' unchanged');assert.equal(after.revision,before.revision+1);
  assert.deepEqual(await DB.prepare('SELECT * FROM itinerary_members WHERE trip_id=?').bind(id).all(),membersBefore);
  const loaded=await(await handleApi(request(tripPath(id)),env)).json();assert.equal(loaded.trip.title,'東京春日旅行');assert.equal(loaded.days[0].stops[0].desc,'已規劃的備註');assert.equal(loaded.previous[0].stops.length,0);
  const list=await(await handleTrips(request('/api/trips'),env)).json();assert.equal(list.trips.find(trip=>trip.id===id).title,'東京春日旅行');assert.equal(list.trips.find(trip=>trip.id===id).revision,2);
 }finally{DB.close();}
});

test('active owners and invited editors can rename; viewers, revoked emails, strangers and archived trips cannot',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id,other=await create(env,'other@example.com');
  for(const [email,role,enabled] of [[editor,'editor',true],[viewer,'viewer',true],['revoked@example.com','editor',false]])await handleSharing(request('/api/shares?trip='+id,'PUT',{email,role,enabled}),env);
  for(const email of [viewer,'revoked@example.com','stranger@example.com'])assert.equal((await rename(env,id,'原始旅程','原始旅程',0,'role-check',email)).status,403);
  assert.equal((await rename(env,other.trip.id)).status,403);
  const shared=await rename(env,id,'共同編輯的名稱','原始旅程',0,'editor-rename',editor);assert.equal(shared.status,200);assert.equal((await shared.json()).role,'editor');
  await handleSharing(request('/api/shares?trip='+id,'PUT',{email:editor,role:'editor',enabled:false}),env);
  assert.equal((await rename(env,id,'編輯者已撤銷','共同編輯的名稱',1,'revoked-write',editor)).status,403);
  assert.equal((await handleTrips(request('/api/trips','DELETE',{id,revision:1}),env)).status,200);
  assert.equal((await rename(env,id,'刪除後的新名稱','共同編輯的名稱',2,'archived-write')).status,403);
  assert.equal((await stored(DB,id)).title,'共同編輯的名稱');
 }finally{DB.close();}
});

test('a stale rename merges concurrent day changes but conflicting titles and future revisions require a choice',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id;initial.days[1].stops.push({id:'coffee',name:'咖啡館',time:'11:00'});
  assert.equal((await handleApi(request(tripPath(id),'PUT',{days:initial.days,revision:0,mutationId:'remote-days'}),env)).status,200);
  const merged=await rename(env,id,'保留行程的新名稱','原始旅程',0,'stale-title');assert.equal(merged.status,200);assert.equal((await merged.json()).revision,2);
  assert.equal((await(await handleApi(request(tripPath(id)),env)).json()).days[1].stops[0].name,'咖啡館');
  const conflict=await rename(env,id,'我的另一個名稱','原始旅程',0,'conflicting-title');assert.equal(conflict.status,409);const latest=await conflict.json();assert.equal(latest.trip.title,'保留行程的新名稱');assert.equal(latest.revision,2);
  const chosen=await rename(env,id,'我的另一個名稱',latest.trip.title,latest.revision,'explicit-choice');assert.equal(chosen.status,200);assert.equal((await chosen.json()).revision,3);
  assert.equal((await rename(env,id,'未來版本','我的另一個名稱',999,'future-revision')).status,409);
  assert.equal((await rename(env,id,'我的另一個名稱','我的另一個名稱',999,'future-same-name')).status,409);
 }finally{DB.close();}
});

test('rename retries and already completed titles do not add revisions or overwrite a newer title',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id;
  assert.equal((await rename(env,id,'新名稱','原始旅程',0,'lost-reply')).status,200);
  assert.equal((await rename(env,id,'新名稱','原始旅程',0,'lost-reply')).status,200);assert.equal((await stored(DB,id)).revision,1);
  assert.equal((await rename(env,id,'新名稱','原始旅程',0,'different-request-same-title')).status,200);assert.equal((await stored(DB,id)).revision,1);
  assert.equal((await rename(env,id,'更新的雲端名稱','新名稱',1,'another-title')).status,200);
  const retry=await rename(env,id,'新名稱','原始旅程',0,'lost-reply');assert.equal(retry.status,409);assert.equal((await retry.json()).trip.title,'更新的雲端名稱');assert.equal((await stored(DB,id)).revision,2);
 }finally{DB.close();}
});

test('lost-reply day saves remain idempotent after renaming and retain their original undo snapshot',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id;initial.days[0].stops.push({id:'day-save',name:'不能重複儲存的行程',time:'09:00'});
  const body={days:initial.days,revision:0,mutationId:'lost-days-reply'};const saved=await(await handleApi(request(tripPath(id),'PUT',body),env)).json();assert.equal(saved.revision,1);
  assert.equal((await rename(env,id,'更名後的旅行','原始旅程',1,'title-after-days')).status,200);
  const retried=await handleApi(request(tripPath(id),'PUT',body),env);assert.equal(retried.status,200);const data=await retried.json();assert.equal(data.revision,2);assert.equal(data.trip.title,'更名後的旅行');assert.deepEqual(data.previous,saved.previous);assert.equal(data.previous[0].stops.length,0);assert.equal((await stored(DB,id)).mutation_id,'lost-days-reply');
 }finally{DB.close();}
});

test('rename retries CAS after an in-flight day edit and detects in-flight title changes',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id;let raced=false;
  const racing=(action)=>({...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){const statement=prepared.bind(...values);if(!sql.startsWith('UPDATE itineraries SET title=?,revision='))return statement;return {...statement,async run(){if(!raced){raced=true;await action();}return statement.run();}};}};}});
  const withDay=racing(()=>DB.prepare('UPDATE itineraries SET revision=revision+1 WHERE id=?').bind(id).run());const updated=await rename({...env,DB:withDay},id);assert.equal(updated.status,200);assert.equal((await updated.json()).revision,2);
  raced=false;const withTitle=racing(()=>DB.prepare("UPDATE itineraries SET title='競爭者名稱',revision=revision+1 WHERE id=?").bind(id).run());const conflicted=await rename({...env,DB:withTitle},id,'我想要的名称','新的旅行名稱',2,'race-title');assert.equal(conflicted.status,409);assert.equal((await conflicted.json()).trip.title,'競爭者名稱');
 }finally{DB.close();}
});

test('atomic active and role guards block a rename if the trip is archived or editor is downgraded after its access read',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id;await handleSharing(request('/api/shares?trip='+id,'PUT',{email:editor,role:'editor',enabled:true}),env);
  const racing=action=>({...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){const statement=prepared.bind(...values);if(!sql.startsWith('UPDATE itineraries SET title=?,revision='))return statement;return {...statement,async run(){await action();return statement.run();}};}};}});
  const downgrade=racing(()=>DB.prepare("UPDATE itinerary_members SET role='viewer' WHERE trip_id=? AND email=?").bind(id,editor).run());assert.equal((await rename({...env,DB:downgrade},id,'不可寫入','原始旅程',0,'downgrade-race',editor)).status,403);assert.equal((await stored(DB,id)).revision,0);assert.equal((await stored(DB,id)).title,'原始旅程');
  const archive=racing(()=>DB.prepare("UPDATE itineraries SET deleted_at='archived',revision=revision+1 WHERE id=?").bind(id).run());assert.equal((await rename({...env,DB:archive},id,'刪除後不可寫入','原始旅程',0,'archive-race')).status,403);assert.equal((await stored(DB,id)).title,'原始旅程');
 }finally{DB.close();}
});

test('rename validates current client, exact origin, JSON size, title, base title, revision and safe mutation identifiers',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy};try{
  const initial=await create(env),id=initial.trip.id,body={id,title:'新名稱',baseTitle:'原始旅程',revision:0,mutationId:'valid-request'};
  assert.equal((await handleTrips(request('/api/trips','PATCH',body,owner,{'X-Trip-Client':'merge-1'}),env)).status,428);
  assert.equal((await handleTrips(request('/api/trips','PATCH',body,owner,{Origin:'https://evil.example'}),env)).status,403);
  assert.equal((await handleTrips(request('/api/trips','PATCH',body,owner,{Origin:''}),env)).status,403);
  assert.equal((await handleTrips(request('/api/trips','PATCH',body,owner,{'Content-Type':'text/plain'}),env)).status,415);
  assert.equal((await handleTrips(request('/api/trips','PATCH',{...body,extra:'🧳'.repeat(1500)}),env)).status,413);
  for(const extra of [{title:' '},{title:'x'.repeat(121)},{title:null},{baseTitle:''},{baseTitle:4},{revision:-1},{revision:1.5},{id:'bad id'},{mutationId:''},{mutationId:'bad id'},{mutationId:'x'.repeat(81)}])assert.equal((await handleTrips(request('/api/trips','PATCH',{...body,...extra}),env)).status,400);
  assert.equal((await stored(DB,id)).revision,0);assert.equal((await stored(DB,id)).title,'原始旅程');
 }finally{DB.close();}
});
