import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Wrangler supplies Miniflare/workerd in the public source repository. A private
// workspace can point TRIP_WORKER_RUNTIME at that installed package explicitly.
let runtime;
try{
 const specifier=process.env.TRIP_WORKER_RUNTIME||pathToFileURL(createRequire(import.meta.url).resolve('miniflare')).href;
 runtime=await import(specifier);
}catch(error){
 if(process.env.TRIP_WORKER_RUNTIME||!['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error.code))throw error;
}

test('Actual workerd retrieves pinned Google keys with manual redirects and never follows a certificate redirect',{skip:runtime?false:'Install Wrangler to run the workerd regression.'},async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'runtime-jwks-fixture',alg:'RS256',use:'sig'};
 const auth=fs.readFileSync(new URL('../server/google-auth.js',import.meta.url),'utf8').replace(/^export /gm,'');
 // The wrapper still calls workerd's real fetch, so RequestInit validation is
 // exercised before the local fixture origin. Node-only fetch stubs hide it.
 const main=auth+`
export default {async fetch(){
 const originalFetch=globalThis.fetch,observed=[];
 globalThis.fetch=async(input,init)=>{const response=await originalFetch(input,init);observed.push({url:String(input),redirect:init?.redirect,status:response.status,originCalls:Number(response.headers.get('X-Test-Origin-Calls'))});return response;};
 try{const keys=await googleKeys('runtime-jwks-fixture');const key=await crypto.subtle.importKey('jwk',keys[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);return Response.json({ok:true,imported:!!key,observed});}
 catch(error){return Response.json({ok:false,errorName:error.name,observed});}
 finally{globalThis.fetch=originalFetch;}
}};`;
 for(const redirected of [false,true]){
  const origin=`let calls=0;export default {async fetch(request){calls++;const headers={'X-Test-Origin-Calls':String(calls),'Cache-Control':'max-age=3600'};if(${redirected}&&new URL(request.url).pathname==='/oauth2/v3/certs')return new Response(null,{status:302,headers:{...headers,Location:'https://other-origin.invalid/replaced-keys'}});return Response.json({keys:[${JSON.stringify(jwk)}]},{headers});}};`;
  const options={workers:[{name:'auth-runtime',modules:true,script:main,compatibilityDate:'2026-09-30',outboundService:'local-google-certificates'},{name:'local-google-certificates',modules:true,script:origin,compatibilityDate:'2026-09-30'}],host:'127.0.0.1',port:0};
  const mf=new runtime.Miniflare(typeof runtime.convertV4MiniflareOptions==='function'?runtime.convertV4MiniflareOptions(options):options);
  try{
   const response=await mf.dispatchFetch('https://runtime-test.invalid/verify'),result=await response.json();
   assert.deepEqual(result.observed,[{url:'https://www.googleapis.com/oauth2/v3/certs',redirect:'manual',status:redirected?302:200,originCalls:1}]);
   assert.equal(result.ok,!redirected);
   if(redirected)assert.equal(result.errorName,'Error');else assert.equal(result.imported,true);
  }finally{await mf.dispose();}
 }
});
