import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildEntry,liveAppUrl} from '../scripts/build-entry.mjs';

test('Pages publishes only a fixed live-domain entry and clears stale demo artifacts',()=>{
 const output=buildEntry();
 fs.mkdirSync(path.join(output,'demo'),{recursive:true});
 fs.writeFileSync(path.join(output,'demo','seed.js'),'stale synthetic seed');
 fs.writeFileSync(path.join(output,'app.js'),'stale app');
 buildEntry();
 assert.deepEqual(fs.readdirSync(output).sort(),['.nojekyll','404.html','index.html']);
 assert.equal(liveAppUrl,'https://demo.terry878.org/trip');
 for(const name of ['index.html','404.html']){
  const html=fs.readFileSync(path.join(output,name),'utf8');
  assert.ok(html.includes(`<meta http-equiv="refresh" content="1;url=${liveAppUrl}">`));
  assert.ok(html.includes(`<link rel="canonical" href="${liveAppUrl}">`));
  assert.ok(html.includes(`<a href="${liveAppUrl}">開啟我的旅行</a>`));
  assert.doesNotMatch(html,/<script|localStorage|bootstrap\.js|seed\.js|searchParams|fetch\(/);
 }
 const workflow=fs.readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.match(workflow,/npm run build:entry/);
 assert.match(workflow,/path: _pages/);
 assert.doesNotMatch(workflow,/build:demo|path: _site/);
});
