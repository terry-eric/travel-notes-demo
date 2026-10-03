import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccess} from '../server/cloudflare-auth.js';
import worker from '../server/cloudflare.js';
import {readRoute,routeUrl} from '../public/routes.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {seedDays} from '../public/seed.js';
import {accessPage} from '../server/access-page.js';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const issuer='https://trip-test.cloudflareaccess.com';
const target={APP_HOST:'trip.example.com',APP_BASE:'/trip'};
test('Cloudflare subpath links retain day and stop selections',()=>{
 for(const page of ['overview','daily','map','notes']){
  const href=routeUrl(page,2,4,'/trip'),route=readRoute(href,'/trip');
  assert.ok(href.startsWith('/trip/'));assert.equal(route.page,page);
  if(['daily','map'].includes(page))assert.deepEqual(route,{page,day:2,stop:4});
 }
});
test('Access signatures, expiry, audience and owner are verified',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
 const config={issuer,audience:'trip-aud',email:'owner@example.com'};
 const claims={iss:issuer,aud:['trip-aud'],email:config.email,sub:'owner',exp:200,nbf:50};
 async function signed(body=claims){const payload=encode({alg:'RS256',kid:key.kid})+'.'+encode(body);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(payload));return payload+'.'+Buffer.from(signature).toString('base64url');}
 const token=await signed();const keys=async()=>[key];
 assert.deepEqual(await verifyAccess(token,config,keys,100),{email:config.email,sub:'owner'});
 for(const body of [{...claims,exp:100},{...claims,aud:['other']},{...claims,email:'other@gmail.com'},{...claims,iss:'https://evil.example'},{...claims,nbf:101}])assert.equal(await verifyAccess(await signed(body),config,keys,100),null);
 assert.equal(await verifyAccess(token.slice(0,-20)+'A'.repeat(20),config,keys,100),null);
 assert.equal(await verifyAccess('bad',config,keys,100),null);
});
test('Cloudflare deployment fails closed and ignores spoofed Sites identity',async()=>{
 const req=path=>new Request('https://trip.example.com'+path,{headers:{'oai-authenticated-user-id':'owner@example.com'}});
 for(const path of ['/trip','/trip/api/trip'])assert.equal((await worker.fetch(req(path),target)).status,503);
 assert.equal((await worker.fetch(req('/trip/api/trip'),{...target,ACCESS_ISSUER:issuer,ACCESS_AUD:'trip-aud',OWNER_EMAIL:'owner@example.com'})).status,401);
 const page=await worker.fetch(req('/trip'),{...target,ACCESS_ISSUER:issuer,ACCESS_AUD:'trip-aud',OWNER_EMAIL:'owner@example.com'});assert.equal(page.status,401);assert.match(page.headers.get('Content-Type'),/text\/html/);assert.match(await page.text(),/請重新登入/);
 for(const path of ['/roomly','/','/tripper'])assert.equal((await worker.fetch(req(path),target)).status,404);
});

test('account recovery escapes identity, contains no redirect injection, and uses the Access logout endpoint',async()=>{
 const request=new Request('https://trip.example.com/trip?next=https://evil.example'),response=accessPage(request,'<script>alert(1)</script>@example.com'),html=await response.text();
 assert.equal(response.status,403);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Content-Security-Policy'),/default-src 'none'/);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('evil.example'));assert.match(html,/href="\/cdn-cgi\/access\/logout"/);assert.match(html,/目前登入帳號/);
 const head=accessPage(new Request(request.url,{method:'HEAD'}),'person@example.com');assert.equal(head.status,403);assert.equal(await head.text(),'');
});

test('signed whitelist members share the owner trip, viewers cannot write, and revoked accounts are denied',async()=>{
 const DB=localDatabase(),realFetch=globalThis.fetch;
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'sharing-key'};
 const env={...target,DB,ACCESS_ISSUER:'https://trip-sharing-test.cloudflareaccess.com',ACCESS_AUD:'share-aud',OWNER_EMAIL:'owner@example.com'};
 globalThis.fetch=async url=>{assert.equal(url,env.ACCESS_ISSUER+'/cdn-cgi/access/certs');return Response.json({keys:[key]});};
 async function request(path,email,method='GET',body,client='multi-1'){
  const payload=encode({alg:'RS256',kid:key.kid})+'.'+encode({iss:env.ACCESS_ISSUER,aud:[env.ACCESS_AUD],email,sub:email,exp:Date.now()/1000+60});
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(payload));
  return worker.fetch(new Request('https://trip.example.com/trip'+path,{method,headers:{'Cf-Access-Jwt-Assertion':payload+'.'+Buffer.from(sig).toString('base64url'),'Content-Type':'application/json',...(client?{'X-Trip-Client':client}:{}),Origin:'https://trip.example.com','oai-authenticated-user-id':'spoofed-user'},body:body?JSON.stringify(body):undefined}),env);
 }
 try{
  const owner=env.OWNER_EMAIL,viewer='friend@example.com',editor='editor@example.com';
  for(const [path,search] of [['','?day=2'],['/','?trip=legacy-hokkaido-2026&day=3']]){
   const redirected=await request(path+search,owner);assert.equal(redirected.status,302);assert.equal(redirected.headers.get('Location'),'https://trip.example.com/trip/trips'+search);
  }
  assert.equal((await request('/trips',owner,'HEAD')).status,200);
  assert.equal((await request('/trips','unlisted@example.com','HEAD')).status,200);
  const days=structuredClone(seedDays);days[0].stops[0].desc='Owner private trip';
  await DB.prepare('INSERT INTO trips(user_id,payload,previous,revision,mutation_id,updated_at) VALUES (?,?,?,?,?,?)').bind(owner,JSON.stringify(days),JSON.stringify(seedDays),6,'migration','now').run();
  const denied=await request('/api/trip','unlisted@example.com');assert.equal(denied.status,403);assert.match(denied.headers.get('Content-Type'),/application\/json/);assert.match((await denied.json()).error,/權限/);
  const personalPage=await request('/app.js','unlisted@example.com');assert.equal(personalPage.status,200);assert.equal((await request('/seed.js','unlisted@example.com')).status,404);const personal=await(await request('/api/session','unlisted@example.com')).json();assert.equal(personal.role,'personal');assert.equal((await(await request('/api/trips','unlisted@example.com')).json()).trips.length,0);
  for(const [email,role] of [[viewer,'viewer'],[editor,'editor']])assert.equal((await request('/api/shares',owner,'PUT',{email,role,enabled:true})).status,200);
  const data=await(await request('/api/trip',viewer)).json();assert.equal(data.days[0].stops[0].desc,'Owner private trip');assert.equal(data.revision,6);assert.equal(data.previous,null);
  assert.equal((await request('/api/trip?revision=6',viewer)).status,204);
  assert.equal((await request('/api/shares',viewer)).status,403);
  assert.equal((await request('/api/shares',editor,'PUT',{email:'other@example.com',role:'editor',enabled:true})).status,403);
  assert.equal((await request('/api/trip',viewer,'PUT',{days,revision:6,mutationId:'viewer-write'})).status,403);
  assert.equal((await request('/api/trip',owner,'PUT',{days,revision:6,mutationId:'old-client'},null)).status,428);
  const next=structuredClone(days);next[0].stops[0].desc='Shared edit';assert.equal((await request('/api/trip',editor,'PUT',{days:next,revision:6,mutationId:'editor-write'})).status,200);
  assert.equal((await(await request('/api/trip',owner)).json()).days[0].stops[0].desc,'Shared edit');
  const viewerUpdate=await request('/api/trip?revision=6',viewer);assert.equal(viewerUpdate.status,200);assert.equal((await viewerUpdate.json()).previous,null);
  await request('/api/shares',owner,'PUT',{email:viewer,role:'viewer',enabled:false});assert.equal((await request('/api/trip',viewer)).status,403);
  assert.equal((await request('/api/session',owner)).status,200);
 }finally{globalThis.fetch=realFetch;DB.close();}
});
