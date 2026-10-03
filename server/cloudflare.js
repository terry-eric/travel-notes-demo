import site from '../dist/server/index.js';
import {verifyAccess} from './cloudflare-auth.js';
import {handleSharing} from './sharing.js';
import {handleApi,handleTrips} from './api.js';
import {sessionFor} from './trips.js';
import {accessPage} from './access-page.js';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// Configuration must describe one exact hostname and a path boundary. Never
// infer a trusted hostname from the request, which can bypass an Access route.
export function deploymentTarget(env){
 const host=env.APP_HOST,configuredBase=env.APP_BASE;
 if(typeof host!=='string'||host.length>253||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host))return null;
 if(typeof configuredBase!=='string'||configuredBase.length>200||! /^(?:\/[A-Za-z0-9_-]+)*$/.test(configuredBase))return null;
 return {host,base:configuredBase};
}
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
 if(url.hostname!==host||!(url.pathname===base||url.pathname.startsWith(base+'/')))return new Response('Not found',{status:404,headers});
 const issuer=env.ACCESS_ISSUER;
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'')||!env.ACCESS_AUD)return new Response('旅手帖正在設定私人登入，請稍後再試。',{status:503,headers});
 const identity=await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'),{issuer,audience:env.ACCESS_AUD},kid=>accessKeys(issuer,kid));
 if(!identity)return !url.pathname.startsWith(base+'/api/')&&['GET','HEAD'].includes(request.method)?accessPage(request):Response.json({error:'請登入後查看行程。'},{status:401,headers});
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
  return new HTMLRewriter().on('head',{element(element){element.append('<meta name="trip-app-base" content="'+base+'">',{html:true});}}).on('[href],[src]',{element(element){for(const name of ['href','src']){const value=element.getAttribute(name);if(value?.startsWith('/')&&!value.startsWith('//'))element.setAttribute(name,base+value);}}}).transform(response);
 }
 return response;
}};
