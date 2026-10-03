import test from 'node:test';
import assert from 'node:assert/strict';
import {localDatabase} from '../scripts/local-db.mjs';
import {handleSharing,memberRole,sessionInfo} from '../server/sharing.js';
import {readCloudJson} from '../public/cloud.js';
const owner='owner@example.com',origin='https://trip.example.com';
const req=(method='GET',body,from=origin,email=owner)=>new Request(origin+'/trip/api/shares',{method,headers:{Origin:from,'Content-Type':'application/json','oai-authenticated-user-id':email,'X-Trip-Client':'multi-1'},body:body?JSON.stringify(body):undefined});
test('only owner manages whitelist; role changes and revocation take effect immediately',async()=>{
 const DB=localDatabase(),env={DB,OWNER_EMAIL:owner},admin=sessionInfo(owner,'owner');
 try{
  assert.equal(await memberRole(DB,owner,owner),'owner');assert.equal(await memberRole(DB,'friend@example.com',owner),null);
  for(const role of ['viewer','editor'])assert.equal((await handleSharing(req('PUT',{email:'friend@example.com',role:'editor',enabled:true},origin,'friend@example.com'),env,sessionInfo('friend@example.com',role))).status,403);
  let body={email:'Friend@Example.com',role:'viewer',enabled:true};assert.equal((await handleSharing(req('PUT',body),env,admin)).status,200);
  assert.equal(await memberRole(DB,'friend@example.com',owner),'viewer');
  body={...body,role:'editor'};assert.equal((await handleSharing(req('PUT',body),env,admin)).status,200);assert.equal(await memberRole(DB,'friend@example.com',owner),'editor');
  body.enabled=false;await handleSharing(req('PUT',body),env,admin);assert.equal(await memberRole(DB,'friend@example.com',owner),null);
  const list=await(await handleSharing(req(),env,admin)).json();assert.equal(list.members[0].enabled,0);
  body.enabled=true;await handleSharing(req('PUT',body),env,admin);assert.equal(await memberRole(DB,'friend@example.com',owner),'editor');
  assert.equal((await handleSharing(req('PUT',{email:owner,role:'viewer',enabled:false}),env,admin)).status,400);
  assert.equal((await handleSharing(req('PUT',body,'https://evil.example'),env,admin)).status,403);
  assert.equal((await handleSharing(req('PUT',{...body,email:'not-an-email'}),env,admin)).status,400);
  assert.equal((await handleSharing(req('PUT',{...body,role:'owner'}),env,admin)).status,400);
 }finally{DB.close();}
});
test('viewer permission errors remain distinct from expired login',async()=>{
 await assert.rejects(readCloudJson(Response.json({error:'只能查看行程。'},{status:403})),e=>e.status===403&&/只能查看/.test(e.message));
});
