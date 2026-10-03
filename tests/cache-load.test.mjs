import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVerifiedTripSnapshot} from '../public/cloud.js';
const session={email:'alice@example.com',trip:{id:'trip-one'},role:'viewer',canEdit:false};
const snapshot={trip:{id:'trip-one'},days:[],revision:4};
const denied=status=>Object.assign(Error('Denied'),{status});

test('live trip identity gates cached display and permissions come from the live session',async()=>{
 const calls=[];
 const cache={readTrip:id=>{calls.push('cache:'+id);return {...snapshot,revision:3,role:'owner'};},writeTrip:()=>calls.push('write')};
 await loadVerifiedTripSnapshot({tripId:'trip-one',fetchSession:async()=>{calls.push('session');return session;},
  onSession:value=>{assert.equal(value.role,'viewer');assert.equal(value.canEdit,false);calls.push('verified');return cache;},
  onCached:value=>{assert.equal(value.revision,3);calls.push('preview');},fetchSnapshot:async()=>{calls.push('network');return snapshot;},onFresh:()=>calls.push('fresh')});
 assert.deepEqual(calls,['session','verified','cache:trip-one','preview','network','write','fresh']);
});

test('expired, revoked and mismatched trip sessions cannot read any cached snapshot',async()=>{
 for(const status of [401,403])await assert.rejects(loadVerifiedTripSnapshot({tripId:'trip-one',fetchSession:async()=>{throw denied(status);},onSession:()=>assert.fail('cache was reached'),fetchSnapshot:()=>assert.fail('network trip was reached'),onFresh:()=>assert.fail()}),error=>error.status===status);
 await assert.rejects(loadVerifiedTripSnapshot({tripId:'trip-one',fetchSession:async()=>({...session,trip:{id:'other-trip'}}),onSession:()=>assert.fail('cache was reached'),onFresh:()=>assert.fail()}),error=>error.status===401);
});

test('an account switch selects only the cache for the newly verified account',async()=>{
 const read=[];
 await loadVerifiedTripSnapshot({tripId:'trip-one',fetchSession:async()=>({...session,email:'bob@example.com'}),
  onSession:value=>({readTrip:()=>{read.push(value.email);return null;},writeTrip:()=>{}}),
  fetchSnapshot:async()=>snapshot,onFresh:()=>{}});
 assert.deepEqual(read,['bob@example.com']);
});

test('a failed background read preserves the preview while auth failures purge the appropriate scope',async()=>{
 for(const status of [503,401,403]){
  const calls=[],cache={readTrip:()=>snapshot,writeTrip:()=>assert.fail('failed network was cached'),clearAccount:()=>calls.push('account'),deleteTrip:id=>calls.push(id)};
  await assert.rejects(loadVerifiedTripSnapshot({tripId:'trip-one',fetchSession:async()=>session,onSession:()=>cache,onCached:()=>calls.push('preview'),fetchSnapshot:async()=>{throw denied(status);},onFresh:()=>assert.fail()}),error=>error.status===status);
  assert.deepEqual(calls,status===401?['preview','account']:status===403?['preview','trip-one']:['preview']);
 }
});

test('a reply after logout cannot write cache or replace the visible itinerary',async()=>{
 let current=true;
 await loadVerifiedTripSnapshot({tripId:'trip-one',isCurrent:()=>current,fetchSession:async()=>session,
  onSession:()=>({readTrip:()=>null,writeTrip:()=>assert.fail('late response cached')}),
  fetchSnapshot:async()=>{current=false;return snapshot;},onFresh:()=>assert.fail('late response applied')});
 current=true;
 await loadVerifiedTripSnapshot({tripId:'trip-one',isCurrent:()=>current,fetchSession:async()=>{current=false;return session;},onSession:()=>assert.fail('late identity used'),fetchSnapshot:()=>assert.fail(),onFresh:()=>assert.fail()});
});

test('invalid or cross-trip network replies never populate the cache',async()=>{
 for(const invalid of [{...snapshot,trip:{id:'other-trip'}},{...snapshot,revision:-1},{...snapshot,days:null}])await assert.rejects(loadVerifiedTripSnapshot({tripId:'trip-one',fetchSession:async()=>session,onSession:()=>({readTrip:()=>null,writeTrip:()=>assert.fail()}),fetchSnapshot:async()=>invalid,onFresh:()=>assert.fail()}),/回應不完整/);
});
