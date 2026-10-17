import test from 'node:test';
import assert from 'node:assert/strict';
import {moveStopBetweenDays,overviewDropTarget} from '../public/reorder.js';
import {legSignature} from '../public/transport.js';
import {mergeTrip} from '../public/merge.js';

const stop=(id,time='09:00')=>({id,name:id,q:id,time,duration:30,mode:'walking'});
const fixture=()=>[{isoDate:'2026-12-26',stops:[stop('a'),{...stop('b','10:00'),createdBy:'owner@example.test',tag:'美食'},stop('c','11:00')]},{isoDate:'2026-12-27',stops:[stop('d'),stop('e','11:00')]},{isoDate:'2026-12-28',stops:[]}];
function routeMinutes(days){for(const day of days)day.stops.forEach((item,index)=>{if(index){item.travelMinutes=10;item.travelSignature=legSignature(day.stops,index);}});return days;}

test('cross-date move is immutable, retains attribution and clears only changed route pairs',()=>{
 const base=routeMinutes(fixture()),before=structuredClone(base),result=moveStopBetweenDays(base,'b',1,1);
 assert.deepEqual(base,before);assert.deepEqual(result.days.map(day=>day.stops.map(item=>item.id)),[['a','c'],['d','b','e'],[]]);
 assert.equal(result.days[1].stops[1].createdBy,'owner@example.test');assert.equal(result.days[1].stops[1].tag,'美食');
 assert.equal(result.cleared,3);assert.equal(result.days[1].stops[1].travelMinutes,undefined);assert.equal(result.days[0].stops[1].travelMinutes,undefined);assert.equal(result.days[1].stops[2].travelMinutes,undefined);
 assert.equal(result.days[1].stops[1].time,'10:00','missing commute must not invent a new time');
});

test('moving into an empty day and same-day reordering use the final insertion index',()=>{
 const base=fixture(),empty=moveStopBetweenDays(base,'b',2,0);assert.deepEqual(empty.days[2].stops.map(item=>item.id),['b']);assert.equal(empty.index,0);
 const reordered=moveStopBetweenDays(base,'a',0,2);assert.deepEqual(reordered.days[0].stops.map(item=>item.id),['b','c','a']);
 const unchanged=moveStopBetweenDays(base,'a',0,0);assert.deepEqual(unchanged.days,base);
});

test('date changes do not alter fixed appointments and flight dates cannot be dragged to another day',()=>{
 const base=fixture();base[0].stops[1].live=true;
 const moved=moveStopBetweenDays(base,'b',1,1);assert.equal(moved.days[1].stops[1].time,'10:00');assert.equal(moved.days[1].stops[1].live,true);
 base[0].stops[0].kind='flight';base[0].stops[0].flight={departureDateTime:'2026-12-26T09:00'};
 assert.throws(()=>moveStopBetweenDays(base,'a',1,0),/機票日期/);assert.equal(moveStopBetweenDays(base,'a',0,1).days[0].stops[1].flight.departureDateTime,'2026-12-26T09:00');
});

test('invalid date, slot, identity and full destination never partially mutate the original trip',()=>{
 const base=fixture(),before=structuredClone(base);
 for(const args of [['missing',1,0],['a',-1,0],['a',3,0],['a',1,-1],['a',1,3],['a',0,3],['a',1.5,0]])assert.throws(()=>moveStopBetweenDays(base,...args));
 assert.deepEqual(base,before);
 base[1].stops=Array.from({length:100},(_,index)=>stop('full-'+index));assert.throws(()=>moveStopBetweenDays(base,'a',1,100),/100/);assert.equal(base[0].stops.length,3);assert.equal(base[1].stops.length,100);
});

test('concurrent remote edits follow the stable identity into the new date',()=>{
 const base=fixture(),mine=moveStopBetweenDays(base,'b',2,0).days,remote=structuredClone(base);remote[0].stops[1].name='同行者改的名稱';
 const result=mergeTrip(base,mine,remote);assert.equal(result.unresolved.length,0);assert.equal(result.days[2].stops[0].id,'b');assert.equal(result.days[2].stops[0].name,'同行者改的名稱');
});

const columns=[{day:0,left:20,top:100,width:200,height:400,emptyTop:150,items:[{id:'a',top:160,height:80},{id:'b',top:260,height:100}]},{day:1,left:240,top:100,width:200,height:400,emptyTop:150,items:[{id:'c',top:160,height:80}]},{day:2,left:460,top:100,width:200,height:140,emptyTop:160,items:[]}];
test('overview insertion targets handle empty columns, variable card heights and exclude the lifted card',()=>{
 assert.deepEqual(overviewDropTarget(columns,{x:300,y:130},'a'),{day:1,index:0,left:248,width:184,top:156});
 assert.equal(overviewDropTarget(columns,{x:300,y:280},'a').index,1);
 assert.equal(overviewDropTarget(columns,{x:50,y:330},'a').index,1);
 assert.deepEqual(overviewDropTarget(columns,{x:500,y:180},'a'),{day:2,index:0,left:468,width:184,top:160});
 assert.equal(overviewDropTarget(columns,{x:230,y:200},'a'),null);assert.equal(overviewDropTarget(columns,{x:500,y:280},'a'),null);
});
