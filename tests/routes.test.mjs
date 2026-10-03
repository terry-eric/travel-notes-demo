import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoute,routeUrl,pagePaths,boundedSelection} from '../public/routes.js';

test('each page has an independent URL and daily/map selections survive reload',()=>{
 for(const page of Object.keys(pagePaths)){
  const href=routeUrl(page,3,7),route=readRoute(href);
  assert.equal(route.page,page);
  if(page==='daily'||page==='map'){assert.equal(route.day,3);assert.equal(route.stop,7);}
 }
 assert.equal(new Set(Object.values(pagePaths)).size,5);
});
test('old bookmarks remain usable and malformed day selections are bounded',()=>{
 assert.deepEqual(readRoute('/#day-3-stop-4'),{page:'daily',day:2,stop:3});
 assert.equal(readRoute('/#map-panel').page,'map');
 assert.equal(readRoute('/#before').page,'notes');
 assert.deepEqual(readRoute('/map?day=99&stop=-1'),{page:'map',day:0,stop:0});
 assert.equal(readRoute('/').page,'overview');
});
test('longer trips keep their trip identifier across every page and support the final day',()=>{
 for(const page of Object.keys(pagePaths)){
  const href=routeUrl(page,59,99,'/trip','personal-new-year');
  assert.equal(new URL(href,'https://example.com').searchParams.get('trip'),'personal-new-year');
  assert.equal(readRoute(href,'/trip').page,page);
  if(page==='daily'||page==='map')assert.deepEqual(readRoute(href,'/trip'),{page,day:59,stop:99});
 }
 assert.equal(readRoute('/trip/daily?day=61','/trip').day,0);
});
test('deep-link selections survive initial loading and are bounded by the actual trip after loading',()=>{
 const route=readRoute('/trip/daily?trip=new-year&day=60&stop=8','/trip');
 assert.deepEqual(boundedSelection([],route.day,route.stop),{day:59,stop:7});
 const longTrip=Array.from({length:60},()=>({stops:Array.from({length:10},()=>({}))}));
 assert.deepEqual(boundedSelection(longTrip,route.day,route.stop),{day:59,stop:7});
 assert.deepEqual(boundedSelection([{stops:[]}],route.day,route.stop),{day:0,stop:0});
 assert.deepEqual(boundedSelection([{stops:[{}]}],-1,NaN),{day:0,stop:0});
});
