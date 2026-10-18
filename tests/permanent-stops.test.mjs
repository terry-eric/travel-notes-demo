import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,handleTrips} from '../server/api.js';
import {handleSharing} from '../server/sharing.js';
import {localDatabase} from '../scripts/local-db.mjs';
const origin='https://trip.example',owner='alice@example.com',editor='bob@example.com',viewer='viewer@example.com',legacy='owner@example.com';
const req=(path,method='GET',body,email=owner)=>new Request(origin+path,{method,headers:{'oai-authenticated-user-id':email,Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-2'},body:body===undefined?undefined:JSON.stringify(body)});
const path=id=>'/api/trip?trip='+id,stored=(DB,id)=>DB.prepare('SELECT payload,previous,revision,mutation_id FROM itineraries WHERE id=?').bind(id).first();
async function setup(){
 const DB=localDatabase(),env={DB,OWNER_EMAIL:legacy},created=await(await handleTrips(req('/api/trips','POST',{title:'fixture',startDate:'2028-01-01',endDate:'2028-01-02'}),env)).json(),id=created.trip.id;
 created.days[0].stops=[{id:'remove-me',name:'私密測試',time:'10:00',createdBy:owner,desc:'synthetic-deleted-content'},{id:'preserve-flight',name:'synthetic flight',kind:'flight',flight:{privateFixture:'synthetic private object'},customFixture:{keep:true},createdBy:owner}];
 created.days[1].stops=[{id:'elsewhere',name:'其他站',createdBy:editor}];
 await DB.prepare('UPDATE itineraries SET payload=?,previous=? WHERE id=?').bind(JSON.stringify(created.days),JSON.stringify(created.days),id).run();
 for(const [email,role] of [[editor,'editor'],[viewer,'viewer']])assert.equal((await handleSharing(req('/api/shares?trip='+id,'PUT',{email,role,enabled:true}),env)).status,200);
 return {DB,env,id,created};
}
const deletion=(revision=0,more={})=>({revision,mutationId:'permanent-stop-delete',permanent:true,deleteStopId:'remove-me',...more});
test('an editor permanently deletes a stop from current and undo without touching surviving private/flight fields or attribution',async()=>{
 const {DB,env,id,created}=await setup();try{
  const response=await handleApi(req(path(id),'PUT',deletion(),editor),env);assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.permanent,true);assert.equal(data.deletedStopId,'remove-me');assert.equal(data.revision,1);
  assert.equal(data.days.flatMap(day=>day.stops).some(s=>s.id==='remove-me'),false);assert.equal(data.previous.flatMap(day=>day.stops).some(s=>s.id==='remove-me'),false);
  assert.deepEqual(data.days[0].stops[0].flight,created.days[0].stops[1].flight);assert.deepEqual(data.days[0].stops[0].customFixture,{keep:true});
  const record=await stored(DB,id);assert.equal(record.payload.includes('synthetic-deleted-content'),false);assert.equal(record.previous.includes('synthetic-deleted-content'),false);
  assert.equal(await DB.prepare('SELECT created_by FROM stop_creators WHERE trip_id=? AND stop_id=?').bind(id,'remove-me').first(),null);
  assert.equal((await DB.prepare('SELECT created_by FROM stop_creators WHERE trip_id=? AND stop_id=?').bind(id,'preserve-flight').first()).created_by,owner);
  assert.deepEqual({...await DB.prepare('SELECT * FROM deleted_stops WHERE trip_id=?').bind(id).first()},{trip_id:id,stop_id:'remove-me'});
  const retry=await handleApi(req(path(id),'PUT',deletion(),editor),env);assert.equal(retry.status,200);assert.equal((await retry.json()).revision,1);
  assert.equal(await DB.prepare('SELECT created_by FROM stop_creators WHERE trip_id=? AND stop_id=?').bind(id,'remove-me').first(),null);
 }finally{DB.close();}
});
test('viewer/stranger, stale revision and missing irreversible consent cannot delete or create tombstones',async()=>{
 const {DB,env,id}=await setup();try{
  for(const email of [viewer,'stranger@example.com'])assert.equal((await handleApi(req(path(id),'PUT',deletion(),email),env)).status,403);
  for(const bad of [deletion(0,{permanent:false}),deletion(0,{deleteStopId:'bad id'}),deletion(-1)])assert.equal((await handleApi(req(path(id),'PUT',bad),env)).status,400);
  assert.equal((await handleApi(req(path(id),'PUT',deletion(1)),env)).status,409);assert.equal((await handleApi(req(path(id),'PUT',deletion(0,{deleteStopId:'unknown'})),env)).status,409);
  assert.equal((await DB.prepare('SELECT count(*) count FROM deleted_stops WHERE trip_id=?').bind(id).first()).count,0);assert.equal((await stored(DB,id)).revision,0);
 }finally{DB.close();}
});
test('undo and old drafts cannot restore a permanent stop; equal stop IDs in other trips remain usable',async()=>{
 const {DB,env,id}=await setup();try{
  assert.equal((await handleApi(req(path(id),'PUT',deletion()),env)).status,200);
  const current=await(await handleApi(req(path(id)),env)).json();current.days[0].stops=[{id:'remove-me',name:'舊草稿'}];current.days[1].stops=[];
  const blocked=await handleApi(req(path(id),'PUT',{days:current.days,revision:1,mutationId:'restore-from-draft'}),env);assert.equal(blocked.status,409);
  assert.deepEqual((await blocked.json()).deletedStopIds,['remove-me']);
  const stale=await handleApi(req(path(id),'PUT',{days:current.days,revision:0,mutationId:'old-revision-draft'}),env);assert.equal(stale.status,409);assert.equal((await stale.json()).code,'PERMANENT_STOP_DELETED');
  await assert.rejects(DB.prepare('UPDATE itineraries SET payload=? WHERE id=?').bind(JSON.stringify(current.days),id).run(),/cannot be restored/);
  const another=await(await handleTrips(req('/api/trips','POST',{title:'other',startDate:'2028-01-01',endDate:'2028-01-02'}),env)).json();
  another.days[0].stops=[{id:'remove-me',name:'另一趟合法站'}];assert.equal((await handleApi(req(path(another.trip.id),'PUT',{days:another.days,revision:0,mutationId:'same-stop-id'}),env)).status,200);
  assert.equal((await stored(DB,id)).revision,1);
 }finally{DB.close();}
});
test('CAS and revoked edit access inside an atomic deletion batch do not leave phantom permanent-stop markers',async()=>{
 for(const condition of ['revision','permission']){
  const {DB,env,id}=await setup();try{
   const racing={...DB,async batch(statements){
    if(condition==='revision')await DB.prepare('UPDATE itineraries SET revision=revision+1,mutation_id=? WHERE id=?').bind('permanent-stop-delete',id).run();
    else await DB.prepare("UPDATE itinerary_members SET role='viewer' WHERE trip_id=? AND email=?").bind(id,editor).run();
    return DB.batch(statements);
   }};
   assert.equal((await handleApi(req(path(id),'PUT',deletion(),editor),{...env,DB:racing})).status,condition==='revision'?409:403);
   assert.equal((await DB.prepare('SELECT count(*) count FROM deleted_stops WHERE trip_id=?').bind(id).first()).count,0);
   assert.equal(JSON.parse((await stored(DB,id)).payload)[0].stops[0].id,'remove-me');
   assert.equal((await DB.prepare('SELECT created_by FROM stop_creators WHERE trip_id=? AND stop_id=?').bind(id,'remove-me').first()).created_by,owner);
  }finally{DB.close();}
 }
});
test('a failed stop-content trigger rolls back the deletion marker and both snapshots',async()=>{
 const {DB,env,id}=await setup();try{
  const before=await stored(DB,id);
  await DB.prepare("CREATE TRIGGER fail_stop_purge BEFORE UPDATE OF payload ON itineraries BEGIN SELECT RAISE(ABORT,'synthetic stop rollback'); END").bind().run();
  assert.equal((await handleApi(req(path(id),'PUT',deletion()),env)).status,503);assert.deepEqual(await stored(DB,id),before);
  assert.equal((await DB.prepare('SELECT count(*) count FROM deleted_stops WHERE trip_id=?').bind(id).first()).count,0);
 }finally{DB.close();}
});

test('a failed creator-purge statement rolls back successful content scrubbing and the permanent marker together',async()=>{
 const {DB,env,id}=await setup();try{
  const before=await stored(DB,id),authors=await DB.prepare('SELECT * FROM stop_creators WHERE trip_id=? ORDER BY stop_id').bind(id).all();
  await DB.prepare("CREATE TRIGGER fail_creator_purge BEFORE DELETE ON stop_creators WHEN OLD.stop_id='remove-me' BEGIN SELECT RAISE(ABORT,'synthetic creator purge rollback'); END").bind().run();
  assert.equal((await handleApi(req(path(id),'PUT',deletion()),env)).status,503);assert.deepEqual(await stored(DB,id),before);
  assert.equal((await DB.prepare('SELECT count(*) count FROM deleted_stops WHERE trip_id=?').bind(id).first()).count,0);
  assert.deepEqual(await DB.prepare('SELECT * FROM stop_creators WHERE trip_id=? ORDER BY stop_id').bind(id).all(),authors);
 }finally{DB.close();}
});

