import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoSync} from '../public/sync.js';

function harness(){
 const state={revision:3,ready:true,busy:false,pending:null,conflict:false,editing:false};
 const jobs=new Map(),applied=[],deferred=[],errors=[],requests=[];let sequence=0,active=true,healthy=0,fetcher=async()=>null;
 const controller=createAutoSync({getState:()=>({...state}),fetchSnapshot:revision=>{requests.push(revision);return fetcher(revision);},apply:data=>{applied.push(data);state.revision=data.revision;},onDeferred:data=>deferred.push(data.revision),onError:error=>errors.push(error),onHealthy:()=>healthy++,isActive:()=>active,schedule:(fn,delay)=>{const id=++sequence;jobs.set(id,{fn,delay});return id;},cancel:id=>jobs.delete(id)});
 return {controller,state,jobs,applied,deferred,errors,requests,set active(value){active=value;},set fetcher(value){fetcher=value;},get healthy(){return healthy;}};
}

test('visible pages apply a newer remote revision without a reload; unchanged or old responses do nothing',async()=>{
 const h=harness();await h.controller.tick();assert.equal(h.applied.length,0);
 h.fetcher=async()=>({revision:4,days:['shared edit']});await h.controller.tick();assert.equal(h.state.revision,4);assert.deepEqual(h.applied[0].days,['shared edit']);
 await h.controller.tick();h.fetcher=async()=>({revision:2});await h.controller.tick();assert.equal(h.applied.length,1);assert.deepEqual(h.requests,[3,3,4,4]);
});

test('unsaved editing is preserved and remote changes apply after editing ends',async()=>{
 const h=harness();h.state.editing=true;h.fetcher=async()=>({revision:4,days:['remote']});
 await h.controller.tick();await h.controller.tick();assert.deepEqual(h.deferred,[4]);assert.equal(h.state.revision,3);assert.equal(h.applied.length,0);
 h.state.editing=false;await h.controller.tick();assert.equal(h.applied.length,1);assert.equal(h.state.revision,4);
});

test('hidden, offline, saving, failed-save and conflict states do not poll',async()=>{
 const h=harness();h.active=false;await h.controller.tick();h.active=true;
 for(const key of ['busy','pending','conflict']){h.state[key]=true;await h.controller.tick();h.state[key]=false;}
 h.state.ready=false;await h.controller.tick();assert.equal(h.requests.length,0);
 h.state.ready=true;await h.controller.tick();assert.equal(h.requests.length,1);
});

test('a late read cannot overwrite a newer local save or an edit started while reading',async()=>{
 const h=harness();let resolve;
 h.fetcher=()=>new Promise(r=>{resolve=r;});
 let work=h.controller.tick();await Promise.resolve();h.state.revision=5;resolve({revision:4});await work;assert.equal(h.applied.length,0);assert.equal(h.state.revision,5);
 work=h.controller.tick();await Promise.resolve();h.state.busy=true;resolve({revision:6});await work;assert.equal(h.applied.length,0);
 h.state.busy=false;work=h.controller.tick();await Promise.resolve();h.state.editing=true;resolve({revision:6});await work;assert.deepEqual(h.deferred,[6]);
});

test('overlapping triggers share a request, retries back off and recovery resumes normal polling',async()=>{
 const h=harness();h.controller.start();await h.controller.tick();assert.equal(h.requests.length,1);assert.equal([...h.jobs.values()][0].delay,10000);
 h.fetcher=()=>{throw Error('Offline');};await h.controller.tick();assert.equal(h.errors.length,1);assert.equal([...h.jobs.values()][0].delay,20000);
 await h.controller.tick();assert.equal([...h.jobs.values()][0].delay,40000);
 h.fetcher=async()=>null;await h.controller.tick();assert.equal([...h.jobs.values()][0].delay,10000);assert.ok(h.healthy>=2);
 h.controller.stop();assert.equal(h.jobs.size,0);
});

test('stopping prevents in-flight work from replacing the page',async()=>{
 const h=harness();let resolve;h.fetcher=()=>new Promise(r=>{resolve=r;});
 h.controller.start();const work=h.controller.tick();await Promise.resolve();h.controller.stop();resolve({revision:4});await work;assert.equal(h.applied.length,0);assert.equal(h.jobs.size,0);
});
