import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/cloudflare.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {googleLoginPage,googleLogoutPage} from '../server/google-login-page.js';
import {GOOGLE_JWKS_URL,SESSION_COOKIE,CHALLENGE_COOKIE,tokenHash} from '../server/google-auth.js';
const origin='https://demo.terry878.org',clientId='123-google-worker.apps.googleusercontent.com';
const allow={limit:async()=>({success:true})};
const envFor=DB=>({DB,APP_HOST:new URL(origin).hostname,APP_BASE:'/trip',AUTH_MODE:'google',GOOGLE_CLIENT_ID:clientId,AUTH_LOGIN_LIMITER:allow,AUTH_API_LIMITER:allow,AUTH_WRITE_LIMITER:allow,OWNER_EMAIL:'owner@gmail.com'});
const request=(path,method='GET',body,cookie='',extra={})=>new Request(origin+'/trip'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-2',...(cookie?{Cookie:cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'google-worker-test-key'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function credential(nonce,email='owner@gmail.com',sub='google-owner'){
 const now=Math.floor(Date.now()/1000),payload=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://accounts.google.com',aud:clientId,sub,email,email_verified:true,iat:now,exp:now+3600,nonce});
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(payload));return payload+'.'+Buffer.from(signature).toString('base64url');
}
async function login(env,email,sub){
 const start=await worker.fetch(request('/login?return_to=%2Ftrip%2Ftrips'),env),html=await start.text(),nonce=/<script nonce="([^"]+)"/.exec(html)?.[1],challenge=start.headers.get('Set-Cookie')?.split(';')[0];
 const response=await worker.fetch(request('/api/auth/google','POST',{credential:await credential(nonce,email,sub)},challenge),env);
 assert.equal(response.status,200);return response.headers.getSetCookie().find(value=>value.startsWith(SESSION_COOKIE+'=')).split(';')[0];
}
test('Google deployment fails closed without configuration and keeps exact host and path boundaries',async()=>{
 const DB=localDatabase();try{
  assert.equal((await worker.fetch(request('/'),{AUTH_MODE:'google'})).status,503);
  assert.equal((await worker.fetch(request('/'),{DB,AUTH_MODE:'google',GOOGLE_CLIENT_ID:clientId})).status,503);
  assert.equal((await worker.fetch(request('/'),{...envFor(DB),GOOGLE_CLIENT_ID:'<script>'})).status,503);
  for(const url of ['https://evil.example/trip/login','http://demo.terry878.org/trip/login','https://demo.terry878.org:444/trip/login','https://demo.terry878.org/tripper/login','https://demo.terry878.org/roomly'])assert.equal((await worker.fetch(new Request(url),envFor(DB))).status,404);
 }finally{DB.close();}
});
test('Logged-out documents redirect safely to Google login while API and static assets expose no private data',async()=>{
 const DB=localDatabase(),env=envFor(DB);try{
  const response=await worker.fetch(request('/daily?trip=private&day=2'),env);assert.equal(response.status,302);
  const location=new URL(response.headers.get('Location'));assert.equal(location.pathname,'/trip/login');assert.equal(location.searchParams.get('return_to'),'/trip/daily?trip=private&day=2');
  for(const path of ['/api/session','/api/trip?trip=private','/app.js','/seed.js'])assert.equal((await worker.fetch(request(path,'GET',undefined,'',{'Cf-Access-Jwt-Assertion':'spoof','oai-authenticated-user-id':'owner@gmail.com'}),env)).status,401);
  const page=await worker.fetch(request('/login?return_to=https%3A%2F%2Fevil.example'),env),html=await page.text();assert.equal(page.status,200);assert.match(html,/accounts\.google\.com\/gsi\/client/);assert.match(html,/隱私說明/);assert.ok(!html.includes('evil.example'));assert.ok(!html.includes('legacy-hokkaido'));
  assert.match(page.headers.get('Set-Cookie'),new RegExp(CHALLENGE_COOKIE+'='));assert.match(page.headers.get('Content-Security-Policy'),/script-src 'nonce-/);assert.equal(page.headers.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');
  const head=await worker.fetch(request('/login','HEAD'),env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Set-Cookie'),null);
  const privacy=await worker.fetch(request('/privacy'),env);assert.equal(privacy.status,200);assert.match(await privacy.text(),/不要求讀取 Gmail 或 Google Drive/);
 }finally{DB.close();}
});
test('A Google session identifies only its owner, retains safe return navigation, and logout uses an explicit POST',async()=>{
 const DB=localDatabase(),env=envFor(DB),realFetch=globalThis.fetch;
 globalThis.fetch=async url=>{assert.equal(url,GOOGLE_JWKS_URL);return Response.json({keys:[jwk]},{headers:{'Cache-Control':'max-age=3600'}});};
 try{
  const cookie=await login(env,'new-person@gmail.com','google-new'),session=await worker.fetch(request('/api/session','GET',undefined,cookie,{'oai-authenticated-user-id':'owner@gmail.com','Cf-Access-Jwt-Assertion':'spoof'}),env);
  assert.equal(session.status,200);assert.deepEqual(await session.json(),{email:'new-person@gmail.com',role:'personal',canEdit:false,canShare:false,logoutUrl:'/trip/logout',trip:null});
  assert.equal((await (await worker.fetch(request('/api/trips','GET',undefined,cookie),env)).json()).trips.length,0);
  const destination=await worker.fetch(request('/login?return_to=%2Ftrip%2Fdaily%3Ftrip%3Dmine%26day%3D3','GET',undefined,cookie),env);assert.equal(destination.headers.get('Location'),origin+'/trip/daily?trip=mine&day=3');
  const out=await worker.fetch(request('/logout','GET',undefined,cookie),env);assert.equal(out.status,200);assert.match(await out.text(),/確認登出/);assert.equal((await worker.fetch(request('/api/session','GET',undefined,cookie),env)).status,200);
  assert.equal((await worker.fetch(request('/api/auth/logout','POST',{},cookie,{Origin:'https://evil.example'}),env)).status,403);
  assert.equal((await worker.fetch(request('/api/auth/logout','POST',{},cookie),env)).status,200);assert.equal((await worker.fetch(request('/api/session','GET',undefined,cookie),env)).status,401);
 }finally{globalThis.fetch=realFetch;DB.close();}
});
test('Public login rate limits run before any D1 access, and API limits run before content reads and writes',async()=>{
 let reads=0;
 const DB={prepare(){reads++;throw Error('Must not access D1');}},env=envFor(DB),deny={limit:async()=>({success:false})};
 for(const path of ['/login','/api/auth/google']){
  const response=await worker.fetch(request(path,path.includes('api')?'POST':'GET',path.includes('api')?{credential:'invalid'}:undefined),{...env,AUTH_LOGIN_LIMITER:deny});assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');assert.equal(reads,0);
 }
 const realDB=localDatabase();try{
  const token='A'.repeat(43),hash=await tokenHash(token),now=Math.floor(Date.now()/1000);
  await realDB.prepare('INSERT INTO auth_sessions(token_hash,email,google_sub,created_at,expires_at) VALUES (?,?,?,?,?)').bind(hash,'rate@gmail.com','google-rate',now,now+86400).run();
  const sessionCookie=SESSION_COOKIE+'='+token;
  assert.equal((await worker.fetch(request('/api/trips','GET',undefined,sessionCookie),{...envFor(realDB),AUTH_API_LIMITER:deny})).status,429);
  assert.equal((await worker.fetch(request('/api/trips','POST',{title:'must not create',startDate:'2026-12-01',endDate:'2026-12-02'},sessionCookie),{...envFor(realDB),AUTH_WRITE_LIMITER:deny})).status,429);
  assert.equal((await realDB.prepare('SELECT count(*) AS count FROM itineraries').bind().first()).count,0);
 }finally{realDB.close();}
});
test('Google login/logout pages support a configured app base without mixing another service path',async()=>{
 const html=await googleLoginPage({clientId,nonce:'A'.repeat(43),base:'/journey'}).text();assert.match(html,/\/journey\/api\/auth\/google/);assert.match(html,/href="\/journey\/privacy"/);assert.ok(!html.includes('/trip/'));
 const out=await googleLogoutPage('B'.repeat(43),'GET','/journey').text();assert.match(out,/\/journey\/api\/auth\/logout/);assert.ok(!out.includes('/trip/'));
});

test('Google sessions use a fork\'s configured hostname and nested or root path consistently',async()=>{
 const realFetch=globalThis.fetch;
 globalThis.fetch=async url=>{assert.equal(url,GOOGLE_JWKS_URL);return Response.json({keys:[jwk]},{headers:{'Cache-Control':'max-age=3600'}});};
 try{
  for(const appBase of ['/private/journey','']){
   const DB=localDatabase(),host='journey.example.com',ownOrigin='https://'+host;
   const env={...envFor(DB),APP_HOST:host,APP_BASE:appBase};
   const req=(path,method='GET',body,cookie='')=>new Request(ownOrigin+path,{method,headers:{Origin:ownOrigin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   try{
    const start=await worker.fetch(req(appBase+'/login?return_to='+encodeURIComponent(appBase+'/daily?day=2')),env);
    assert.equal(start.status,200);const html=await start.text();
    assert.ok(html.includes(appBase+'/api/auth/google'));assert.ok(!html.includes('/trip/'));
    const nonce=/<script nonce="([^"]+)"/.exec(html)[1],challenge=start.headers.get('Set-Cookie').split(';')[0];
    const loggedIn=await worker.fetch(req(appBase+'/api/auth/google','POST',{credential:await credential(nonce,'fork@gmail.com','fork-sub')},challenge),env);
    assert.equal(loggedIn.status,200);assert.equal((await loggedIn.json()).returnTo,appBase+'/daily?day=2');
    const session=loggedIn.headers.getSetCookie().find(value=>value.startsWith(SESSION_COOKIE+'='));assert.ok(session.includes('Path='+(appBase||'/')+';'));
    const data=await worker.fetch(req(appBase+'/api/session','GET',undefined,session.split(';')[0]),env);
    assert.equal(data.status,200);assert.equal((await data.json()).logoutUrl,appBase+'/logout');
   }finally{DB.close();}
  }
 }finally{globalThis.fetch=realFetch;}
});
