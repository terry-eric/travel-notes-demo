import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeolocationClient,geolocationStatusText} from '../public/geolocation-client.js';
import {getStopCoordinates} from '../public/map-coordinates.js';

const point={lat:34.9948,lng:135.785};
const resolved={status:'resolved',coordinates:point,source:'photon'};
const turn=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function harness(t,{stops=[{id:'a',q:'清水寺 京都市 日本'}],lookup=async()=>resolved,storage=memory()}={}){
 let clock=10000,serial=0,scope={email:'owner@example.com',tripId:'trip-1',epoch:0,enabled:true,canLookup:true},days=[{stops}],changes=0;
 const timers=new Map(),calls=[];
 const client=createGeolocationClient({getScope:()=>scope,getDays:()=>days,storage,appBase:'/trip',now:()=>clock,
  schedule:(fn,delay)=>{const id=++serial;timers.set(id,{fn,due:clock+delay});return id;},cancel:id=>timers.delete(id),
  lookup:(body,signal)=>{calls.push({body,signal,at:clock});return lookup(body,signal);},onChange:()=>changes++});
 t.after(()=>client.reset());
 return {client,calls,timers,storage,get changes(){return changes;},get scope(){return scope;},set scope(value){scope=value;},get days(){return days;},set days(value){days=value;},
  advance(milliseconds){clock+=milliseconds;},
  async next(){const [id,job]=[...timers].sort((a,b)=>a[1].due-b[1].due)[0]||[];assert.ok(job,'expected scheduled lookup');timers.delete(id);clock=job.due;job.fn();await turn();},
 };
}

test('one page scan shares identical lookups, reuses saved peers and never edits itinerary or route timing',async t=>{
 const stops=[{id:'a',q:'清水寺 京都市 日本',time:'09:30',travelMinutes:99,travelSignature:'kept'},{id:'b',q:'清水寺 京都市 日本'},
  {id:'c',name:'只是行程名稱'},{id:'d',q:'大阪市潮路1-3-18',coordinates:{lat:34.63666,lng:135.49259}},{id:'e',q:'大阪市潮路1-3-18'}];
 const original=structuredClone(stops),h=harness(t,{stops});
 h.client.scan();assert.equal(h.client.status(stops[0]).status,'pending');assert.equal(h.client.status(stops[2]).status,'missing_query');
 await turn();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,{trip:'trip-1',id:'a',query:stops[0].q});
 assert.deepEqual(h.client.overlay()[0].stops[0].coordinates,point);assert.deepEqual(h.client.overlay()[0].stops[1].coordinates,point);
 assert.deepEqual(h.client.overlay()[0].stops[4].coordinates,stops[3].coordinates);assert.deepEqual(stops,original);
 for(let i=0;i<20;i++)h.client.scan();await turn();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});

test('ambiguous results remain unpinned and failures are attempted only once in a session',async t=>{
 const h=harness(t,{stops:[{id:'a',q:'咖啡店 京都市'},{id:'b',q:'另一家 京都市'}],lookup:async body=>body.id==='a'?{status:'ambiguous',coordinates:point,candidates:[{label:'京都市',kind:'area',coordinates:point}]}:Promise.reject(Error('offline'))});
 h.client.scan();await turn();assert.equal(h.client.status(h.days[0].stops[0]).status,'ambiguous');assert.equal(h.client.overlay()[0].stops[0].coordinates,undefined);
 await h.next();assert.equal(h.calls.length,2);assert.equal(h.client.status(h.days[0].stops[1]).status,'unavailable');
 for(let i=0;i<10;i++)h.client.scan();await turn();assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);
 assert.match(geolocationStatusText(h.client.status(h.days[0].stops[0])),/多個地點/);
});

test('cached points are account/trip/query scoped and a location edit invalidates only that destination',async t=>{
 const storage=memory(),first=harness(t,{storage});first.client.scan();await turn();assert.equal(first.calls.length,1);first.client.reset();
 const next=harness(t,{storage});next.client.scan();await turn();assert.equal(next.calls.length,0);assert.deepEqual(next.client.overlay()[0].stops[0].coordinates,point);
 next.days[0].stops[0].q='清水寺 東京都 日本';next.client.scan();await turn();assert.equal(next.calls.length,1);
 const other=harness(t,{storage});other.scope={...other.scope,email:'viewer@example.com'};other.client.scan();await turn();assert.equal(other.calls.length,1);
 const trip=harness(t,{storage});trip.scope={...trip.scope,tripId:'trip-2'};trip.client.scan();await turn();assert.equal(trip.calls.length,1);
 next.client.reset({forget:true});assert.ok(![...storage.values.keys()].some(key=>key.endsWith(':owner%40example.com:trip-1')));
});

test('a late old-account response is ignored while the new account can resolve the same query',async t=>{
 const deferred=[],h=harness(t,{lookup:()=>new Promise(resolve=>deferred.push(resolve))});
 h.client.scan();await turn();const originalSignal=h.calls[0].signal;
 h.scope={...h.scope,email:'other@example.com'};h.client.scan();await turn();assert.equal(h.calls.length,2);assert.equal(originalSignal.aborted,true);
 deferred[0](resolved);await turn();assert.equal(h.client.status(h.days[0].stops[0]).status,'pending');assert.equal(h.client.overlay()[0].stops[0].coordinates,undefined);
 const nextPoint={lat:35,lng:136};deferred[1]({...resolved,coordinates:nextPoint});await turn();assert.deepEqual(h.client.overlay()[0].stops[0].coordinates,nextPoint);
 h.client.scan();await turn();assert.equal(h.calls.length,2);
});

test('changed queries cannot apply late pins, and an unavailable trip clears and aborts the overlay',async t=>{
 const deferred=[],h=harness(t,{lookup:()=>new Promise(resolve=>deferred.push(resolve))});h.client.scan();await turn();
 h.days[0].stops[0].q='新地點 大阪市';h.client.scan();deferred[0](resolved);await turn();assert.equal(h.client.overlay()[0].stops[0].coordinates,undefined);
 await h.next();assert.equal(h.calls[1].body.query,'新地點 大阪市');h.scope={...h.scope,enabled:false};h.client.scan();
 assert.equal(h.calls[1].signal.aborted,true);deferred[1](resolved);await turn();assert.equal(h.client.overlay()[0].stops[0].coordinates,undefined);
});

test('rate-limit retries respect Retry-After and stop after two retries',async t=>{
 const h=harness(t,{lookup:async()=>({result:{status:'limited'},retryAfter:2})});h.client.scan();await turn();assert.equal(h.calls.length,1);
 await h.next();await h.next();assert.equal(h.calls.length,3);assert.deepEqual(h.calls.map(call=>call.at),[10000,12000,14000]);
 assert.equal(h.client.status(h.days[0].stops[0]).status,'limited');h.client.scan();await turn();assert.equal(h.calls.length,3);assert.equal(h.timers.size,0);
});

test('the daily limit pauses queued and newly opened places instead of repeatedly querying the backend',async t=>{
 const h=harness(t,{stops:[{id:'a',q:'清水寺 京都市'},{id:'b',q:'大阪城 大阪市'}],lookup:async()=>({result:{status:'limited',reason:'daily_limit'},retryAfter:3600})});
 h.client.scan();await turn();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 for(const stop of h.days[0].stops)assert.equal(h.client.status(stop).reason,'daily_limit');
 h.days[0].stops.push({id:'c',q:'東大寺 奈良市'});h.client.scan();await turn();assert.equal(h.calls.length,1);
 assert.match(geolocationStatusText(h.client.status(h.days[0].stops[2])),/今日/);
});

test('full place coordinates and valid saved peers need no API even when lookup is disabled',async t=>{
 const stops=[{id:'a',mapUrl:'https://www.google.com/maps/place/A/data=!3d34.9948!4d135.785'},{id:'b',mapUrl:'https://maps.app.goo.gl/short'}];
 const h=harness(t,{stops});h.scope={...h.scope,canLookup:false};h.client.scan();await turn();
 assert.deepEqual(getStopCoordinates(h.client.overlay()[0].stops[0]),point);assert.equal(h.client.status(stops[1]).status,'disabled');assert.equal(h.calls.length,0);
});

test('negative and resolved cache expiry rechecks only on the next page scan without polling',async t=>{
 for(const [result,lifetime] of [[{status:'not_found'},86400000],[resolved,30*86400000]]){
  const h=harness(t,{lookup:async()=>result});h.client.scan();await turn();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  h.advance(lifetime-1);h.client.scan();await turn();assert.equal(h.calls.length,1);
  h.advance(2);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  h.client.scan();await turn();assert.equal(h.calls.length,2);
 }
});

test('daily quota recovery allows a new user scan after the returned interval without requiring reload',async t=>{
 let count=0;const h=harness(t,{lookup:async()=>++count===1?{result:{status:'limited',reason:'daily_limit'},retryAfter:3600}:resolved});
 h.client.scan();await turn();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 h.advance(3600001);assert.equal(h.calls.length,1);h.client.scan();await turn();assert.equal(h.calls.length,2);assert.deepEqual(h.client.overlay()[0].stops[0].coordinates,point);
});
