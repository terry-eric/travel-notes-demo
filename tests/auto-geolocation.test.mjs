import test from 'node:test';
import assert from 'node:assert/strict';
import {localDatabase} from '../scripts/local-db.mjs';
import {getLocationQuery,knownStopPoint,geocodeStopKey,applyGeocodeOverlay} from '../public/auto-geolocation.js';
import {handleGeocode,photonCandidates,geocodeProvider,safeGeocodeQuery,reserveGeocodeRequest} from '../server/geocode.js';

const owner='owner@example.com',viewer='viewer@example.com',origin='https://trip.example';
const query='清水寺 京都市 日本',point={lat:34.9948,lng:135.785};
const feature=(properties={},coordinates=[point.lng,point.lat])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{name:'清水寺',city:'京都市',state:'京都府',country:'Japan',countrycode:'JP',osm_key:'amenity',osm_value:'place_of_worship',...properties}});
const response=data=>Response.json(data??{features:[feature()]});
function database(stops=[{id:'stop-1',q:query}],id='trip-1'){
 const db=localDatabase();
 db.prepare('INSERT INTO itineraries(id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,'Private trip','2026-12-26','2027-01-01','Asia/Tokyo',JSON.stringify([{stops}]),null,42,'saved','now','now').run();
 return db;
}
function request(body={trip:'trip-1',id:'stop-1'},email=owner,headers={},method='POST'){
 return new Request(origin+'/api/geocode',{method,headers:{'Content-Type':'application/json',Origin:origin,...(email?{'oai-authenticated-user-id':email}:{}),...headers},body:method==='GET'?undefined:JSON.stringify(body)});
}
async function lookup(db,options={},body){const res=await handleGeocode(request(body),{DB:db},options);return {status:res.status,...await res.json()};}

test('explicit destinations and unique same-trip peers resolve without guessing a camera coordinate',()=>{
 const shared='https://maps.app.goo.gl/shared',stop={id:'a',mapUrl:shared};
 const peer={id:'b',q:query,mapUrl:shared,coordinates:point};
 assert.deepEqual(knownStopPoint(stop,[stop,peer]),point);
 assert.deepEqual(knownStopPoint({id:'c',q:query},[peer]),point);
 assert.equal(knownStopPoint({q:query},[peer,{q:query,coordinates:{lat:1,lng:2}}]),null);
 assert.equal(knownStopPoint({q:'other'},[peer]),null);
 assert.equal(knownStopPoint({mapUrl:'https://www.google.com/maps/@1,2,17z'}),null);
 assert.deepEqual(knownStopPoint({q:'34.9948,135.785'}),point);
 assert.equal(getLocationQuery({q:'old',routeQuery:' new '}),'new');
});

test('overlay clones the itinerary and ignores replies from another trip or edited destination',()=>{
 const stop={id:'a',q:query},days=[{stops:[stop]}],results=new Map([[geocodeStopKey('trip-1',stop),{status:'resolved',coordinates:point}]]);
 const applied=applyGeocodeOverlay(days,results,'trip-1');assert.deepEqual(applied[0].stops[0].coordinates,point);assert.equal(stop.coordinates,undefined);
 assert.equal(applyGeocodeOverlay(days,results,'trip-2')[0].stops[0].coordinates,undefined);
 assert.equal(applyGeocodeOverlay([{stops:[{...stop,q:'清水寺 東京'}]}],results,'trip-1')[0].stops[0].coordinates,undefined);
 const saved={...stop,coordinates:{lat:1,lng:2}};assert.deepEqual(applyGeocodeOverlay([{stops:[saved]}],results,'trip-1')[0].stops[0].coordinates,saved.coordinates);
 assert.equal(applyGeocodeOverlay(days,new Map([[geocodeStopKey('trip-1',stop),{status:'ambiguous',coordinates:point}]]),'trip-1')[0].stops[0].coordinates,undefined);
});

test('Photon requires a unique exact POI name and region, and never selects an administrative centroid',()=>{
 assert.deepEqual(photonCandidates({features:[feature()]},query).coordinates,point);
 assert.equal(photonCandidates({features:[feature()]},'清水寺').status,'ambiguous');
 assert.equal(photonCandidates({features:[feature()]},'清水寺 日本').status,'ambiguous');
 assert.equal(photonCandidates({features:[feature()]},'清水寺 東京都 日本').status,'ambiguous');
 assert.equal(photonCandidates({features:[feature({name:'清水'})]},query).status,'ambiguous');
 assert.equal(photonCandidates({features:[feature({name:'京都市',osm_key:'place',osm_value:'city'})]},'京都市 日本').status,'ambiguous');
 assert.equal(photonCandidates({features:[feature(),feature({},[135.8,35.1])]},query).status,'ambiguous');
 assert.equal(photonCandidates({features:[feature(),feature()]},query).status,'resolved');
 assert.equal(photonCandidates({features:[feature({},[181,91])]},query).status,'not_found');
 assert.throws(()=>photonCandidates({},query));
});

test('an exact street, house number and region can locate an address without accepting a city-only result',()=>{
 const addressFeature=feature({name:undefined,street:'潮路',housenumber:'1-3-18',city:'大阪市',state:'大阪府',district:'西成区'});
 assert.equal(photonCandidates({features:[addressFeature]},'日本 大阪市 西成区 潮路1-3-18').status,'resolved');
 assert.equal(photonCandidates({features:[addressFeature]},'日本 大阪市 潮路1-3-19').status,'ambiguous');
 const smallNumber=feature({name:undefined,street:'潮路',housenumber:'1',city:'大阪市',state:'大阪府'});
 assert.equal(photonCandidates({features:[smallNumber]},'大阪市潮路10').status,'ambiguous');
});

test('unsafe or credential-like queries and non-public provider URLs are rejected',()=>{
 for(const value of ['owner@example.com','訂位代號 ABC123','passport AB123','https://evil.example/','090-1234-5678','a'.repeat(301),'place\nsecret'])assert.equal(safeGeocodeQuery(value),null,value);
 assert.equal(safeGeocodeQuery('大阪市潮路1-3-18'),'大阪市潮路1-3-18');
 assert.equal(geocodeProvider({GEOCODE_URL:'disabled'}),null);
 assert.equal(geocodeProvider({GEOCODE_ENABLED:'false'}),null);
 for(const value of ['http://photon.komoot.io/api/','https://127.0.0.1/api/','https://[::1]/api/','https://localhost/api/','https://a.local/api/','https://user:secret@photon.komoot.io/api/','https://photon.komoot.io:8443/api/','https://photon.komoot.io/api/?q=x'])assert.throws(()=>geocodeProvider({GEOCODE_URL:value}),value);
 assert.equal(geocodeProvider({GEOCODE_URL:'https://geocoder.example.org/api/'}).origin,'https://geocoder.example.org');
});

test('authentication, same-origin, existing membership and stop identity are checked before any network call',async()=>{
 const DB=database();let calls=0;const fetcher=async()=>{calls++;return response();};
 try{
  for(const [req,expected] of [[request(undefined,null),401],[request(undefined,owner,{Origin:'https://evil.example'}),403],[request(undefined,owner,{},'GET'),405],[request(undefined,'other@example.com'),403],[request({trip:'missing',id:'stop-1'}),403],[request({trip:'trip-1',id:'missing'}),404],[request({trip:'trip-1',id:'stop-1',query:'other'}),409],[request({trip:'trip-1',id:'stop-1',url:'https://evil.example'}),400]])assert.equal((await handleGeocode(req,{DB},{fetcher,now:10000})).status,expected);
  assert.equal(calls,0);
  await DB.prepare('INSERT INTO itinerary_members(trip_id,email,role,enabled,updated_at) VALUES (?,?,?,?,?)').bind('trip-1',viewer,'viewer',1,'now').run();
  assert.equal((await handleGeocode(request(undefined,viewer),{DB},{fetcher,now:10000})).status,200);
  assert.equal(calls,1);
  await DB.prepare('UPDATE itinerary_members SET enabled=0 WHERE email=?').bind(viewer).run();
  assert.equal((await handleGeocode(request(undefined,viewer),{DB},{fetcher,now:12000})).status,403);
  assert.equal(calls,1);
 }finally{DB.close();}
});

test('known points work with external service disabled and never mutate the trip revision or payload',async()=>{
 const url='https://www.google.com/maps/place/Temple/@1,2,17z/data=!3d34.9948!4d135.785';
 const DB=database([{id:'stop-1',mapUrl:url}]);let calls=0;
 try{
  const before=await DB.prepare('SELECT revision,payload FROM itineraries WHERE id=?').bind('trip-1').first();
  const res=await handleGeocode(request(),{DB,GEOCODE_URL:'disabled'},{fetcher:async()=>{calls++;throw Error();},now:10000});
  assert.deepEqual((await res.json()).coordinates,point);assert.equal(calls,0);
  assert.deepEqual(await DB.prepare('SELECT revision,payload FROM itineraries WHERE id=?').bind('trip-1').first(),before);
 }finally{DB.close();}
});

test('only whitelisted saved location text reaches Photon; request sends no account, notes, flight or booking data',async()=>{
 const DB=database([{id:'stop-1',q:query,name:'secret personal title',desc:'private note',flight:{bookingReference:'ABC123'}}]);let calls=0;
 try{
  const result=await lookup(DB,{now:10000,fetcher:async(url,options)=>{
   calls++;assert.equal(new URL(url).searchParams.get('q'),query);assert.equal(options.redirect,'manual');assert.ok(options.signal);assert.equal(options.body,undefined);
   assert.ok(!JSON.stringify([url,options]).includes(owner));assert.ok(!url.includes('ABC123'));assert.ok(!url.includes('private'));
   return response();
  }});
  assert.equal(result.status,'resolved');assert.deepEqual(result.coordinates,point);assert.equal(calls,1);
  const cached=await DB.prepare('SELECT * FROM place_geocode_cache').bind().first();assert.match(cached.query_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(cached).includes(query));assert.ok(!JSON.stringify(cached).includes(owner));assert.ok(!JSON.stringify(cached).includes('ABC123'));
 }finally{DB.close();}
});

test('short Google Maps links use safe HEAD redirects and return the true place point without Photon',async()=>{
 const short='https://maps.app.goo.gl/test',full='https://www.google.com/maps/place/Temple/@1,2,17z/data=!3d34.9948!4d135.785';
 const DB=database([{id:'stop-1',mapUrl:short}]);const urls=[];
 try{
  const result=await lookup(DB,{now:10000,fetcher:async(url,options)=>{urls.push(url);assert.equal(options.method,'HEAD');assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:full}});}});
  assert.equal(result.status,'resolved');assert.equal(result.source,'google-maps');assert.deepEqual(result.coordinates,point);assert.deepEqual(urls,[short]);
 }finally{DB.close();}
});

test('malicious Maps redirects are not fetched, and a provider redirect never follows to another host',async()=>{
 const DB=database([{id:'stop-1',q:query,mapUrl:'https://maps.app.goo.gl/test'}]);const urls=[];
 try{
  const result=await lookup(DB,{now:10000,fetcher:async(url,options)=>{urls.push(url);assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});}});
  assert.equal(result.status,'unavailable');assert.equal(urls.length,2);assert.equal(new URL(urls[0]).hostname,'maps.app.goo.gl');assert.equal(new URL(urls[1]).hostname,'photon.komoot.io');
  assert.ok(!urls.some(url=>url.includes('127.0.0.1')));
 }finally{DB.close();}
});

test('positive and negative cache lifetimes, changed queries and provider changes do not reuse stale points',async()=>{
 const DB=database();let calls=0;const fetcher=async()=>{calls++;return response();};
 try{
  const first=await lookup(DB,{fetcher,now:10000});assert.equal(first.cacheHit,false);
  const cached=await lookup(DB,{fetcher,now:10001});assert.equal(cached.cacheHit,true);assert.equal(calls,1);
  await lookup(DB,{fetcher,now:10000+30*86400000});assert.equal(calls,2);
  await DB.prepare('UPDATE itineraries SET payload=? WHERE id=?').bind(JSON.stringify([{stops:[{id:'stop-1',q:'清水寺 東京'}]}]),'trip-1').run();
  assert.equal((await lookup(DB,{fetcher,now:10000+30*86400000+2000})).status,'ambiguous');assert.equal(calls,3);
  assert.equal((await lookup(DB,{fetcher,now:10000+30*86400000+2001})).cacheHit,true);assert.equal(calls,3);
  await lookup(DB,{fetcher,now:10000+31*86400000+2000});assert.equal(calls,4);
  const res=await handleGeocode(request(),{DB,GEOCODE_URL:'https://geocoder.example.org/api/'},{fetcher,now:10000+31*86400000+4000});assert.equal((await res.json()).cacheHit,false);assert.equal(calls,5);
 }finally{DB.close();}
});

test('global SQL reservation allows only one concurrent request, enforces 1.5 seconds, 200 daily requests and resets next day',async()=>{
 const DB=database();
 try{
  assert.equal((await Promise.all(Array.from({length:10},()=>reserveGeocodeRequest(DB,10000)))).filter(Boolean).length,1);
  assert.equal(await reserveGeocodeRequest(DB,11499),false);assert.equal(await reserveGeocodeRequest(DB,11500),true);
  for(let i=2;i<200;i++)assert.equal(await reserveGeocodeRequest(DB,10000+i*1500),true);
  assert.equal(await reserveGeocodeRequest(DB,400000),false);
  assert.equal(await reserveGeocodeRequest(DB,86400000),true);
 }finally{DB.close();}
});

test('limited lookups return a usable state without a fetch, while cached hits bypass the rate gate',async()=>{
 const DB=database();let calls=0;
 try{
  await reserveGeocodeRequest(DB,10000);
  const limited=await lookup(DB,{now:10001,fetcher:async()=>{calls++;return response();}});assert.equal(limited.status,'limited');assert.equal(limited.reason,'rate_limit');assert.equal(limited.retryAfter,2);assert.equal(calls,0);
  await DB.prepare('UPDATE place_geocode_rate SET requests=200,next_request_at=? WHERE id=1').bind(1).run();
  const daily=await lookup(DB,{now:10001,fetcher:async()=>{calls++;return response();}});assert.equal(daily.reason,'daily_limit');assert.ok(daily.retryAfter>80000);assert.equal(calls,0);
 }finally{DB.close();}
});

test('a stalled external fetch aborts within the deadline and returns unavailable without a cache entry',{timeout:8000},async()=>{
 const DB=database();let signal;
 try{
  const result=await lookup(DB,{now:10000,fetcher:async(url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  assert.equal(result.status,'unavailable');assert.equal(signal.aborted,true);
  assert.equal(await DB.prepare('SELECT * FROM place_geocode_cache').bind().first(),null);
 }finally{DB.close();}
});

test('missing, unsafe, disabled and ambiguous places expose clear states rather than false pins',async()=>{
 for(const [stop,env,expected] of [[{id:'stop-1'},{},'missing_query'],[{id:'stop-1',q:owner},{},'unsafe_query'],[{id:'stop-1',q:query},{GEOCODE_URL:'disabled'},'disabled']]){
  const DB=database([stop]);try{const res=await handleGeocode(request(),{DB,...env},{fetcher:async()=>{throw Error('must not fetch');},now:10000});assert.equal((await res.json()).status,expected);}finally{DB.close();}
 }
 const DB=database();try{const res=await lookup(DB,{now:10000,fetcher:async()=>response({features:[feature(),feature({},[135.8,35.1])]})});assert.equal(res.status,'ambiguous');assert.equal(res.coordinates,undefined);assert.equal(res.candidates.length,2);assert.match(res.attribution,/OpenStreetMap/);}finally{DB.close();}
});

test('oversized and invalid provider responses fail without persisting failures as missing places',async()=>{
 for(const fetcher of [async()=>new Response('x'.repeat(70000),{headers:{'Content-Type':'application/json'}}),async()=>new Response('not-json',{headers:{'Content-Type':'application/json'}}),async()=>new Response('<html>',{headers:{'Content-Type':'text/html'}})]){
  const DB=database();try{assert.equal((await lookup(DB,{now:10000,fetcher})).status,'unavailable');assert.equal(await DB.prepare('SELECT * FROM place_geocode_cache').bind().first(),null);}finally{DB.close();}
 }
});
