import test from 'node:test';
import assert from 'node:assert/strict';
import {readCloudJson,fetchEmbedConfig,fetchTripUpdate} from '../public/cloud.js';
test('expired sign-in pages and unauthorized responses are distinguished from an unconfigured key',async()=>{
 for(const response of [new Response('Sign in',{headers:{'Content-Type':'text/html'}}),Response.json({error:'Unauthorized'},{status:401})])
  await assert.rejects(readCloudJson(response),e=>e.status===401&&/登入已過期/.test(e.message));
 assert.equal(await fetchEmbedConfig(async()=>Response.json({embedKey:''})), '');
 await assert.rejects(fetchEmbedConfig(async()=>Response.json({})),/設定回應不完整/);
});

test('trip updates accept an unchanged revision and retain authentication errors',async()=>{
 assert.equal(await fetchTripUpdate(7,async(url,options)=>{assert.equal(url,'/api/trip?revision=7');assert.equal(options.cache,'no-store');assert.ok(options.signal);return new Response(null,{status:204});}),null);
 assert.deepEqual(await fetchTripUpdate(7,async()=>Response.json({revision:8,days:[]})),{revision:8,days:[]});
 await assert.rejects(fetchTripUpdate(7,async()=>new Response('Sign in',{headers:{'Content-Type':'text/html'}})),e=>e.status===401);
});

test('conflict replies retain verified metadata for an explicit field choice',async()=>{
 const data={error:'名稱已變更',trip:{id:'trip-one',title:'雲端名称'},revision:9};
 await assert.rejects(readCloudJson(Response.json(data,{status:409})),error=>error.status===409&&error.message==='名稱已變更'&&assert.deepEqual(error.data,data)===undefined);
});
test('permission changes are delivered even when the itinerary revision did not change',async()=>{
 const roles=[];
 assert.equal(await fetchTripUpdate(3,async()=>new Response(null,{status:204,headers:{'X-Trip-Role':'viewer'}}),role=>roles.push(role)),null);
 await fetchTripUpdate(3,async()=>Response.json({revision:4,days:[],role:'editor'}),role=>roles.push(role));
 assert.deepEqual(roles,['viewer','editor']);
 await assert.rejects(fetchTripUpdate(3,async()=>Response.json({error:'已移除'},{status:403}),role=>roles.push(role)),error=>error.status===403);
 assert.deepEqual(roles,['viewer','editor']);
});
test('a failed config request can be retried, with no cached empty result',async()=>{
 let calls=0;
 const fetcher=async(url,options)=>{assert.equal(url,'/api/maps-config');assert.equal(options.cache,'no-store');assert.ok(options.signal);if(++calls===1)throw Error('Offline');return Response.json({embedKey:'test-key'});};
 await assert.rejects(fetchEmbedConfig(fetcher),/Offline/);
 assert.equal(await fetchEmbedConfig(fetcher),'test-key');assert.equal(calls,2);
 await assert.rejects(readCloudJson(new Response('Bad gateway',{status:502})),e=>e.status===502&&!/登入/.test(e.message));
});

test('a poll superseded by logout or a newer permission check cannot apply an old role or snapshot',async()=>{
 for(const response of [new Response(null,{status:204,headers:{'X-Trip-Role':'owner'}}),Response.json({revision:9,role:'owner',days:[]})]){
  let current=true;
  const update=await fetchTripUpdate(8,async()=>{current=false;return response;},()=>assert.fail('obsolete role applied'),()=>current);
  assert.equal(update,null);
 }
});
