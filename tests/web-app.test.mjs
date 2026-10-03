import test from 'node:test';
import assert from 'node:assert/strict';
import site from '../dist/server/index.js';
import cloudflare from '../server/cloudflare.js';

const get=path=>site.fetch(new Request('https://trip.example'+path),{});
test('the dedicated My Trips page is a reloadable shell without a trip selection',async()=>{
 const response=await get('/trips');assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/^text\/html/);
 const head=await site.fetch(new Request('https://trip.example/trips',{method:'HEAD'}),{});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await site.fetch(new Request('https://trip.example/trips',{method:'POST'}),{})).status,405);
 assert.equal((await get('/trips-unknown')).status,404);
});
test('install manifest has standalone launch, credentialed loading and icons within its own scope',async()=>{
 const response=await get('/manifest.webmanifest');assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Type'),/^application\/manifest\+json/);
 const manifest=await response.json();assert.equal(manifest.display,'standalone');
 for(const base of ['/','/trip/']){
  const location=new URL(base+'manifest.webmanifest','https://trip.example');
  assert.equal(new URL(manifest.scope,location).pathname,base);
  assert.equal(new URL(manifest.id,location).pathname,base);
  assert.equal(new URL(manifest.start_url,location).pathname,base+'trips');
  for(const icon of manifest.icons)assert.ok(new URL(icon.src,location).pathname.startsWith(base));
 }
 const html=await(await get('/trips')).text();
 assert.match(html,/<link rel="manifest"[^>]*crossorigin="use-credentials"/);
 assert.match(html,/viewport-fit=cover/);
});

test('launcher PNGs survive the Worker build as actual sized binary images, including HEAD responses',async()=>{
 for(const size of [180,192,512]){
  const response=await get('/icon-'+size+'.png');assert.equal(response.status,200);
  assert.equal(response.headers.get('Content-Type'),'image/png');
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  const head=await site.fetch(new Request('https://trip.example/icon-'+size+'.png',{method:'HEAD'}),{});
  assert.equal(head.headers.get('Content-Type'),'image/png');assert.equal((await head.arrayBuffer()).byteLength,0);
 }
 assert.equal((await get('/icons/unknown.png')).status,404);
 for(const path of ['/responsive.css','/web-app.js'])assert.equal((await get(path)).status,200);
});

test('Web App assets retain the same authentication gate as the itinerary',async()=>{
 const env={APP_HOST:'trip.example.com',APP_BASE:'/trip',ACCESS_ISSUER:'https://trip-test.cloudflareaccess.com',ACCESS_AUD:'trip-test'};
 for(const path of ['/trip/trips','/trip/manifest.webmanifest','/trip/icon-192.png','/trip/web-app.js']){
  const response=await cloudflare.fetch(new Request('https://trip.example.com'+path),env);
  assert.equal(response.status,401);assert.match(response.headers.get('Content-Type'),/text\/html/);
 }
});
