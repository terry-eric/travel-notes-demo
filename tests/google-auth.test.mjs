import test from 'node:test';
import assert from 'node:assert/strict';
import {localDatabase} from '../scripts/local-db.mjs';
import {verifyGoogleIdToken,loginChallenge,googleLogin,googleLogout,googleIdentity,tokenHash,randomToken,safeReturnTo,googleTarget,SESSION_COOKIE,CHALLENGE_COOKIE} from '../server/google-auth.js';
const clientId='123-google-test.apps.googleusercontent.com',origin='https://demo.terry878.org',now=20000;
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'google-auth-test-key',alg:'RS256',use:'sig'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function signed(claims,header={alg:'RS256',kid:jwk.kid}){const payload=encode(header)+'.'+encode(claims),signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(payload));return payload+'.'+Buffer.from(signature).toString('base64url');}
const claims=(nonce,extra={})=>({iss:'https://accounts.google.com',aud:clientId,sub:'google-person',email:'Person@gmail.com',email_verified:true,iat:now,exp:now+3600,nonce,...extra});
const keys=async()=>[jwk];
const request=(path,method='GET',cookie='',body,extra={})=>new Request(origin+'/trip'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const cookieValue=(value,name)=>new RegExp(name+'=([A-Za-z0-9_-]+)').exec(value)?.[1];
async function challenge(DB,extra={}){const env={DB,GOOGLE_CLIENT_ID:clientId,...extra};const result=await loginChallenge(request('/login'),env,'/trip/daily?trip=private&day=2',now);return {env,...result,token:cookieValue(result.cookie,CHALLENGE_COOKIE)};}
async function signIn(DB,extra={},at=now){const start=await challenge(DB),credential=await signed(claims(start.nonce,extra)),response=await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential}),start.env,keys,at);return {start,response,token:cookieValue(response.headers.get('Set-Cookie')||'',SESSION_COOKIE)};}

test('Google ID token verifies signature, fixed issuer, exact audience, nonce, fresh times and verified email',async()=>{
 const nonce=randomToken(),config={clientId,nonceHash:await tokenHash(nonce)},body=claims(nonce);
 assert.deepEqual(await verifyGoogleIdToken(await signed(body),config,keys,now),{email:'person@gmail.com',sub:'google-person'});
 assert.deepEqual(await verifyGoogleIdToken(await signed({...body,iss:'accounts.google.com'}),config,keys,now),{email:'person@gmail.com',sub:'google-person'});
 for(const invalid of [{exp:now},{iat:now+61},{iat:now-7201},{exp:now+7201},{nbf:now+1},{aud:'other.apps.googleusercontent.com'},{aud:[clientId]},{azp:'other'},{iss:'https://evil.example'},{email_verified:false},{email_verified:'true'},{email:'bad-email'},{sub:''},{nonce:randomToken()}])assert.equal(await verifyGoogleIdToken(await signed({...body,...invalid}),config,keys,now),null);
 assert.equal(await verifyGoogleIdToken(await signed(body,{alg:'none',kid:jwk.kid}),config,keys,now),null);
 assert.equal(await verifyGoogleIdToken(await signed(body),config,async()=>[],now),null);
 const good=await signed(body);assert.equal(await verifyGoogleIdToken(good.slice(0,-20)+'A'.repeat(20),config,keys,now),null);
 assert.equal(await verifyGoogleIdToken('bad',config,keys,now),null);
});
test('Google login supports authoritative Gmail and Workspace, and rejects third-party Google emails',async()=>{
 const nonce=randomToken(),config={clientId,nonceHash:await tokenHash(nonce)};
 assert.deepEqual(await verifyGoogleIdToken(await signed(claims(nonce,{email:'person@example.com'})),config,keys,now),{error:'unsupported_email'});
 assert.deepEqual(await verifyGoogleIdToken(await signed(claims(nonce,{email:'person@alias.example',hd:'workspace.example'})),config,keys,now),{email:'person@alias.example',sub:'google-person'});
 const DB=localDatabase();try{const {response}=await signIn(DB,{email:'person@example.com'});assert.equal(response.status,401);assert.match((await response.json()).error,/Gmail.*Workspace/);}finally{DB.close();}
});
test('Opaque login cookies are hashed at rest and a nonce-bound login yields a private 24h session',async()=>{
 const DB=localDatabase();try{
  const {start,response,token}=await signIn(DB);assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.match(response.headers.get('Set-Cookie'),/Path=\/trip; Max-Age=86400/);
  const body=await response.json();assert.deepEqual(body,{ok:true,returnTo:'/trip/daily?trip=private&day=2'});assert.ok(!JSON.stringify(body).includes(token));
  assert.equal(await DB.prepare('SELECT token_hash FROM auth_login_challenges WHERE token_hash=?').bind(await tokenHash(start.token)).first(),null);
  const row=await DB.prepare('SELECT * FROM auth_sessions').bind().first();assert.equal(row.token_hash,await tokenHash(token));assert.notEqual(row.token_hash,token);assert.equal(row.expires_at,now+86400);
  assert.deepEqual(await googleIdentity(request('/api/session','GET',`${SESSION_COOKIE}=${token}`),start.env,now),{email:'person@gmail.com',sub:'google-person'});
  assert.equal(await googleIdentity(request('/api/session','GET',`${SESSION_COOKIE}=${token}`),start.env,now+86400),null);
  assert.equal(await googleIdentity(request('/api/session','GET',`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${randomToken()}`),start.env,now),null);
 }finally{DB.close();}
});
test('Login challenges reject expiration, missing cookies, wrong nonce, body injection and replay',async()=>{
 const DB=localDatabase();try{
  const start=await challenge(DB),credential=await signed(claims(start.nonce));
  assert.equal((await googleLogin(request('/api/auth/google','POST','',{credential}),start.env,keys,now)).status,401);
  assert.equal((await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential:await signed(claims(randomToken()))}),start.env,keys,now)).status,401);
  assert.equal((await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential},{'Content-Type':'text/plain'}),start.env,keys,now)).status,400);
  assert.equal((await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential}),start.env,keys,now+600)).status,401);
  const first=await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential}),start.env,keys,now);assert.equal(first.status,200);
  assert.equal((await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential}),start.env,keys,now)).status,401);
 }finally{DB.close();}
});
test('Atomic challenge consumption only creates one session during concurrent login submissions',async()=>{
 const DB=localDatabase();try{
  const start=await challenge(DB),credential=await signed(claims(start.nonce)),make=()=>googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${start.token}`,{credential}),start.env,keys,now);
  const responses=await Promise.all([make(),make()]);assert.deepEqual(responses.map(value=>value.status).sort(),[200,401]);assert.equal((await DB.prepare('SELECT count(*) AS count FROM auth_sessions').bind().first()).count,1);
 }finally{DB.close();}
});
test('Strict same-origin POST blocks login/logout CSRF, and logout revokes only the current session',async()=>{
 const DB=localDatabase();try{
  const {start,response,token}=await signIn(DB);assert.equal(response.status,200);
  const cookie=`${SESSION_COOKIE}=${token}`,cross=request('/api/auth/logout','POST',cookie,{}, {Origin:'https://evil.example'});
  assert.equal((await googleLogout(cross,start.env)).status,403);assert.ok(await googleIdentity(request('/api/session','GET',cookie),start.env,now));
  assert.equal((await googleLogout(request('/api/auth/logout','GET',cookie),start.env)).status,405);
  const next=await challenge(DB);assert.equal((await googleLogin(request('/api/auth/google','POST',`${CHALLENGE_COOKIE}=${next.token}`,{credential:await signed(claims(next.nonce))},{Origin:'null'}),next.env,keys,now)).status,403);
  const out=await googleLogout(request('/api/auth/logout','POST',cookie,{}),start.env);assert.equal(out.status,200);assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(await googleIdentity(request('/api/session','GET',cookie),start.env,now),null);
 }finally{DB.close();}
});
test('Expired challenges and sessions are pruned, with at most ten sessions per Google account',async()=>{
 const DB=localDatabase();try{
  for(let index=0;index<12;index++)assert.equal((await signIn(DB)).response.status,200);
  assert.equal((await DB.prepare('SELECT count(*) AS count FROM auth_sessions').bind().first()).count,10);
  const env={DB,GOOGLE_CLIENT_ID:clientId};await loginChallenge(request('/login'),env,'/trip/trips',now+86401);
  assert.equal((await DB.prepare('SELECT count(*) AS count FROM auth_sessions').bind().first()).count,0);
  assert.equal((await DB.prepare('SELECT count(*) AS count FROM auth_login_challenges').bind().first()).count,1);
 }finally{DB.close();}
});
test('Return navigation stays inside the configured application and cannot redirect off-site',()=>{
 for(const path of ['https://evil.example','//evil.example','/trip/../roomly','/tripper/private','/trip/api/trips','/trip/login','/trip/\\evil.example','/trip/notes\nLocation:evil'])assert.equal(safeReturnTo(path),'/trip/trips');
 assert.equal(safeReturnTo('/trip/daily?day=2&trip=mine'),'/trip/daily?day=2&trip=mine');
 assert.deepEqual(googleTarget({APP_HOST:'travel.example.org',APP_BASE:'/journey'}),{origin:'https://travel.example.org',base:'/journey'});
 assert.equal(safeReturnTo('/journey/map?day=1','/journey','https://travel.example.org'),'/journey/map?day=1');assert.throws(()=>googleTarget({APP_HOST:'evil.example/path'}));
});
