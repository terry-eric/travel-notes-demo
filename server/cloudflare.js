import site from '../dist/server/index.js';
import {verifyAccess} from './cloudflare-auth.js';
import {handleSharing} from './sharing.js';
import {handleApi,handleTrips} from './api.js';
import {sessionFor} from './trips.js';
import {accessPage} from './access-page.js';
import {authConfigured,googleIdentity,loginChallenge,googleLogin,googleLogout,randomToken,safeReturnTo} from './google-auth.js';
import {googleLoginPage,googleLogoutPage,googlePrivacyPage} from './google-login-page.js';
export function deploymentTarget(env){
 const host=env.APP_HOST,base=env.APP_BASE;
 if(typeof host!=='string'||host.length>253||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host))return null;
 if(typeof base!=='string'||base.length>200||! /^(?:\/[A-Za-z0-9_-]+)*$/.test(base))return null;
 return {host,base};
}
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
let certificates=null;
async function accessKeys(issuer,kid){
 if(certificates?.issuer===issuer&&certificates.expires>Date.now()&&certificates.keys.some(k=>k.kid===kid))return certificates.keys;
 const response=await fetch(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('Access verification unavailable');
 const data=await response.json();if(!Array.isArray(data.keys))throw Error('Invalid certificates');
 certificates={issuer,keys:data.keys,expires:Date.now()+300000};return data.keys;
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 const target=deploymentTarget(env);
 if(!target)return new Response('旅手帖的部署網址尚未設定完成。',{status:503,headers});
 const {host,base}=target;
 if(url.origin!=='https://'+host||!(url.pathname===base||url.pathname.startsWith(base+'/')))return new Response('Not found',{status:404,headers});
 let identity;
 if(env.AUTH_MODE==='google'){
  if(!authConfigured(env)||![env.AUTH_LOGIN_LIMITER,env.AUTH_API_LIMITER,env.AUTH_WRITE_LIMITER].every(limiter=>typeof limiter?.limit==='function'))return new Response('Google 登入正在設定，請稍後再試。',{status:503,headers});
  try{
   if(url.pathname===base+'/privacy')return ['GET','HEAD'].includes(request.method)?googlePrivacyPage(randomToken(),request.method,base):new Response(null,{status:405,headers});
   if([base+'/login',base+'/api/auth/google'].includes(url.pathname)){
    const limited=await env.AUTH_LOGIN_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown-client'});
    if(limited?.success!==true)return Response.json({error:'登入嘗試過於頻繁，請稍後再試。'},{status:429,headers:{...headers,'Retry-After':'60'}});
   }
   if(url.pathname===base+'/api/auth/google')return await googleLogin(request,env);
   if(url.pathname===base+'/api/auth/logout')return await googleLogout(request,env);
   identity=await googleIdentity(request,env);
   if(url.pathname===base+'/login'){
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers});
    const returnTo=safeReturnTo(url.searchParams.get('return_to'),base,url.origin);
    if(identity)return Response.redirect(url.origin+returnTo,302);
    const challenge=request.method==='HEAD'?{nonce:randomToken()}:await loginChallenge(request,env,returnTo);
    return googleLoginPage({clientId:env.GOOGLE_CLIENT_ID,...challenge,base,method:request.method});
   }
   if(url.pathname===base+'/logout')return ['GET','HEAD'].includes(request.method)?googleLogoutPage(randomToken(),request.method,base):new Response(null,{status:405,headers});
   if(!identity){
    const document=['', '/', '/trips','/overview','/daily','/map','/notes'].includes(url.pathname.slice(base.length));
    if(document&&['GET','HEAD'].includes(request.method)){
     const returnTo=safeReturnTo((url.pathname===base||url.pathname===base+'/')?base+'/trips'+url.search:url.pathname+url.search,base,url.origin);
     return Response.redirect(url.origin+base+'/login?'+new URLSearchParams({return_to:returnTo}),302);
    }
    return Response.json({error:'請登入後查看行程。',loginUrl:base+'/login'},{status:401,headers});
   }
  }catch{return url.pathname.startsWith(base+'/api/')?Response.json({error:'暫時無法確認 Google 登入，請稍後重試。'},{status:503,headers}):new Response('暫時無法確認 Google 登入，請稍後重試。',{status:503,headers});}
 }else{
  const issuer=env.ACCESS_ISSUER;
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'')||!env.ACCESS_AUD)return new Response('旅手帖正在設定私人登入，請稍後再試。',{status:503,headers});
  identity=await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'),{issuer,audience:env.ACCESS_AUD},kid=>accessKeys(issuer,kid));
  if(!identity)return !url.pathname.startsWith(base+'/api/')&&['GET','HEAD'].includes(request.method)?accessPage(request):Response.json({error:'請登入後查看行程。'},{status:401,headers});
  if(url.pathname===base+'/login'&&['GET','HEAD'].includes(request.method))return Response.redirect(url.origin+safeReturnTo(url.searchParams.get('return_to'),base,url.origin),302);
 }
 if(env.AUTH_MODE==='google'&&url.pathname.startsWith(base+'/api/')){
  try{
   const read=await env.AUTH_API_LIMITER.limit({key:identity.sub});
   if(read?.success!==true)return Response.json({error:'操作過於頻繁，請稍後再試。'},{status:429,headers:{...headers,'Retry-After':'60'}});
   if(!['GET','HEAD'].includes(request.method)){
    const write=await env.AUTH_WRITE_LIMITER.limit({key:identity.sub});
    if(write?.success!==true)return Response.json({error:'儲存次數過於頻繁，請稍後再試。'},{status:429,headers:{...headers,'Retry-After':'60'}});
   }
  }catch{return Response.json({error:'暫時無法處理操作，請稍後重試。'},{status:503,headers});}
 }
 const internal=new URL(url);internal.pathname=url.pathname.slice(base.length);
 const authenticated=new Headers(request.headers);authenticated.delete('oai-authenticated-user-id');authenticated.set('oai-authenticated-user-id',identity.email);
 const forwarded=new Request(internal,{method:request.method,headers:authenticated,body:['GET','HEAD'].includes(request.method)?undefined:request.body,duplex:'half',redirect:request.redirect,signal:request.signal});
 if(internal.pathname==='/api/session')return request.method==='GET'?sessionFor(forwarded,env):new Response(null,{status:405,headers});
 if(internal.pathname==='/api/shares')return handleSharing(forwarded,env);
 if(internal.pathname==='/api/trips')return handleTrips(forwarded,env);
 if(internal.pathname==='/api/trip')return handleApi(forwarded,env);
 if(url.pathname===base||url.pathname===base+'/')return Response.redirect(url.origin+base+'/trips'+url.search,302);
 const response=await site.fetch(forwarded,env);
 if(response.headers.get('Content-Type')?.startsWith('text/html')&&request.method==='GET'){
  return new HTMLRewriter().on('head',{element(element){element.append('<meta name="trip-app-base" content="'+base+'"><meta name="trip-auth-mode" content="'+(env.AUTH_MODE==='google'?'google':'access')+'">',{html:true});}}).on('[href],[src]',{element(element){for(const name of ['href','src']){const value=element.getAttribute(name);if(value?.startsWith('/')&&!value.startsWith('//'))element.setAttribute(name,base+value);}}}).transform(response);
 }
 return response;
}};
