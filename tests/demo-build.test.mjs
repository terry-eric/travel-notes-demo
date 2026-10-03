import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildDemo} from '../scripts/build-demo.mjs';
import {spawn} from 'node:child_process';

test('static output is allowlisted, relative, browser-only and starts from demo bootstrap',()=>{
 const output=buildDemo(),html=fs.readFileSync(path.join(output,'index.html'),'utf8');
 assert.match(html,/src="\.\/demo\/bootstrap\.js"/);assert.doesNotMatch(html,/src="\/(?:app|web-app)\.js"/);assert.doesNotMatch(html,/href="\//);assert.match(html,/index\.html\?page=daily/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(output,'manifest.webmanifest'))).start_url,'./index.html?page=trips');
 for(const forbidden of ['server','db','drizzle','.env','.openai','wrangler.toml','seed.js','package.json'])assert.equal(fs.existsSync(path.join(output,forbidden)),false,forbidden+' must not enter public output');
 const bootstrap=fs.readFileSync(path.join(output,'demo/bootstrap.js'),'utf8');assert.match(bootstrap,/示範模式 · 資料只儲存在此瀏覽器/);assert.ok(bootstrap.indexOf('globalThis.fetch=')<bootstrap.indexOf("await import('../app.js')"));
 assert.doesNotMatch(fs.readFileSync(path.join(output,'demo/api.js'),'utf8'),/\.\.\/public\//);
 assert.match(fs.readFileSync(path.join(output,'app.js'),'utf8'),/已儲存至此瀏覽器/);
 const extra=path.join(output,'accidental-backend.txt');fs.writeFileSync(extra,'discard');buildDemo();assert.equal(fs.existsSync(extra),false);
});

test('loopback static server handles root and query deep links under a repo subpath',async t=>{
 const child=spawn(process.execPath,['scripts/dev-demo.mjs','--base=/repo-demo'],{cwd:path.resolve(''),stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Demo server did not start')),8000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Demo: (http:\/\/127\.0\.0\.1:\d+\/repo-demo\/index\.html)/);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
 const root=await fetch(url.replace('/index.html','/'));assert.equal(root.status,200);
 const deep=await fetch(url+'?page=daily&trip=demo-kyoto-three-days&day=3&stop=2');assert.equal(deep.status,200);assert.match(await deep.text(),/demo\/bootstrap\.js/);
 assert.equal((await fetch(new URL('./demo/api.js',url))).status,200);assert.equal((await fetch(new URL('./app.js',url))).status,200);
 assert.equal((await fetch(new URL('./api/trips',url))).status,404);assert.equal((await fetch(new URL('./server/api.js',url))).status,404);assert.equal((await fetch(new URL('/index.html',url))).status,404);
});
