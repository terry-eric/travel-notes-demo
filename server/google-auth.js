const base='/trip',origin='https://demo.terry878.org';
export function googleTarget(env={}){
 const host=env.APP_HOST??'demo.terry878.org',path=env.APP_BASE??base;
 if(typeof host!=='string'||host.length>253||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)||typeof path!=='string'||path.length>200||! /^(?:\/[A-Za-z0-9_-]+)*$/.test(path))throw Error('Invalid auth target');
 return {origin:'https://'+host,base:path};
}
export const GOOGLE_JWKS_URL='https://www.googleapis.com/oauth2/v3/certs';
export const SESSION_COOKIE='__Secure-trip_session',CHALLENGE_COOKIE='__Secure-trip_login';
const TTL=86400,LOGIN_TTL=600;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const encoder=new TextEncoder();
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=part=>{if(!/^[A-Za-z0-9_-]+$/.test(part))throw Error();return Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
const json=part=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(part)));
export const randomToken=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
export async function tokenHash(value){return encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
export function authConfigured(env){return !!env.DB?.prepare&&typeof env.GOOGLE_CLIENT_ID==='string'&&env.GOOGLE_CLIENT_ID.length<300&&/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID);}
export function authCookie(name,value,maxAge,path=base){return `${name}=${value}; Path=${path||'/'}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;}
export function requestCookie(request,name){
 const values=(request.headers.get('Cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));
 if(values.length!==1)return null;
 const value=values[0].slice(name.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
export function safeReturnTo(value,path=base,trustedOrigin=origin){
 if(typeof value!=='string'||value.length>2048||!value.startsWith(path+'/')||/[\\\u0000-\u0020\u007f]/.test(value))return path+'/trips';
 try{const url=new URL(value,trustedOrigin);if(url.origin!==trustedOrigin||!url.pathname.startsWith(path+'/')||url.pathname===path+'/login'||url.pathname===path+'/logout'||url.pathname.startsWith(path+'/api/'))return path+'/trips';return url.pathname+url.search;}catch{return path+'/trips';}
}
let certificates=null;
export async function googleKeys(kid){
 if(certificates?.expires>Date.now()&&(certificates.keys.some(key=>key.kid===kid)||certificates.fetched>Date.now()-30000))return certificates.keys;
 const response=await fetch(GOOGLE_JWKS_URL,{signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok)throw Error('Google verification unavailable');
 const data=await response.json();if(!Array.isArray(data.keys)||data.keys.length>20)throw Error('Invalid certificates');
 const age=Number(/(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('Cache-Control')||'')?.[1]||300);
 certificates={keys:data.keys,fetched:Date.now(),expires:Date.now()+Math.max(0,Math.min(age,3600))*1000};return certificates.keys;
}
// The issuer, keys endpoint and signature algorithm are fixed; token headers never choose a URL.
export async function verifyGoogleIdToken(token,{clientId,nonceHash},getKeys=googleKeys,now=Math.floor(Date.now()/1000),diagnostic){
 const fail=reason=>{try{diagnostic?.(reason);}catch{}return null;};
 let stage='token_format';
 try{
  if(typeof token!=='string'||token.length>16384||typeof nonceHash!=='string')return fail('token_format');
  const parts=token.split('.');if(parts.length!==3)return fail('token_parts');
  stage='header_decode';const header=json(parts[0]);stage='claims_decode';const claims=json(parts[1]);
  if(!header||header.alg!=='RS256')return fail('header_algorithm');
  if(typeof header.kid!=='string'||header.kid.length>200)return fail('header_key_id');
  if(!claims||!['https://accounts.google.com','accounts.google.com'].includes(claims.iss))return fail('issuer');
  if(claims.aud!==clientId)return fail('audience');
  if(claims.azp!==undefined&&claims.azp!==clientId)return fail('authorized_party');
  if(!Number.isInteger(claims.exp))return fail('expiration_type');
  if(claims.exp<=now)return fail('expiration_expired');
  if(!Number.isInteger(claims.iat))return fail('issued_at_type');
  if(claims.iat>now+60)return fail('issued_at_future');
  if(claims.iat<now-7200)return fail('issued_at_old');
  if(claims.exp-claims.iat>7200||claims.exp<=claims.iat)return fail('token_lifetime');
  if(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now))return fail('not_before');
  if(typeof claims.sub!=='string'||! /^[a-zA-Z0-9_-]{1,255}$/.test(claims.sub))return fail('subject_format');
  if(claims.email_verified!==true)return fail('email_unverified');
  if(typeof claims.email!=='string'||claims.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email))return fail('email_format');
  if(typeof claims.nonce!=='string')return fail('nonce_type');
  if(! /^[A-Za-z0-9_-]{43}$/.test(claims.nonce))return fail('nonce_format');
  stage='nonce_hash';if(await tokenHash(claims.nonce)!==nonceHash)return fail('nonce_mismatch');
  stage='keys_fetch';
  const keys=await getKeys(header.kid),jwk=keys.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.alg||key.alg==='RS256')&&(!key.use||key.use==='sig'));
  if(!jwk)return fail('key_lookup');
  stage='key_import';
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  stage='signature_decode';const signature=decode(parts[2]);stage='signature_verify';
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,encoder.encode(parts[0]+'.'+parts[1])))return fail('signature_invalid');
  // Google is authoritative for Gmail and verified Workspace accounts, but not
  // for a third-party email that may have changed hands since Google verified it.
  if(!claims.email.toLowerCase().endsWith('@gmail.com')&&!(typeof claims.hd==='string'&&/^[a-zA-Z0-9.-]{1,253}$/.test(claims.hd)&&claims.hd.includes('.')))return {error:'unsupported_email'};
  return {email:claims.email.toLowerCase(),sub:claims.sub};
 }catch(error){const name=['TypeError','SyntaxError','InvalidCharacterError','DataError','OperationError','NotSupportedError','TimeoutError','AbortError'].includes(error?.name)?error.name:'Error';return fail(stage+'_'+name);}
}
export async function googleIdentity(request,env,now=Math.floor(Date.now()/1000)){
 const token=requestCookie(request,SESSION_COOKIE);if(!token||!authConfigured(env))return null;
 const row=await env.DB.prepare('SELECT email,google_sub FROM auth_sessions WHERE token_hash=? AND expires_at>?').bind(await tokenHash(token),now).first();
 return row?{email:row.email,sub:row.google_sub}:null;
}
export async function loginChallenge(request,env,returnTo,now=Math.floor(Date.now()/1000)){
 const target=googleTarget(env);
 // A browser can have several login pages open. Its HttpOnly cookie remains
 // stable, while each page keeps an independent nonce and return destination.
 const token=requestCookie(request,CHALLENGE_COOKIE)||randomToken(),nonce=randomToken(),challengeId=await tokenHash(nonce);
 const statements=[env.DB.prepare('DELETE FROM auth_login_challenges WHERE expires_at<=?').bind(now),env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now)];
 statements.push(env.DB.prepare('INSERT INTO auth_login_challenges(token_hash,nonce_hash,return_to,created_at,expires_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM auth_login_challenges)<10000').bind(await tokenHash(token+'.'+challengeId),challengeId,safeReturnTo(returnTo,target.base,target.origin),now,now+LOGIN_TTL));
 const results=await env.DB.batch(statements);if(results.at(-1).meta.changes!==1)throw Error('Login capacity unavailable');
 return {nonce,challengeId,cookie:authCookie(CHALLENGE_COOKIE,token,LOGIN_TTL,target.base)};
}
const reply=(body,status=200,cookies=[])=>{const response=Response.json(body,{status,headers});for(const cookie of cookies)response.headers.append('Set-Cookie',cookie);return response;};
function sameOrigin(request,env){const target=googleTarget(env);return new URL(request.url).origin===target.origin&&request.headers.get('Origin')===target.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site';}
async function loginBody(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return null;
 if(Number(request.headers.get('Content-Length'))>18000)return null;
 const reader=request.body?.getReader();if(!reader)return null;
 let size=0,raw='';const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>18000){await reader.cancel();return null;}raw+=decoder.decode(value,{stream:true});}
 try{const body=JSON.parse(raw+decoder.decode());return body&&typeof body==='object'&&!Array.isArray(body)&&typeof body.credential==='string'&&typeof body.challengeId==='string'&&/^[A-Za-z0-9_-]{43}$/.test(body.challengeId)?body:null;}catch{return null;}
}
export async function googleLogin(request,env,getKeys=googleKeys,now=Math.floor(Date.now()/1000)){
 if(request.method!=='POST')return reply({error:'不支援此操作。'},405);
 if(!sameOrigin(request,env))return reply({error:'請從本站登入。'},403);
 const challenge=requestCookie(request,CHALLENGE_COOKIE);if(!challenge)return reply({error:'登入已過期，請重新整理登入頁。'},401);
 const body=await loginBody(request);if(!body)return reply({error:'登入資料不完整，請重新整理登入頁後再試。'},400);
 const hash=await tokenHash(challenge+'.'+body.challengeId),row=await env.DB.prepare('SELECT nonce_hash,return_to FROM auth_login_challenges WHERE token_hash=? AND nonce_hash=? AND expires_at>?').bind(hash,body.challengeId,now).first();
 if(!row)return reply({error:'登入已過期，請重新整理登入頁。'},401);
 // A temporary, explicit diagnostic switch emits only a fixed reason enum.
 // Never log claims, credentials, cookies, identity values or exception messages.
 const diagnostic=env.AUTH_DIAGNOSTICS==='reason'?reason=>console.warn('google_auth_verification_failed',reason):undefined;
 const identity=await verifyGoogleIdToken(body.credential,{clientId:env.GOOGLE_CLIENT_ID,nonceHash:row.nonce_hash},getKeys,now,diagnostic);
 if(!identity)return reply({error:'無法確認 Google 帳號，請重新登入。'},401);
 if(identity.error)return reply({error:'請使用 Gmail 或 Google Workspace 帳號登入。'},401);
 const boundSubject=await env.DB.prepare('SELECT email FROM auth_identities WHERE google_sub=?').bind(identity.sub).first();
 if(boundSubject&&boundSubject.email!==identity.email)return reply({error:'這個 Google 帳號的 email 已變更，請聯絡網站管理者協助轉移帳號。'},409);
 const boundEmail=await env.DB.prepare('SELECT google_sub FROM auth_identities WHERE email=?').bind(identity.email).first();
 if(boundEmail&&boundEmail.google_sub!==identity.sub)return reply({error:'這個 email 已綁定另一個 Google 帳號，無法登入原有旅行。請聯絡網站管理者。'},409);
 const token=randomToken(),sessionHash=await tokenHash(token),previous=requestCookie(request,SESSION_COOKIE);
 const statements=[env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
  env.DB.prepare('INSERT OR IGNORE INTO auth_identities(google_sub,email,created_at) SELECT ?,?,? FROM auth_login_challenges WHERE token_hash=? AND nonce_hash=? AND expires_at>?').bind(identity.sub,identity.email,now,hash,row.nonce_hash,now),
  env.DB.prepare('INSERT INTO auth_sessions(token_hash,email,google_sub,created_at,expires_at) SELECT ?,?,?,?,? FROM auth_login_challenges WHERE token_hash=? AND nonce_hash=? AND expires_at>? AND EXISTS (SELECT 1 FROM auth_identities WHERE google_sub=? AND email=?)').bind(sessionHash,identity.email,identity.sub,now,now+TTL,hash,row.nonce_hash,now,identity.sub,identity.email),
  env.DB.prepare('DELETE FROM auth_login_challenges WHERE token_hash=?').bind(hash)];
 if(previous)statements.push(env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=? AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=?)').bind(await tokenHash(previous),sessionHash));
 statements.push(env.DB.prepare('DELETE FROM auth_sessions WHERE google_sub=? AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=?) AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE google_sub=? ORDER BY (token_hash=?) DESC,created_at DESC,token_hash DESC LIMIT 10)').bind(identity.sub,sessionHash,identity.sub,sessionHash));
 const results=await env.DB.batch(statements);if(results[2].meta.changes!==1)return reply({error:'這次登入已使用或帳號綁定已變更，請重新整理登入頁。'},401);
 const target=googleTarget(env);
 return reply({ok:true,returnTo:safeReturnTo(row.return_to,target.base,target.origin)},200,[authCookie(SESSION_COOKIE,token,TTL,target.base),authCookie(CHALLENGE_COOKIE,'',0,target.base)]);
}
export async function googleLogout(request,env){
 if(request.method!=='POST')return reply({error:'不支援此操作。'},405);
 if(!sameOrigin(request,env))return reply({error:'請從本站登出。'},403);
 const session=requestCookie(request,SESSION_COOKIE),statements=[];
 if(session)statements.push(env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await tokenHash(session)));
 // Pending login pages become unusable without the cleared HttpOnly cookie;
 // independent nonce records are pruned at their original ten-minute expiry.
 if(statements.length)await env.DB.batch(statements);
 const target=googleTarget(env);
 return reply({ok:true},200,[authCookie(SESSION_COOKIE,'',0,target.base),authCookie(CHALLENGE_COOKIE,'',0,target.base)]);
}
