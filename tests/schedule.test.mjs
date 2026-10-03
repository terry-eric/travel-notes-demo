import test from 'node:test';
import assert from 'node:assert/strict';
import {legSignature,savedTravelMinutes,clearStaleTravel,pushSchedule} from '../public/transport.js';
import {validateDays,handleApi} from '../server/api.js';
import {seedDays} from '../public/seed.js';
import {localDatabase} from '../scripts/local-db.mjs';
const stop=(name,time,duration)=>({name,q:name,time,duration,mode:'walking'});
function minutes(stops,index,n){stops[index].travelMinutes=n;stops[index].travelSignature=legSignature(stops,index);}
test('manual travel pushes late arrivals while preserving planned breaks and fixed concerts',()=>{
 const stops=[stop('A','09:30',90),stop('B','11:00',60),stop('C','12:30',60),{...stop('演唱會','13:30 開演',120),live:true}];
 minutes(stops,1,6);minutes(stops,2,10);minutes(stops,3,10);
 const r=pushSchedule(stops,1);
 assert.equal(stops[1].time,'11:06');assert.equal(stops[2].time,'12:30');assert.equal(stops[3].time,'13:30 開演');assert.equal(r.changed,1);assert.match(r.reason,/晚於/);
 assert.equal(pushSchedule(stops,1).changed,0,'repeated save must not accumulate drift');
 minutes(stops,1,3);pushSchedule(stops,1);assert.equal(stops[1].time,'11:06','shorter travel must not pull plans earlier');
});
test('unknown times, missing stays, missing onward travel and midnight do not silently invent a schedule',()=>{
 let stops=[stop('A','09:30',undefined),stop('B','10:00',30)];minutes(stops,1,6);
 assert.match(pushSchedule(stops,1).reason,/停留時間/);assert.equal(stops[1].time,'10:00');
 stops[0].duration=30;stops[0].time='上午';assert.match(pushSchedule(stops,1).reason,/明確時間/);
 stops[0].time='23:30';stops[0].duration=30;assert.match(pushSchedule(stops,1).reason,/午夜/);
 stops=[stop('A','09:30',60),stop('B','10:00',30),stop('C','11:00',10)];minutes(stops,1,6);
 assert.match(pushSchedule(stops,1).reason,/交通時間/);assert.equal(stops[1].time,'10:36');assert.equal(stops[2].time,'11:00');
 assert.match(pushSchedule(stops,0).reason,/第一站/);
});
test('changing endpoints, order or travel mode invalidates minutes; display-only renaming preserves them',()=>{
 const stops=[stop('A','09:00',0),stop('B','10:00',0),stop('C','11:00',0)];minutes(stops,1,0);minutes(stops,2,8);
 stops[1].name='午餐';assert.equal(savedTravelMinutes(stops,1),0);
 stops[1].mode='transit';assert.equal(savedTravelMinutes(stops,1),null);
 [stops[0],stops[1]]=[stops[1],stops[0]];clearStaleTravel([{stops}]);assert.equal(stops[2].travelMinutes,undefined);
});
test('manual travel survives server save/reload and undo; invalid minutes are rejected',async()=>{
 const days=structuredClone(seedDays);minutes(days[1].stops,1,6);days[1].stops[0].duration=90;pushSchedule(days[1].stops,1);
 assert.equal(validateDays(days)[1].stops[1].travelMinutes,6);
 for(const bad of [-1,1.5,1441,'6',null]){const invalid=structuredClone(days);invalid[1].stops[1].travelMinutes=bad;assert.throws(()=>validateDays(invalid));}
 const DB=localDatabase();
 const request=(body)=>new Request('https://trip.example/api/trip',{method:body?'PUT':'GET',headers:{'oai-authenticated-user-id':'owner@example.com','Content-Type':'application/json',Origin:'https://trip.example','X-Trip-Client':'multi-1'},body:body?JSON.stringify(body):undefined});
 try{
  const saved=await(await handleApi(request({days,revision:0,mutationId:'manual-1'}),{DB})).json();
  const loaded=await(await handleApi(request(),{DB})).json();assert.equal(savedTravelMinutes(loaded.days[1].stops,1),6);assert.equal(loaded.days[1].stops[1].time,'11:06');
  const undo=await(await handleApi(request({days:saved.previous,revision:1,mutationId:'undo-manual'}),{DB})).json();assert.equal(undo.days[1].stops[1].travelMinutes,undefined);assert.equal(undo.days[1].stops[1].time,'11:00');
 }finally{DB.close();}
});
