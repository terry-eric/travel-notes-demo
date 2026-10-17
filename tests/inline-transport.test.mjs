import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTransportInput,applyManualTransport,renderInlineTransportRow} from '../public/inline-transport.js';
import {legSignature,savedTravelMinutes,clearStaleTravel} from '../public/transport.js';
import {moveStop} from '../public/reorder.js';
import {mergeTrip} from '../public/merge.js';

const fixture=()=>[{stops:[
 {id:'a',name:'早餐',q:'京都車站',time:'09:00',duration:60,mode:'walking'},
 {id:'b',name:'散步',q:'東寺 京都',time:'10:00',duration:60,mode:'walking'},
 {id:'c',name:'已預約展演',q:'京都劇場',time:'12:00',duration:120,mode:'transit',live:true}
]}];

test('inline minutes require a bounded integer, including a deliberate zero',()=>{
 assert.deepEqual(validateTransportInput({mode:'walking',minutes:'0'}),{mode:'walking',minutes:0});
 assert.equal(validateTransportInput({mode:'transit',minutes:' 1440 '}).minutes,1440);
 for(const minutes of ['', ' ', '-1','1.5','1441','1e2',null,undefined,'Infinity','NaN'])assert.throws(()=>validateTransportInput({mode:'walking',minutes}),/整數分鐘/);
 for(const mode of ['train','__proto__','constructor',''])assert.throws(()=>validateTransportInput({mode,minutes:'6'}),/有效的交通方式/);
});

test('save binds minutes to the selected stable stop, pushes arrivals and preserves the fixed anchor',()=>{
 const days=fixture();days[0].stops[2].travelMinutes=20;days[0].stops[2].travelSignature=legSignature(days[0].stops,2);
 const original=structuredClone(days),saved=applyManualTransport(days,0,'b',{mode:'walking',minutes:'6'});
 assert.deepEqual(days,original,'draft edits must not change the confirmed snapshot');
 assert.equal(savedTravelMinutes(saved.days[0].stops,1),6);assert.equal(saved.days[0].stops[1].time,'10:06');
 assert.equal(saved.days[0].stops[2].time,'12:00');assert.equal(saved.result.changed,1);
 assert.equal(applyManualTransport(saved.days,0,'b',{mode:'walking',minutes:'6'}).result.changed,0,'repeated save has no accumulating drift');
 assert.throws(()=>applyManualTransport(days,0,'missing',{mode:'walking',minutes:'6'}),/找不到/);
 assert.throws(()=>applyManualTransport(days,0,'a',{mode:'walking',minutes:'6'}),/找不到/);
});

test('a changed route or order invalidates only minutes whose endpoints changed',()=>{
 const saved=applyManualTransport(fixture(),0,'b',{mode:'driving',minutes:'0'}).days;
 assert.equal(savedTravelMinutes(saved[0].stops,1),0);
 const renamed=structuredClone(saved);renamed[0].stops[1].name='下午自由活動';assert.equal(savedTravelMinutes(renamed[0].stops,1),0);
 const modeChanged=structuredClone(saved);modeChanged[0].stops[1].mode='walking';clearStaleTravel(modeChanged);assert.equal(modeChanged[0].stops[1].travelMinutes,undefined);
 const reordered=structuredClone(saved);reordered[0].stops=moveStop(reordered[0].stops,'b',2);clearStaleTravel(reordered);assert.equal(reordered[0].stops[2].travelMinutes,undefined);
});

test('inline saves retain three-way merging of different fields and conflict on the same leg',()=>{
 const base=fixture(),mine=applyManualTransport(base,0,'b',{mode:'walking',minutes:'6'}).days,remote=structuredClone(base);
 remote[0].stops[0].desc='同行者補充早餐備註';
 const merged=mergeTrip(base,mine,remote);assert.equal(merged.unresolved.length,0);
 assert.equal(merged.days[0].stops[0].desc,remote[0].stops[0].desc);assert.equal(savedTravelMinutes(merged.days[0].stops,1),6);
 const other=applyManualTransport(base,0,'b',{mode:'transit',minutes:'15'}).days;
 assert.ok(mergeTrip(base,mine,other).unresolved.some(item=>item.label==='交通方式與時間'));
});

test('viewer rows expose route viewing without an editable control; malicious draft text is escaped',()=>{
 const stops=fixture()[0].stops;stops[0].name='<img src=x onerror=alert(1)>';
 const viewer=renderInlineTransportRow(stops,1);assert.doesNotMatch(viewer,/<(?:form|input|select)\b/);assert.match(viewer,/查看 Google Maps 路線/);assert.match(viewer,/&lt;img/);
 const editor=renderInlineTransportRow(stops,1,{canEdit:true,draft:{mode:'walking',minutes:'\"><img src=x>'}});
 assert.doesNotMatch(editor,/<img\b/);assert.match(editor,/&quot;&gt;&lt;img/);assert.match(editor,/min="0" max="1440"/);
 assert.equal(renderInlineTransportRow(stops,0,{canEdit:true}), '');
});
