import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/cloudflare.js';
import {GOOGLE_JWKS_URL,SESSION_COOKIE,CHALLENGE_COOKIE,loginChallenge} from '../server/google-auth.js';
import {localDatabase} from '../scripts/local-db.mjs';

const origin='https://demo.terry878.org',base=origin+'/trip';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const emailA='privacy-alice@gmail.com',emailB='privacy-bob@gmail.com',outsider='privacy-outsider@gmail.com';

test('verified direct Google sessions preserve legacy data while independent accounts and invitations remain isolated',async()=>{
 const DB=localDatabase(),realFetch=globalThis.fetch;
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'google-private-account-integration-key'};
 const allow={limit:async()=>({success:true})};
 const env={DB,APP_HOST:new URL(origin).hostname,APP_BASE:'/trip',AUTH_MODE:'google',GOOGLE_CLIENT_ID:'test-private-account.apps.googleusercontent.com',OWNER_EMAIL:'legacy-owner@gmail.com',AUTH_LOGIN_LIMITER:allow,AUTH_API_LIMITER:allow,AUTH_WRITE_LIMITER:allow};
 const now=Math.floor(Date.now()/1000);
 globalThis.fetch=async url=>{assert.equal(url,GOOGLE_JWKS_URL);return Response.json({keys:[jwk]},{headers:{'Cache-Control':'max-age=300'}});};
 async function login(email,sub=email,more={},expected=200){
  const challenge=await loginChallenge(new Request(base+'/login'),env,'/trip/trips',now);
  const payload=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,sub,email,email_verified:true,nonce:challenge.nonce,iat:now,exp:now+3600,...more});
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(payload));
  const response=await worker.fetch(new Request(base+'/api/auth/google',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:challenge.cookie.split(';')[0]},body:JSON.stringify({credential:payload+'.'+Buffer.from(signature).toString('base64url')})}),env);
  if(expected===null)return response;
  assert.equal(response.status,expected);if(expected!==200){assert.equal(response.headers.get('Set-Cookie'),null);return response;}
  assert.equal((await response.json()).returnTo,'/trip/trips');
  const raw=response.headers.get('Set-Cookie'),match=raw?.match(new RegExp('(?:^|,\\s*)('+SESSION_COOKIE+'=[A-Za-z0-9_-]{43})(?:;|$)'));
  assert.ok(match,'opaque session cookie set');assert.match(raw,/Secure; HttpOnly; SameSite=Lax/);return match[1];
 }
 async function request(path,cookie,method='GET',body,extra={}){
  return worker.fetch(new Request(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Trip-Client':'multi-2','oai-authenticated-user-id':env.OWNER_EMAIL,...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);
 }
 async function json(path,cookie){const response=await request(path,cookie);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');return response.json();}
 async function create(cookie,title){const response=await request('/api/trips',cookie,'POST',{title,startDate:'2028-05-01',endDate:'2028-05-02',timezone:'Asia/Tokyo'});assert.equal(response.status,201);return response.json();}
 const tripPath=id=>'/api/trip?trip='+id,sharePath=id=>'/api/shares?trip='+id;
 try{
  // Legacy trip fixtures precede Google adoption; login must not copy them to new accounts.
  const aCookie=await login(emailA,'alice-sub'),bCookie=await login(emailB,'bob-sub'),strangerCookie=await login(outsider,'outsider-sub');
  for(const cookie of [aCookie,bCookie,strangerCookie])assert.deepEqual((await json('/api/trips',cookie)).trips,[]);
  const a=await create(aCookie,'Alice private journey'),b=await create(bCookie,'Bob private journey');
  const ownerCookie=await login(env.OWNER_EMAIL,'legacy-owner-sub'),legacy=await json('/api/trip',ownerCookie);
  assert.equal(legacy.trip.id,'legacy-hokkaido-2026');assert.ok(legacy.days[0].stops.length>0);
  const secret='only Alice and her invited viewer can read this';
  a.days[0].title='私人的每日名稱';a.days[0].stops.push({id:'private-appointment',name:'私人預約',desc:secret,time:'10:30',duration:60,tag:'預約',live:true,q:'東京駅',coordinates:{lat:35.6812,lng:139.7671}});
  const savedResponse=await request(tripPath(a.trip.id),aCookie,'PUT',{days:a.days,revision:0,mutationId:'private-content'});assert.equal(savedResponse.status,200);
  const saved=await savedResponse.json();assert.equal(saved.trip.timezone,'Asia/Tokyo');assert.equal(saved.days[0].title,'私人的每日名稱');assert.equal(saved.days[0].stops[0].createdBy,emailA);
  assert.deepEqual((await json('/api/trips',aCookie)).trips.map(trip=>trip.id),[a.trip.id]);
  assert.deepEqual((await json('/api/trips',bCookie)).trips.map(trip=>trip.id),[b.trip.id]);
  const session=await json('/api/session?trip='+a.trip.id,aCookie);assert.equal(session.email,emailA);assert.equal(session.role,'owner');assert.equal(session.logoutUrl,'/trip/logout');
  for(const cookie of [bCookie,strangerCookie])for(const path of [tripPath(a.trip.id),tripPath(a.trip.id)+'&revision=1','/api/session?trip='+a.trip.id,sharePath(a.trip.id),'/api/trip']){
   const response=await request(path,cookie);assert.equal(response.status,403);const body=await response.text();assert.ok(!body.includes(secret));assert.ok(!body.includes('"days"'));assert.ok(!body.includes('"revision"'));
  }
  assert.equal((await request(tripPath(a.trip.id),bCookie,'PUT',{days:saved.days,revision:1,mutationId:'unauthorized-edit'})).status,403);
  assert.equal((await request(sharePath(a.trip.id),aCookie,'PUT',{email:emailB,role:'viewer',enabled:true})).status,200);
  const invited=await json(tripPath(a.trip.id),bCookie);assert.equal(invited.role,'viewer');assert.equal(invited.previous,null);assert.equal(invited.days[0].stops[0].desc,secret);
  assert.deepEqual(invited.days,saved.days);assert.equal((await json('/api/trips',bCookie)).trips.length,2);
  assert.equal((await request(sharePath(a.trip.id),bCookie,'PUT',{email:outsider,role:'editor',enabled:true})).status,403);
  assert.equal((await request(tripPath(a.trip.id),bCookie,'PUT',{days:invited.days,revision:1,mutationId:'viewer-edit'})).status,403);
  assert.equal((await request(sharePath(a.trip.id),aCookie,'PUT',{email:emailB,role:'viewer',enabled:false})).status,200);
  assert.equal((await request(tripPath(a.trip.id)+'&revision=1',bCookie)).status,403);
  assert.deepEqual((await json('/api/trips',bCookie)).trips.map(trip=>trip.id),[b.trip.id]);
  // Neither an old Access assertion nor a raw Google ID token replaces a valid cookie.
  for(const extra of [{'Cf-Access-Jwt-Assertion':'forged'},{Authorization:'Bearer forged'},{}])assert.equal((await request('/api/trips',null,'GET',undefined,extra)).status,401);
  assert.equal((await request('/api/trips',SESSION_COOKIE+'='+'a'.repeat(43))).status,401);
  assert.equal((await request('/api/trips',aCookie+'; '+aCookie)).status,401);
  assert.equal((await request('/api/auth/logout',aCookie,'POST',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await json('/api/session',aCookie)).email,emailA);
  assert.equal((await request('/api/auth/logout',aCookie,'POST',{})).status,200);
  assert.equal((await request('/api/trips',aCookie)).status,401);assert.equal((await json('/api/trips',bCookie)).trips[0].id,b.trip.id);
  assert.equal((await request('/api/trips',null,'GET',undefined,{Cookie:CHALLENGE_COOKIE+'='+'b'.repeat(43)})).status,401);
  // Workspace email reassignment must not transfer the former user's itinerary.
  const workEmail='traveler@workspace.example',workCookie=await login(workEmail,'original-workspace-sub',{hd:'workspace.example'}),workTrip=await create(workCookie,'Private workspace-owned travel');
  const reassigned=await login(workEmail,'reassigned-workspace-sub',{hd:'workspace.example'},409);assert.match((await reassigned.json()).error,/綁定另一個 Google 帳號/);
  const renamed=await login('renamed@workspace.example','original-workspace-sub',{hd:'workspace.example'},409);assert.match((await renamed.json()).error,/email 已變更/);
  assert.equal((await json(tripPath(workTrip.trip.id),workCookie)).role,'owner');
  assert.deepEqual({...await DB.prepare('SELECT google_sub,email FROM auth_identities WHERE email=?').bind(workEmail).first()},{google_sub:'original-workspace-sub',email:workEmail});
  assert.equal(await DB.prepare('SELECT email FROM auth_sessions WHERE google_sub=?').bind('reassigned-workspace-sub').first(),null);
  // Both contenders observe an unbound email before their atomic D1 batches.
  const raceEmail='race-account@gmail.com';let arrivals=0,release;
  const barrier=new Promise(resolve=>{release=resolve;});
  env.DB={...DB,prepare(sql){const prepared=DB.prepare(sql);return {bind(...values){const statement=prepared.bind(...values);if(sql!=='SELECT google_sub FROM auth_identities WHERE email=?'||values[0]!==raceEmail)return statement;return {...statement,async first(){const row=await statement.first();if(++arrivals===2)release();await barrier;return row;}};}};}};
  const contenders=['race-sub-one','race-sub-two'];
  const raced=await Promise.all(contenders.map(sub=>login(raceEmail,sub,{},null)));env.DB=DB;
  assert.deepEqual(raced.map(response=>response.status).sort(),[200,401]);
  const identity=await DB.prepare('SELECT google_sub FROM auth_identities WHERE email=?').bind(raceEmail).first();assert.ok(contenders.includes(identity.google_sub));
  assert.equal((await DB.prepare('SELECT count(*) AS count FROM auth_sessions WHERE email=?').bind(raceEmail).first()).count,1);
  for(let index=0;index<raced.length;index++){
   if(raced[index].status===200)assert.equal(identity.google_sub,contenders[index]);
   else assert.equal(raced[index].headers.get('Set-Cookie'),null);
  }
  // Rate budgets use the verified subject, never the forged identity header.
  const rateCalls=[];env.AUTH_API_LIMITER={limit:async({key})=>{rateCalls.push(['api',key]);return {success:true};}};
  env.AUTH_WRITE_LIMITER={limit:async({key})=>{rateCalls.push(['write',key]);return {success:false};}};
  const throttled=await request(tripPath(b.trip.id),bCookie,'PUT',{days:b.days,revision:0,mutationId:'throttled-write'},{'oai-authenticated-user-id':emailA});
  assert.equal(throttled.status,429);assert.deepEqual(rateCalls,[['api','bob-sub'],['write','bob-sub']]);
  assert.equal((await json(tripPath(b.trip.id),bCookie)).revision,0);env.AUTH_API_LIMITER=env.AUTH_WRITE_LIMITER=allow;
 }finally{globalThis.fetch=realFetch;DB.close();}
});
