import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/cloudflare.js';
import {localDatabase} from '../scripts/local-db.mjs';

const origin='https://demo.terry878.org',base=origin+'/trip';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const alice='new-alice@example.com',bob='new-bob@example.com',stranger='new-stranger@example.com';

test('public registration keeps signed accounts private through the deployed Worker boundary and explicit invitations',async()=>{
 const DB=localDatabase(),realFetch=globalThis.fetch;
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'public-account-isolation-key'};
 const env={DB,APP_HOST:new URL(origin).hostname,APP_BASE:'/trip',OWNER_EMAIL:'legacy-owner@example.com',ACCESS_ISSUER:'https://public-account-test.cloudflareaccess.com',ACCESS_AUD:'public-account-audience'};
 globalThis.fetch=async url=>{assert.equal(url,env.ACCESS_ISSUER+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
 async function signed(email){
  const payload=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({iss:env.ACCESS_ISSUER,aud:[env.ACCESS_AUD],email,sub:email,exp:Date.now()/1000+60});
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(payload));
  return payload+'.'+Buffer.from(signature).toString('base64url');
 }
 async function request(path,email,method='GET',body,more={}){
  const headers={'Content-Type':'application/json',Origin:origin,'X-Trip-Client':'multi-2','oai-authenticated-user-id':env.OWNER_EMAIL,...more};
  if(email)headers['Cf-Access-Jwt-Assertion']=await signed(email);
  return worker.fetch(new Request(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 }
 async function json(path,email){const response=await request(path,email);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');return response.json();}
 const tripPath=id=>'/api/trip?trip='+id,shares=id=>'/api/shares?trip='+id;
 async function create(email,title,more={}){
  const response=await request('/api/trips',email,'POST',{creationId:crypto.randomUUID(),title,startDate:'2028-04-01',endDate:'2028-04-02',...more});
  assert.equal(response.status,201);assert.equal(response.headers.get('Cache-Control'),'private, no-store');return response.json();
 }
 async function privateDenial(response,marker){
  assert.equal(response.status,403);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  const text=await response.text();assert.ok(!text.includes(marker));assert.ok(!text.includes('"days"'));assert.ok(!text.includes('"previous"'));assert.ok(!text.includes('"revision"'));
 }
 try{
  // No global whitelist or legacy trip invitation is necessary to use an account.
  for(const email of [alice,bob,stranger]){
   const session=await json('/api/session',email);assert.equal(session.email,email);assert.equal(session.role,'personal');assert.equal(session.trip,null);
   const catalogue=await json('/api/trips',email);assert.deepEqual(catalogue.trips,[]);assert.deepEqual(catalogue.deletedTrips,[]);
  }
  const marker='Alice-only private reservation',a=await create(alice,marker,{owner_email:bob}),b=await create(bob,'Bob-only travel');
  a.days[0].stops.push({id:'alice-only-stop',name:marker,time:'09:00',desc:marker,q:'台北車站',duration:15,mode:'walking'});
  const save=await request(tripPath(a.trip.id),alice,'PUT',{days:a.days,revision:0,mutationId:'alice-private-save'});assert.equal(save.status,200);
  const saved=await save.json();assert.equal(saved.role,'owner');assert.equal(saved.revision,1);
  assert.deepEqual((await json('/api/trips',alice)).trips.map(trip=>[trip.id,trip.role]),[[a.trip.id,'owner']]);
  assert.deepEqual((await json('/api/trips',bob)).trips.map(trip=>[trip.id,trip.role]),[[b.trip.id,'owner']]);
  assert.deepEqual((await json('/api/trips',stranger)).trips,[]);
  // The signed identity replaces the forged legacy-owner header on every request.
  const cases=[
   [tripPath(a.trip.id),'GET'],[tripPath(a.trip.id)+'&revision=1','GET'],['/api/session?trip='+a.trip.id,'GET'],
   [shares(a.trip.id),'GET'],[shares(a.trip.id),'PUT',{email:bob,role:'editor',enabled:true}],
   [tripPath(a.trip.id),'PUT',{days:saved.days,revision:1,mutationId:'outsider-save'}],
   ['/api/trips','PATCH',{id:a.trip.id,title:'taken',baseTitle:marker,revision:1,mutationId:'outsider-title'}],
   ['/api/trips','DELETE',{id:a.trip.id,revision:1,permanent:true}]
  ];
  for(const email of [bob,stranger])for(const [path,method,body] of cases)await privateDenial(await request(path,email,method,body),marker);
  for(const email of [alice,bob,stranger]){const disabled=await request('/api/trips',email,'PUT',{id:a.trip.id,revision:1,action:'restore'});assert.equal(disabled.status,405);assert.ok(!(await disabled.text()).includes(marker));}
  const collision=await request('/api/trips',bob,'POST',{creationId:a.trip.id,title:marker,startDate:'2028-04-01',endDate:'2028-04-02'});
  assert.equal(collision.status,409);assert.ok(!(await collision.text()).includes(marker));
  assert.equal((await json(tripPath(a.trip.id),alice)).revision,1);
  assert.equal((await request('/api/trips',null)).status,401);
  // Neither private persistence nor the legacy seed is a downloadable asset.
  for(const path of ['/seed.js','/.env','/server/trips.js','/.openai/deploy.json','/drizzle/0000_schema.sql'])assert.equal((await request(path,bob)).status,404);
  const app=await request('/app.js',bob);assert.equal(app.status,200);assert.ok(!(await app.text()).includes(marker));
  assert.equal((await worker.fetch(new Request('https://trip-planner.test.workers.dev/trip/api/trips',{headers:{'Cf-Access-Jwt-Assertion':await signed(alice)}}),env)).status,404);
  // An invitation grants one trip only; a viewer cannot edit or invite others.
  assert.equal((await request(shares(a.trip.id),alice,'PUT',{email:bob,role:'viewer',enabled:true})).status,200);
  const shared=await json(tripPath(a.trip.id),bob);assert.equal(shared.role,'viewer');assert.equal(shared.days[0].stops[0].name,marker);assert.equal(shared.previous,null);
  const ownCatalogue=await json('/api/trips',bob);assert.equal(ownCatalogue.trips.length,2);assert.equal(ownCatalogue.trips.find(trip=>trip.id===a.trip.id).role,'viewer');
  assert.equal((await request(tripPath(a.trip.id),bob,'PUT',{days:saved.days,revision:1,mutationId:'viewer-save'})).status,403);
  assert.equal((await request(shares(a.trip.id),bob,'PUT',{email:stranger,role:'editor',enabled:true})).status,403);
  await privateDenial(await request(tripPath(a.trip.id),stranger),marker);
  // Revocation blocks both full snapshots and unchanged-revision polling.
  assert.equal((await request(shares(a.trip.id),alice,'PUT',{email:bob,role:'viewer',enabled:false})).status,200);
  await privateDenial(await request(tripPath(a.trip.id),bob),marker);
  await privateDenial(await request(tripPath(a.trip.id)+'&revision=1',bob),marker);
  await privateDenial(await request('/api/session?trip='+a.trip.id,bob),marker);
  assert.deepEqual((await json('/api/trips',bob)).trips.map(trip=>trip.id),[b.trip.id]);
  assert.equal((await json(tripPath(b.trip.id),bob)).role,'owner');
 }finally{globalThis.fetch=realFetch;DB.close();}
});
