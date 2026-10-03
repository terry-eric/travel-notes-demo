import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
async function preview(script){
 const child=spawn(process.execPath,[script],{cwd:process.cwd(),env:{...process.env,TRIP_PREVIEW_DB:':memory:',TRIP_PREVIEW_EMAIL:'owner@example.com'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let startup='',errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
 try{
  const origin=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Preview startup timeout: '+errors)),10000);
   child.once('error',error=>{clearTimeout(timeout);reject(error);});
   child.once('exit',code=>{clearTimeout(timeout);reject(Error('Preview exited '+code+': '+errors));});
   child.stdout.on('data',chunk=>{startup+=chunk;const match=startup.match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  return {origin,async close(){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}};
 }catch(error){child.kill();throw error;}
}
for(const [script,base] of [['scripts/dev.mjs',''],['scripts/dev-trip.mjs','/trip']]){
 test(script+' serves My Trips and its signed-in catalogue on reload',async()=>{
  const server=await preview(script);try{
   const href=server.origin+base+'/trips',response=await fetch(href);assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/^text\/html/);
   const head=await fetch(href,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
   assert.equal((await fetch(href,{method:'POST'})).status,405);assert.equal((await fetch(server.origin+base+'/trips-unknown')).status,404);
   const session=await fetch(server.origin+base+'/api/session');assert.equal(session.status,200);assert.equal((await session.json()).email,'owner@example.com');
   const catalogue=await fetch(server.origin+base+'/api/trips');assert.equal(catalogue.status,200);assert.ok(Array.isArray((await catalogue.json()).trips));
  }finally{await server.close();}
 });
}
