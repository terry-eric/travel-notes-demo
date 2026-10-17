import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCoordinates,getStopCoordinates,buildRouteMapModel,duplicatePinOffsets} from '../public/map-coordinates.js';

test('coordinates validate bounds and reject coercions, infinities and malformed fields',()=>{
 assert.deepEqual(normalizeCoordinates({lat:' 25.1 ',lng:121.5}),{lat:25.1,lng:121.5});
 assert.deepEqual(normalizeCoordinates({lat:0,lng:0}),{lat:0,lng:0});
 assert.deepEqual(normalizeCoordinates({lat:-90,lng:180}),{lat:-90,lng:180});
 for(const value of [null,[],{lat:'',lng:121},{lat:null,lng:121},{lat:true,lng:121},{lat:91,lng:121},{lat:25,lng:-181},{lat:Infinity,lng:121},{lat:'25 degrees',lng:121}])assert.equal(normalizeCoordinates(value),null);
});

test('pins use explicit coordinates and real Google place destinations, never a viewport or name',()=>{
 assert.deepEqual(getStopCoordinates({coordinates:{lat:25,lng:121},q:'35,135'}),{lat:25,lng:121});
 assert.deepEqual(getStopCoordinates({routeQuery:'35.01, 135.78',q:'Kyoto'}),{lat:35.01,lng:135.78});
 assert.deepEqual(getStopCoordinates({q:'-33.86,151.2'}),{lat:-33.86,lng:151.2});
 assert.deepEqual(getStopCoordinates({mapUrl:'https://www.google.com/maps/place/A/@43.01,141.1,17z/data=!4m6!3m5!1s123!8m2!3d43.0316221!4d141.3330979!16splace'}),{lat:43.0316221,lng:141.3330979});
 assert.deepEqual(getStopCoordinates({mapUrl:'https://maps.google.com/?q=25.03,121.5'}),{lat:25.03,lng:121.5});
 assert.deepEqual(getStopCoordinates({q:'https://www.google.co.jp/maps/search/?api=1&query=35.01%2C135.78'}),{lat:35.01,lng:135.78});
 for(const stop of [
  {name:'25.03,121.5'},
  {q:'Kyoto Station'},
  {mapUrl:'https://www.google.com/maps/place/Kyoto/@35.01,135.78,17z'},
  {mapUrl:'https://www.google.com/maps/place/Kyoto/@35.01,135.78,17z?ll=35.01,135.78'},
  {mapUrl:'https://maps.app.goo.gl/example'},
  {mapUrl:'https://evil.example/maps/place/A/data=!3d25!4d121'},
  {mapUrl:'https://www.google.com.evil.example/maps/place/A/data=!3d25!4d121'},
  {mapUrl:'https://www.google.com/maps/dir/A/B/data=!3d25!4d121'},
  {mapUrl:'https://www.google.com/maps/?q=91,181'},
  {mapUrl:'https://user:password@www.google.com/maps/?q=25,121'},
 ])assert.equal(getStopCoordinates(stop),null,JSON.stringify(stop));
});

test('unlocated stops retain their sequence numbers and break itinerary connections',()=>{
 const stops=[{id:'a',q:'25,121'},{id:'missing',name:'Some cafe'},{id:'b',q:'26,122'},{id:'c',q:'27,123'},{id:'missing2'},{id:'d',q:'28,124'}];
 const model=buildRouteMapModel(stops);
 assert.deepEqual(model.located.map(entry=>entry.number),[1,3,4,6]);
 assert.deepEqual(model.missing.map(entry=>entry.id),['missing','missing2']);
 assert.deepEqual(model.segments.map(segment=>segment.map(entry=>entry.id)),[['b','c']]);
 assert.equal(model.entries[0].stop,stops[0]);
 assert.deepEqual(buildRouteMapModel(null),{entries:[],located:[],missing:[],segments:[]});
});

test('repeated destination pins receive separate pixel positions without changing route coordinates',()=>{
 for(const count of [1,2,3,8,9,17,30]){
  const model=buildRouteMapModel(Array.from({length:count},(_,index)=>({id:`visit-${index}`,coordinates:{lat:25,lng:121}})));
  const offsets=duplicatePinOffsets(model.located);
  assert.equal(offsets.size,count);
  assert.equal(new Set([...offsets.values()].map(({x,y})=>`${x},${y}`)).size,count);
  assert.ok(model.located.every(entry=>entry.coordinates.lat===25&&entry.coordinates.lng===121));
 }
 const model=buildRouteMapModel([{id:'a',q:'25,121'},{id:'b',q:'26,122'}]);
 assert.deepEqual([...duplicatePinOffsets(model.located).values()],[{x:0,y:0},{x:0,y:0}]);
});
