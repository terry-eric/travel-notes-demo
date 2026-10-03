import test from 'node:test';import assert from 'node:assert/strict';
import {locationFromMapsUrl} from '../public/maps-link.js';
import {resolveMapsShare,handleMapsResolve} from '../server/maps-resolve.js';
import {routeLeg} from '../public/transport.js';
const short='https://maps.app.goo.gl/example';
const full='https://www.google.com/maps/place/Shirogane+Cafe/@1,2,17z/data=!3d43.0591547!4d141.2990003';
test('resolve only Google redirect URLs, prefer actual place coordinates over camera center',async()=>{
 let calls=0;
 const result=await resolveMapsShare(short,async(url,options)=>{calls++;assert.equal(url,short);assert.equal(options.redirect,'manual');assert.equal(options.method,'HEAD');return new Response(null,{status:302,headers:{Location:full}});});
 assert.equal(calls,1);assert.deepEqual(result,{query:'43.0591547,141.2990003',label:'Shirogane Cafe'});
 assert.equal(locationFromMapsUrl('https://www.google.com/maps/@1,2,17z'),null);
 await assert.rejects(resolveMapsShare(short,async()=>new Response(null,{status:302,headers:{Location:'https://evil.example/maps/place/Test'}})));
 await assert.rejects(resolveMapsShare(short,async()=>new Response(null,{status:302,headers:{Location:short}})));
});
test('same share links reuse known locations without treating two itinerary names as two places',()=>{
 const stops=[{name:'nj0',q:'銀珈琲店 札幌',mapUrl:short},{name:'咖啡',mapUrl:short}];
 const leg=routeLeg(stops,1);assert.equal(leg.complete,true);assert.equal(leg.samePlace,true);
 const other={name:'下一站',mapUrl:'https://maps.app.goo.gl/other'};
 assert.equal(routeLeg([stops[0],other],1).complete,false);
 const cache=new Map([[other.mapUrl,{query:'43.1,141.3'}]]);
 assert.equal(routeLeg([stops[0],other],1,cache).destination,'43.1,141.3');
});
test('resolver authenticates, restricts origins and bounds requests',async()=>{
 const req=(url=short,user='alice',origin='https://trip.example')=>new Request('https://trip.example/api/maps-resolve',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(user?{'oai-authenticated-user-id':user}:{})},body:JSON.stringify({url})});
 assert.equal((await handleMapsResolve(req(short,null))).status,401);
 assert.equal((await handleMapsResolve(req(short,'alice','https://evil.example'))).status,403);
 assert.equal((await handleMapsResolve(req('https://evil.example/'))).status,400);
 assert.equal((await handleMapsResolve(req('a'.repeat(7000)))).status,413);
 const result=await handleMapsResolve(req(full));assert.equal(result.status,200);assert.equal((await result.json()).query,'43.0591547,141.2990003');
});
