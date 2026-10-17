import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCoordinates,getStopCoordinates,buildRouteMapModel,duplicatePinOffsets,ROUTE_DAY_COLORS} from '../public/map-coordinates.js';

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
 assert.deepEqual(buildRouteMapModel(null),{entries:[],located:[],missing:[],segments:[],days:[]});
});

test('whole-trip connections stop at date boundaries and keep per-day colors in single-day views',()=>{
 const stops=[
  {id:'a',q:'25,121',dayIndex:0,date:'2027-01-01'},
  {id:'b',q:'26,122',dayIndex:0,date:'2027-01-01'},
  {id:'c',q:'26,122',dayIndex:1,date:'2027-01-02'},
  {id:'d',q:'27,123',dayIndex:1,date:'2027-01-02'},
  {id:'e',dayIndex:1,date:'2027-01-02'},
  {id:'f',q:'28,124',dayIndex:1,date:'2027-01-02'},
 ];
 const model=buildRouteMapModel(stops),single=buildRouteMapModel(stops.slice(2));
 assert.deepEqual(model.segments.map(segment=>segment.map(entry=>entry.id)),[['a','b'],['c','d']]);
 assert.deepEqual(model.days.map(day=>day.label),['2027-01-01','2027-01-02']);
 assert.equal(model.entries[2].day.color,single.entries[0].day.color);
 assert.notEqual(model.entries[0].day.color,model.entries[2].day.color);
 assert.deepEqual(model.located.map(entry=>entry.number),[1,2,3,4,6]);
 const duplicateOffsets=duplicatePinOffsets(model.located);
 assert.notDeepEqual(duplicateOffsets.get('b'),duplicateOffsets.get('c'));
 assert.deepEqual(model.entries[1].coordinates,model.entries[2].coordinates);
});

test('date-only lists are stable and changed dates always break connections, even with reused indices',()=>{
 const first={id:'a',q:'25,121',date:'2027-01-01'},second={id:'b',q:'26,122',date:'2027-01-02'};
 const model=buildRouteMapModel([first,second]);
 assert.deepEqual(model.segments,[]);
 assert.equal(model.entries[1].day.color,buildRouteMapModel([second]).entries[0].day.color);
 assert.deepEqual(buildRouteMapModel([{...first,dayIndex:0},{...second,dayIndex:0}]).segments,[]);
 const invalid=buildRouteMapModel([{id:'x',dayIndex:-1,date:null,dayColor:'url(javascript:bad)',q:'25,121'}]);
 assert.equal(invalid.entries[0].day.color,ROUTE_DAY_COLORS[0]);
 assert.equal(invalid.days[0].label,'行程');
});

test('day palette offers twelve distinct readable colors for white numbered pins',()=>{
 assert.equal(new Set(ROUTE_DAY_COLORS).size,12);
 const linear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
 for(const color of ROUTE_DAY_COLORS){
  assert.match(color,/^#[0-9a-f]{6}$/);
  const channels=[1,3,5].map(start=>linear(parseInt(color.slice(start,start+2),16)/255));
  const luminance=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
  assert.ok(1.05/(luminance+.05)>=4.5,`${color} needs readable white pin numbers`);
 }
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
