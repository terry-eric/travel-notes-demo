import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTrip} from '../public/merge.js';
import {withStopIds} from '../public/identity.js';
import {createDraftStore} from '../public/drafts.js';
import {seedDays} from '../public/seed.js';
import {handleApi} from '../server/api.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {clearStaleTravel,legSignature,pushSchedule} from '../public/transport.js';
const clone=structuredClone;
const base=()=>clone(seedDays);

test('different stops and different fields on the same stop merge without a prompt',()=>{
 const b=base(),m=clone(b),t=clone(b);m[0].stops[0].desc='My notes';m[1].stops[0].tag='交通';t[0].stops[0].duration=60;t[2].stops[0].name='Their name';
 const r=mergeTrip(b,m,t);assert.equal(r.unresolved.length,0);assert.equal(r.days[0].stops[0].desc,'My notes');assert.equal(r.days[0].stops[0].duration,60);assert.equal(r.days[2].stops[0].name,'Their name');assert.equal(r.days[1].stops[0].tag,'交通');
});

test('the same field asks for a choice, equal edits do not, and an explicit clear is retained',()=>{
 const b=base(),m=clone(b),t=clone(b),id=b[0].stops[0].id;m[0].stops[0].time='10:00';t[0].stops[0].time='11:00';
 const r=mergeTrip(b,m,t);assert.equal(r.unresolved.length,1);assert.equal(r.unresolved[0].key,id+':time');
 assert.equal(mergeTrip(b,m,t,{[id+':time']:'mine'}).days[0].stops[0].time,'10:00');assert.equal(mergeTrip(b,m,t,{[id+':time']:'theirs'}).unresolved.length,0);
 t[0].stops[0].time='10:00';assert.equal(mergeTrip(b,m,t).unresolved.length,0);
 b[0].stops[0].duration=60;m[0].stops[0].duration=undefined;t[0].stops[0].duration=60;assert.equal(mergeTrip(b,m,t).days[0].stops[0].duration,undefined);
});

test('names can change while destination and travel bundles remain internally consistent',()=>{
 const b=base(),m=clone(b),t=clone(b);m[0].stops[0].name='早餐';t[0].stops[0].q='Another address';
 assert.equal(mergeTrip(b,m,t).unresolved.length,0);
 m[0].stops[0].mapUrl='https://maps.app.goo.gl/new';let r=mergeTrip(b,m,t);assert.equal(r.unresolved[0].label,'導航地點');
 m[0].stops[0].mode='transit';t[0].stops[0].travelMinutes=20;t[0].stops[0].travelSignature='route';r=mergeTrip(b,m,t);assert.ok(r.unresolved.some(c=>c.label==='交通方式與時間'));
});

test('concurrent additions retain both unique stops, including at the same position',()=>{
 const b=base(),m=clone(b),t=clone(b);m[0].stops.splice(1,0,{...b[0].stops[0],id:'new-mine',name:'我的咖啡'});t[0].stops.splice(1,0,{...b[0].stops[0],id:'new-theirs',name:'朋友的咖啡'});
 const r=mergeTrip(b,m,t);assert.equal(r.unresolved.length,0);assert.equal(r.days[0].stops.length,b[0].stops.length+2);assert.equal(new Set(r.days[0].stops.map(s=>s.id)).size,r.days[0].stops.length);
 const again=mergeTrip(b,m,t);assert.deepEqual(again.days,r.days);
});

test('delete against unchanged deletes automatically; delete against edited asks and never duplicates',()=>{
 const b=base(),m=clone(b),t=clone(b),id=b[0].stops[0].id;m[0].stops.shift();assert.equal(mergeTrip(b,m,t).unresolved.length,0);
 t[0].stops[0].desc='Edited';let r=mergeTrip(b,m,t);assert.equal(r.unresolved[0].type,'presence');
 r=mergeTrip(b,m,t,{['presence:'+id]:'mine'});assert.ok(!r.days[0].stops.some(s=>s.id===id));
 r=mergeTrip(b,m,t,{['presence:'+id]:'theirs'});assert.equal(r.days[0].stops.filter(s=>s.id===id).length,1);assert.equal(r.days[0].stops[0].desc,'Edited');
 assert.equal(mergeTrip(b,t,m,{['presence:'+id]:'mine'}).days[0].stops[0].desc,'Edited');
});

test('cross-day moves follow the same identity while another person renames the stop',()=>{
 const b=base(),m=clone(b),t=clone(b),id=b[0].stops[0].id;m[1].stops.push(m[0].stops.shift());t[0].stops[0].name='Renamed';
 const r=mergeTrip(b,m,t);assert.equal(r.unresolved.length,0);assert.equal(r.days[1].stops.find(s=>s.id===id).name,'Renamed');assert.ok(!r.days[0].stops.some(s=>s.id===id));
 const another=clone(b);another[2].stops.push(another[0].stops.shift());assert.ok(mergeTrip(b,m,another).unresolved.some(c=>c.label==='安排日期'));
});

test('independent reorders combine; contradictory reorders show both complete arrangements',()=>{
 const b=base(),m=clone(b),t=clone(b);[m[0].stops[0],m[0].stops[1]]=[m[0].stops[1],m[0].stops[0]];[t[0].stops[4],t[0].stops[5]]=[t[0].stops[5],t[0].stops[4]];
 const r=mergeTrip(b,m,t);assert.equal(r.unresolved.length,0);assert.equal(r.days[0].stops[0].id,m[0].stops[0].id);assert.equal(r.days[0].stops[4].id,t[0].stops[4].id);
 const contradictory=clone(b);[contradictory[0].stops[1],contradictory[0].stops[2]]=[contradictory[0].stops[2],contradictory[0].stops[1]];
 assert.ok(mergeTrip(b,m,contradictory).unresolved.some(c=>c.type==='order'));
 const resolved=mergeTrip(b,m,contradictory,{'order:0':'mine'});assert.equal(resolved.unresolved.length,0);assert.deepEqual(resolved.days[0].stops.map(s=>s.id),m[0].stops.map(s=>s.id));
});

test('renaming, deleting and moving do not misidentify old legacy stops or reuse an added ID',()=>{
 const old=base();for(const day of old)for(const stop of day.stops)delete stop.id;
 const b=withStopIds(old),m=clone(b),t=clone(b);m[0].stops[0].name='Renamed';t[0].stops.splice(1,1);
 const r=mergeTrip(b,m,t);assert.equal(r.unresolved.length,0);assert.equal(r.days[0].stops[0].name,'Renamed');assert.equal(r.days[0].stops.length,b[0].stops.length-1);
 const duplicated=clone(b);duplicated[0].stops.push(clone(duplicated[0].stops[0]));assert.throws(()=>withStopIds(duplicated),/重複/);
});

test('route changes clear stale minutes and subsequent schedule checks preserve concert anchors',()=>{
 const b=base();const stops=b[2].stops;stops[3].time='17:00';stops[3].duration=120;stops[4].travelMinutes=30;stops[4].travelSignature=legSignature(stops,4);
 const m=clone(b),t=clone(b);m[2].stops[0].desc='Notes';t[2].stops[0].q='Changed';const r=mergeTrip(b,m,t);clearStaleTravel(r.days);const fixed=r.days[2].stops[4].time;pushSchedule(r.days[2].stops,4);assert.equal(r.days[2].stops[4].time,fixed);
 const route=base();route[0].stops[1].travelMinutes=10;route[0].stops[1].travelSignature=legSignature(route[0].stops,1);const edited=clone(route);edited[0].stops[0].q='New origin';const changed=mergeTrip(route,edited,route);clearStaleTravel(changed.days);assert.equal(changed.days[0].stops[1].travelMinutes,undefined);
});

test('a real stale save merges against the latest authenticated database snapshot',async()=>{
 const DB=localDatabase(),request=(body)=>new Request('https://trip.example/api/trip',{method:body?'PUT':'GET',headers:{'oai-authenticated-user-id':'owner@example.com','Content-Type':'application/json',Origin:'https://trip.example','X-Trip-Client':'multi-1'},body:body?JSON.stringify(body):undefined});
 try{
  const initial=await(await handleApi(request(),{DB})).json(),mine=clone(initial.days),theirs=clone(initial.days);mine[0].stops[0].desc='My edit';theirs[1].stops[0].name='Their edit';
  await handleApi(request({days:theirs,revision:0,mutationId:'first'}),{DB});assert.equal((await handleApi(request({days:mine,revision:0,mutationId:'stale'}),{DB})).status,409);
  const latest=await(await handleApi(request(),{DB})).json(),merged=mergeTrip(initial.days,mine,latest.days);assert.equal(merged.unresolved.length,0);
  const saved=await(await handleApi(request({days:merged.days,revision:latest.revision,mutationId:'merged'}),{DB})).json();assert.equal(saved.days[0].stops[0].desc,'My edit');assert.equal(saved.days[1].stops[0].name,'Their edit');
  assert.deepEqual(saved.days.flatMap(d=>d.stops.map(s=>s.id)),merged.days.flatMap(d=>d.stops.map(s=>s.id)));
 }finally{DB.close();}
});

test('drafts and conflict selections survive reload, stay separate per account, and report full storage',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const mine=createDraftStore(storage,'owner-tab'),other=createDraftStore(storage,'other-user-tab');const data={editor:{fields:{name:'Unsent'}},pending:{base:base(),days:base(),merge:{choices:{field:'mine'}}}};
 assert.equal(mine.write(data),true);assert.equal(createDraftStore(storage,'owner-tab').read().editor.fields.name,'Unsent');assert.equal(mine.read().pending.merge.choices.field,'mine');assert.equal(other.read(),null);mine.clear();assert.equal(mine.read(),null);
 const full=createDraftStore({getItem(){return '{broken';},setItem(){throw Error('Full');}},'full');assert.equal(full.read(),null);assert.equal(full.write(data),false);assert.equal(full.failed,true);
});
