import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createDemoState,hydrateDemoCoordinates} from '../demo/seed.js';
import {createDemoApi} from '../demo/api.js';
import {handleApi,handleTrips,validateDays} from '../server/api.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {createTravelCache} from '../public/cache.js';
import {sanitizeFlight} from '../public/flights.js';
import {routeLeg,legSignature,savedTravelMinutes} from '../public/transport.js';
import {getStopCoordinates} from '../public/map-coordinates.js';
import {mergeTrip} from '../public/merge.js';
import {buildDemo} from '../scripts/build-demo.mjs';

const origin='https://planner.example',email='planner@example.com';
const flightDetails={airline:'示範航空',number:'DEMO116',departureAirport:'桃園 TPE',arrivalAirport:'新千歲 CTS',departureDateTime:'2027-04-12T10:00',arrivalDateTime:'2027-04-12T14:45',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo',bookingReference:'DEMO123'};
const metadata={title:'機票與地點的儲存示範',startDate:'2027-04-12',endDate:'2027-04-12',timezone:'Asia/Tokyo'};
function memory(){const data=new Map();return {data,get length(){return data.size;},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};}
function request(endpoint,method='GET',body){return new Request(origin+endpoint,{method,headers:{Origin:origin,'oai-authenticated-user-id':email,'Content-Type':'application/json','X-Trip-Client':'multi-2'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const plannedStops=()=>[
 {id:'flight-one',kind:'flight',name:'出發航班',time:'11:00',q:flightDetails.departureAirport,routeQuery:flightDetails.departureAirport,tag:'機票',desc:'示範票券',mode:'transit',live:true,duration:225,coordinates:{lat:25.0797,lng:121.2342},flight:flightDetails},
 {id:'hotel-one',name:'住宿',time:'16:00',q:'札幌車站',tag:'住宿',desc:'',mode:'transit',duration:30,coordinates:{lat:43.0687,lng:141.3508}},
];
function assertPlanning(snapshot){
 const [flight,hotel]=snapshot.days[0].stops;
 assert.equal(snapshot.days[0].title,'出發與抵達');
 assert.deepEqual(flight.flight,sanitizeFlight(flightDetails));
 assert.equal(flight.kind,'flight');assert.equal(flight.time,'11:00');assert.equal(flight.duration,225);assert.equal(flight.live,true);
 assert.equal(flight.q,flightDetails.departureAirport);assert.deepEqual(getStopCoordinates(flight),{lat:25.0797,lng:121.2342});
 assert.deepEqual(getStopCoordinates(hotel),{lat:43.0687,lng:141.3508});
 assert.equal(routeLeg(snapshot.days[0].stops,1).origin,flightDetails.arrivalAirport);
}

test('seed location upgrades never rewrite an explicitly edited destination, including undo positions',()=>{
 const variants=[
  {coordinates:{lat:25.03,lng:121.56}},
  {mapUrl:'https://www.google.com/maps/?q=25.03,121.56'},
  {q:'台北車站'},
  {routeQuery:'台北車站'},
  {placeId:'edited-real-destination'},
 ];
 for(const change of variants){
  const state=createDemoState(),entry=state.trips[0];delete entry.days[0].stops[0].coordinates;Object.assign(entry.days[0].stops[0],change);
  entry.previous=structuredClone(entry.days);const before=JSON.stringify(state);
  assert.equal(hydrateDemoCoordinates(state),false,JSON.stringify(change));assert.equal(JSON.stringify(state),before);
 }
 const state=createDemoState(),stop=state.trips[0].days[0].stops[0],expected=stop.coordinates;delete stop.coordinates;
 assert.equal(hydrateDemoCoordinates(state),true);assert.deepEqual(stop.coordinates,expected);assert.equal(hydrateDemoCoordinates(state),false);
});

test('cloud save, reload and account-scoped cache preserve day names, coordinates and flight fields',async t=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:email};t.after(()=>DB.close());
 const created=await handleTrips(request('/api/trips','POST',metadata),env);assert.equal(created.status,201);
 const data=await created.json();data.days[0].title='出發與抵達';data.days[0].stops=plannedStops();
 const endpoint='/api/trip?trip='+data.trip.id;
 const saved=await handleApi(request(endpoint,'PUT',{days:data.days,revision:0,mutationId:'save-planning-regression'}),env);assert.equal(saved.status,200);
 const loaded=await (await handleApi(request(endpoint),env)).json();assertPlanning(loaded);
 const cache=createTravelCache({storage:memory(),appBase:'/trip',email});assert.equal(cache.writeTrip(data.trip.id,loaded),true);assertPlanning(cache.readTrip(data.trip.id));
 const malformed=structuredClone(loaded.days);malformed[0].stops[1].coordinates={lat:91,lng:121};assert.throws(()=>validateDays(malformed,loaded.trip),/有效.*座標/);
});

test('browser demo save and a fresh API instance retain the same planning fields',async()=>{
 const storage=memory(),base='/planning-demo';
 const call=async(api,endpoint,method='GET',body)=>{const response=await api.fetch(base+'/api/'+endpoint,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(response.status,method==='POST'?201:200);return response.json();};
 const api=createDemoApi({storage,base}),data=await call(api,'trips','POST',{...metadata,creationId:'planning-fields'});data.days[0].title='出發與抵達';data.days[0].stops=plannedStops();
 await call(api,'trip?trip=planning-fields','PUT',{days:data.days,revision:0,mutationId:'save-demo-planning'});
 assertPlanning(await call(createDemoApi({storage,base}),'trip?trip=planning-fields'));
});

test('arrival airports are subsequent-leg origins and changing them invalidates saved travel minutes',()=>{
 const stops=plannedStops();stops[1].travelMinutes=40;stops[1].travelSignature=legSignature(stops,1);
 assert.equal(savedTravelMinutes(stops,1),40);assert.equal(routeLeg(stops,1).origin,'新千歲 CTS');
 stops[0].flight={...stops[0].flight,arrivalAirport:'羽田 HND'};
 assert.equal(routeLeg(stops,1).origin,'羽田 HND');assert.equal(savedTravelMinutes(stops,1),null);
});

test('day renames merge with other edits and simultaneous day renames require an explicit choice',()=>{
 const base=[{date:'4/12',title:'出發',stops:plannedStops()}],mine=structuredClone(base),theirs=structuredClone(base);
 mine[0].title='抵達北海道';theirs[0].stops[1].desc='先寄放行李';
 const merged=mergeTrip(base,mine,theirs);assert.equal(merged.unresolved.length,0);assert.equal(merged.days[0].title,'抵達北海道');assert.equal(merged.days[0].stops[1].desc,'先寄放行李');
 theirs[0].title='旅程開始';const conflict=mergeTrip(base,mine,theirs);assert.deepEqual(conflict.unresolved.map(item=>item.key),['day-title:0']);
 const resolved=mergeTrip(base,mine,theirs,{'day-title:0':'mine'});assert.equal(resolved.unresolved.length,0);assert.equal(resolved.days[0].title,'抵達北海道');assert.equal(resolved.days[0].stops[1].desc,'先寄放行李');
});

test('simultaneous flight-detail edits preserve one complete chosen flight record',()=>{
 const base=[{date:'4/12',title:'出發',stops:plannedStops()}],mine=structuredClone(base),theirs=structuredClone(base);
 mine[0].stops[0].flight={...mine[0].stops[0].flight,number:'DEMO200'};theirs[0].stops[0].flight={...theirs[0].stops[0].flight,bookingReference:'DEMO999'};
 const conflict=mergeTrip(base,mine,theirs);assert.deepEqual(conflict.unresolved.map(item=>item.key),['flight-one:flight']);
 for(const side of ['mine','theirs']){
  const result=mergeTrip(base,mine,theirs,{'flight-one:flight':side});assert.equal(result.unresolved.length,0);assert.deepEqual(result.days[0].stops[0].flight,(side==='mine'?mine:theirs)[0].stops[0].flight);
 }
});

test('choosing a flight version keeps its departure airport and matching map coordinates together',()=>{
 const base=[{date:'4/12',title:'出發',stops:plannedStops()}],mine=structuredClone(base),theirs=structuredClone(base);
 const local=mine[0].stops[0];local.flight={...local.flight,departureAirport:'松山 TSA'};local.q=local.routeQuery='松山 TSA';local.coordinates={lat:25.0697,lng:121.5525};
 theirs[0].stops[0].flight={...theirs[0].stops[0].flight,bookingReference:'DEMO999'};
 assert.deepEqual(mergeTrip(base,mine,theirs).unresolved.map(item=>item.key),['flight-one:flight']);
 for(const side of ['mine','theirs']){
  const result=mergeTrip(base,mine,theirs,{'flight-one:flight':side});assert.equal(result.unresolved.length,0);
  const chosen=(side==='mine'?mine:theirs)[0].stops[0],stop=result.days[0].stops[0];
  assert.equal(stop.q,chosen.flight.departureAirport);assert.equal(stop.routeQuery,chosen.flight.departureAirport);assert.deepEqual(stop.coordinates,chosen.coordinates);assert.deepEqual(stop.flight,chosen.flight);
  const validated=validateDays(result.days,{id:'flight-merge',...metadata})[0].stops[0];assert.equal(validated.q,chosen.flight.departureAirport);assert.deepEqual(validated.coordinates,chosen.coordinates);
 }
});

test('static rebuilding prunes unallowlisted nested vendor files while preserving Leaflet assets',()=>{
 const output=buildDemo(),stale=path.join(output,'vendor','old.json'),nested=path.join(output,'vendor','leaflet','old-script.js');
 fs.mkdirSync(path.dirname(stale),{recursive:true});fs.writeFileSync(stale,'{"notAllowed":true}');fs.writeFileSync(nested,'throw Error("stale")');
 buildDemo();assert.equal(fs.existsSync(stale),false);assert.equal(fs.existsSync(nested),false);
 assert.ok(fs.readFileSync(path.join(output,'vendor','leaflet','leaflet.js'),'utf8').includes('Leaflet'));
 assert.equal(fs.readFileSync(path.join(output,'vendor','leaflet','images','marker-icon.png')).subarray(1,4).toString(),'PNG');
});
