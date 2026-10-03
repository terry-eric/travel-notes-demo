import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoute,routeUrl,boundedSelection,pagePaths} from '../public/routes.js';

test('all static pages and deep selections resolve to a real index at a repository subpath',()=>{
 for(const base of ['', '/travel-notes-demo','/parent/demo'])for(const page of Object.keys(pagePaths)){
  const href=routeUrl(page,2,8,base,'demo-trip',true),url=new URL(href,'https://example.github.io');
  assert.equal(url.pathname,base+'/index.html');assert.equal(url.searchParams.get('trip'),'demo-trip');assert.equal(url.searchParams.get('page'),page);
  assert.equal(readRoute(url.href,base,true).page,page);
  if(page==='daily'||page==='map')assert.deepEqual(readRoute(url.href,base,true),{page,day:2,stop:8});
 }
});

test('hash bookmarks and malformed queries retain safe page and selection behavior',()=>{
 assert.deepEqual(readRoute('/repo/index.html?trip=demo#day-3-stop-4','/repo',true),{page:'daily',day:2,stop:3});
 assert.equal(readRoute('/repo/index.html#map-panel','/repo',true).page,'map');
 assert.deepEqual(readRoute('/repo/index.html?page=map&day=99&stop=-1','/repo',true),{page:'map',day:0,stop:0});
 assert.equal(readRoute('/repo/index.html?page=constructor','/repo',true).page,'overview');
 assert.deepEqual(boundedSelection([{stops:[{}]}],2,8),{day:0,stop:0});
});

test('cloud routes preserve path navigation when the static mode is absent',()=>{
 assert.equal(routeUrl('daily',1,2,'/trip','live-trip'),'/trip/daily?trip=live-trip&day=2&stop=3');
 assert.equal(readRoute('/trip/index.html?page=trips','/trip').page,'overview');
});
