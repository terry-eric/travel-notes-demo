import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGptPrompt,parseGptImport,importDate} from '../public/gpt-import.js';
import {insertImported} from '../public/import.js';
import {seedDays} from '../public/seed.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {handleApi} from '../server/api.js';
import {legSignature,savedTravelMinutes} from '../public/transport.js';
const entry=overrides=>({date:'2026-11-12',time:'10:15',name:'運河散步與拍照',place:'小樽運河 浅草橋街園 北海道 日本',durationMinutes:45,tag:'景點',mode:'transit',notes:'拍照後到附近吃午餐。\n記得保暖。',...overrides});
const document=stops=>JSON.stringify({format:'trip-gpt-v1',stops});

test('the generated prompt uses current dates and anchors and its example is importable',()=>{
 const days=structuredClone(seedDays);days[1].stops[0].name='同行者已安排的早餐';
 const prompt=buildGptPrompt(days);
 assert.match(prompt,/同行者已安排的早餐/);assert.match(prompt,/虛構劇場預約/);assert.match(prompt,/虛構城市導覽/);
 assert.match(prompt,/2026-11-11/);assert.match(prompt,/2026-11-15/);
 const example=prompt.slice(prompt.indexOf('格式範例（請用實際規劃內容取代範例值）：\n')+'格式範例（請用實際規劃內容取代範例值）：\n'.length);
 assert.equal(parseGptImport(example,days)[0].duration,60);
});

test('raw and fenced AI output preserve content, derive searchable Maps URLs and discard privileged fields',()=>{
 const original=entry({name:'咖啡 <img onerror=alert(1)>',id:'remote-id',live:true,source:'https://evil.example',travelMinutes:99});
 const raw=document([original,entry({date:'2026-11-13',time:'14:00',durationMinutes:null,tag:undefined,mode:undefined,notes:undefined})]);
 const rows=parseGptImport('```json\n'+raw+'\n```',seedDays);
 assert.deepEqual(rows,parseGptImport(raw,seedDays));
 assert.equal(rows[0].name,original.name);assert.equal(rows[0].day,1);assert.equal(rows[0].duration,45);assert.equal(rows[0].desc,original.notes);assert.equal(rows[0].mode,'transit');
 assert.equal(new URL(rows[0].mapUrl).searchParams.get('query'),original.place);
 for(const key of ['id','live','source','travelMinutes','travelSignature'])assert.equal(rows[0][key],undefined);
 assert.equal(rows[1].duration,undefined);assert.equal(rows[1].mode,'walking');assert.equal(rows[1].tag,'其他');
 assert.equal(parseGptImport(document([entry({mapUrl:'https://www.google.com/maps/place/Otaru+Canal/'})]),seedDays)[0].mapUrl,'https://www.google.com/maps/place/Otaru+Canal/');
});

test('malformed or unsafe AI batches fail completely with a numbered correction',()=>{
 const invalid=[{date:'2026-11-16'},{date:'2027-11-12'},{time:'9:00'},{time:'24:00'},{name:''},{place:''},{place:'樽'.repeat(300)},{durationMinutes:1.5},{durationMinutes:-1},{durationMinutes:1441},{mode:'plane'},{notes:'x'.repeat(2001)},{mapUrl:'https://evil.example/maps'},{mapUrl:'javascript:alert(1)'}];
 for(const fields of invalid)assert.throws(()=>parseGptImport(document([entry(),entry(fields)]),seedDays),/第 2 筆：/);
 for(const input of ['', 'Here is your trip: '+document([entry()]), JSON.stringify({format:'other',stops:[entry()]}),document([]),document(Array(101).fill(entry())),'x'.repeat(80001)])assert.throws(()=>parseGptImport(input,seedDays));
});

test('AI additions preserve existing stops, fixed anchors and invalidate only changed transfer pairs',()=>{
 const base=structuredClone(seedDays);base[1].stops.forEach((stop,i)=>{if(i){stop.travelMinutes=6;stop.travelSignature=legSignature(base[1].stops,i);}});
 const before=structuredClone(base),rows=parseGptImport(document([entry(),entry({date:'2026-11-13',time:'14:00',name:'休息'})]),base).map((row,i)=>({...row,id:'gpt-'+i}));
 const next=insertImported(base,rows);
 assert.deepEqual(base,before);
 for(let d=0;d<base.length;d++)assert.deepEqual(next[d].stops.filter(stop=>!stop.id?.startsWith('gpt-')),base[d].stops);
 assert.equal(next[1].stops[1].id,'gpt-0');
 assert.equal(savedTravelMinutes(next[1].stops,2),null);
 assert.equal(savedTravelMinutes(next[1].stops,3),6);
 assert.equal(next[2].stops.find(stop=>stop.live).time,base[2].stops.find(stop=>stop.live).time);
});

test('new trip prompts use their own cross-year calendar, timezone and fixed reservations',()=>{
 const days=[{isoDate:'2027-12-31',date:'12/31',week:'週五',stops:[{name:'已預約跨年晚餐',time:'19:00',q:'old search',routeQuery:'Paris France',duration:90,live:true}]},{isoDate:'2028-01-01',date:'1/1',week:'週六',stops:[]}];
 const prompt=buildGptPrompt(days,{title:'巴黎跨年旅行',timezone:'Europe/Paris',destination:'巴黎，法國'});
 assert.match(prompt,/巴黎跨年旅行/);assert.match(prompt,/Europe\/Paris/);assert.match(prompt,/2027-12-31/);assert.match(prompt,/2028-01-01/);assert.match(prompt,/已預約跨年晚餐/);assert.match(prompt,/"fixed": true/);
 assert.match(prompt,/"place": "Paris France"/);assert.match(prompt,/"durationMinutes": 90/);assert.doesNotMatch(prompt,/old search/);
 assert.doesNotMatch(prompt,/北海道|札幌|小樽|milet|YOASOBI|日本當地時間/);
 const rows=parseGptImport(document([entry({date:'2028-01-01',name:'新年散步',place:'Jardin des Tuileries Paris France',fixed:true})]),days);
 assert.equal(rows[0].day,1);assert.equal(rows[0].live,true);
 assert.equal(importDate({isoDate:'2028-02-29',date:'2/28'}),'2028-02-29');
 assert.throws(()=>importDate({isoDate:'2028-02-30',date:'2/29'}),/日期不完整/);
 assert.throws(()=>importDate({date:'2/29'}),/日期不完整/);
 assert.throws(()=>parseGptImport(document([entry({date:'2026-12-31'})]),days),/第 1 筆/);
 assert.throws(()=>buildGptPrompt([]),/先選擇/);
});

test('only explicit boolean fixed flags opt into a fixed schedule',()=>{
 const rows=parseGptImport(document([entry({fixed:true,live:false}),entry({fixed:false,live:true}),entry({live:true})]),seedDays);
 assert.equal(rows[0].live,true);assert.equal(rows[1].live,undefined);assert.equal(rows[2].live,undefined);
 for(const fixed of ['true',1,null,[],{}])assert.throws(()=>parseGptImport(document([entry(),entry({fixed})]),seedDays),/第 2 筆：fixed/);
});

test('new AI stops insert before clock-prefixed anchors while preserving earlier stop order',()=>{
 const base=structuredClone(seedDays),day=base[2];
 const anchor=day.stops.find(stop=>stop.live);assert.equal(anchor.time,'17:30 抵達');
 const rows=parseGptImport(document([entry({date:'2026-11-13',time:'17:00',name:'入場前補水',place:'hitaru Sapporo Japan',fixed:false}),entry({date:'2026-11-13',time:'19:45',name:'散場晚餐',place:'Sapporo Japan'})]),base).map((row,i)=>({...row,id:'anchor-import-'+i}));
 const next=insertImported(base,rows)[2].stops,names=next.map(stop=>stop.name);
 assert.ok(names.indexOf('入場前補水')<names.indexOf(anchor.name));assert.ok(names.indexOf('散場晚餐')>names.indexOf(anchor.name));
 assert.deepEqual(next.filter(stop=>!stop.id?.startsWith('anchor-import-')),day.stops);
 assert.equal(next.find(stop=>stop.name===anchor.name).time,'17:30 抵達');
});

test('AI dates, notes, labels, stays and modes survive one atomic cloud save and undo snapshot',async()=>{
 const DB=localDatabase();const request=body=>new Request('https://trip.example/api/trip',{method:body?'PUT':'GET',headers:{'oai-authenticated-user-id':'owner@example.com','Content-Type':'application/json',Origin:'https://trip.example','X-Trip-Client':'multi-1'},body:body?JSON.stringify(body):undefined});
 try{
  const base=(await(await handleApi(request(),{DB})).json()).days;
  const rows=parseGptImport(document([entry({fixed:true}),entry({date:'2026-11-14',time:'09:15',name:'買早餐',tag:'用餐',mode:'walking',durationMinutes:0})]),base).map((row,i)=>({...row,id:'gpt-cloud-'+i}));
  const added=insertImported(base,rows),saved=await handleApi(request({days:added,revision:0,mutationId:'gpt-save'}),{DB});assert.equal(saved.status,200);
  const data=await(await handleApi(request(),{DB})).json(),stop=data.days[1].stops.find(stop=>stop.id==='gpt-cloud-0');
  assert.equal(stop.duration,45);assert.equal(stop.tag,'景點');assert.equal(stop.desc,entry().notes);assert.equal(stop.mode,'transit');assert.equal(stop.time,'10:15');assert.equal(stop.live,true);assert.equal(data.days[3].stops.find(stop=>stop.id==='gpt-cloud-1').duration,0);
  const undo=await(await handleApi(request({days:data.previous,revision:1,mutationId:'gpt-undo'}),{DB})).json();assert.deepEqual(undo.days,base);
 }finally{DB.close();}
});
