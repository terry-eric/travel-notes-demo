import test from 'node:test';
import assert from 'node:assert/strict';
import {createTravelCache,CACHE_TTL_MS,CACHE_MAX_TRIPS,CACHE_VERSION} from '../public/cache.js';
function memory(){const values=new Map();return {values,get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const metadata=id=>({id,title:'台北之旅',startDate:'2028-02-28',endDate:'2028-02-29',timezone:'Asia/Taipei'});
function snapshot(id='trip-one',revision=1){return {trip:metadata(id),revision,role:'owner',previous:null,days:[{isoDate:'2028-02-28',date:'2/28',week:'週一',color:'#557c68',tint:'#e9f0e8',title:'第一天',stops:[{id:'station',name:'台北車站',time:'09:00',q:'台北車站',tag:'交通',desc:'旅館寄放行李',mode:'walking',duration:15}]},{isoDate:'2028-02-29',date:'2/29',week:'週二',color:'#617b98',tint:'#eaf0f6',stops:[]}]};}
const entry=(id='trip-one',revision=1,role='owner')=>({...metadata(id),revision,role,canEdit:true,canShare:true});
const make=(storage,more={})=>createTravelCache({storage,appBase:'/trip',email:'alice@example.com',...more});

test('authenticated account and app scopes isolate snapshots, catalogues, places and cleanup',()=>{
 const storage=memory(),a=make(storage),b=make(storage,{email:'bob@example.com'}),other=make(storage,{appBase:'/other'});
 assert.equal(a.writeTrip('trip-one',snapshot()),true);assert.equal(a.writeCatalogue({email:'alice@example.com',trips:[entry()],deletedTrips:[]}),true);assert.equal(a.writePlaces('trip-one',{'https://maps.app.goo.gl/taipei':{query:'台北車站'}}),true);
 assert.equal(b.readTrip('trip-one'),null);assert.equal(b.readCatalogue(),null);assert.equal(b.readPlaces('trip-one'),null);assert.equal(other.readTrip('trip-one'),null);
 b.writeTrip('trip-one',snapshot('trip-one',8));other.writeTrip('trip-one',snapshot('trip-one',9));
 assert.equal(a.ownsKey(a.accountPrefix+'trip:trip-one'),true);assert.equal(a.ownsKey(b.accountPrefix+'trip:trip-one'),false);assert.equal(a.ownsKey(null),false);
 assert.equal(a.clearAccount(),true);assert.equal(a.readTrip('trip-one'),null);assert.equal(a.readCatalogue(),null);assert.equal(a.readPlaces('trip-one'),null);assert.equal(b.readTrip('trip-one').revision,8);assert.equal(other.readTrip('trip-one').revision,9);
 const missing=createTravelCache({storage,appBase:'/trip'});assert.equal(missing.readTrip('trip-one'),null);assert.equal(missing.writeTrip('trip-one',snapshot()),false);assert.equal(missing.accountPrefix,'');
 assert.equal(make(storage,{email:'Alice@Example.com',appBase:'/trip/'}).accountPrefix,a.accountPrefix);
});

test('cache writes and reads strip identity, credentials, authorization and undo history',()=>{
 const storage=memory(),cache=make(storage),data=snapshot();
 Object.assign(data,{email:'private@example.com',canEdit:true,canShare:true,embedKey:'private-secret',token:'private-secret',logoutUrl:'/logout',identityHint:'private-secret',previous:snapshot().days});
 Object.assign(data.trip,{owner_email:'private@example.com',apiKey:'private-secret'});data.days[0].stops[0].JWT='private-secret';data.days[0].embedKey='private-secret';
 assert.equal(cache.writeTrip('trip-one',data),true);assert.equal(cache.writeCatalogue({trips:[{...entry(),token:'private-secret'}],deletedTrips:[],email:'private@example.com',logoutUrl:'private-secret'}),true);
 const stored=[...storage.values.values()].join('\n');assert.ok(!stored.includes('private-secret'));assert.ok(!stored.includes('private@example.com'));assert.ok(!stored.includes('canEdit'));assert.ok(!stored.includes('canShare'));assert.ok(!stored.includes('previous'));assert.ok(!stored.includes('logoutUrl'));
 const loaded=cache.readTrip('trip-one');assert.equal(loaded.role,'owner');assert.equal(loaded.canEdit,undefined);assert.equal(loaded.previous,undefined);assert.equal(cache.readCatalogue().trips[0].role,'owner');
 const key=cache.accountPrefix+'trip:trip-one',forged=JSON.parse(storage.getItem(key));forged.data.canShare=true;forged.data.trip.token='private-secret';storage.setItem(key,JSON.stringify(forged));assert.equal(cache.readTrip('trip-one').canShare,undefined);assert.equal(cache.readTrip('trip-one').trip.token,undefined);
});

test('equal revisions refresh TTL while older replies cannot replace a newer snapshot',()=>{
 let clock=1000;const storage=memory(),cache=make(storage,{now:()=>clock});cache.writeTrip('trip-one',snapshot('trip-one',4));
 clock+=CACHE_TTL_MS-1;assert.equal(cache.readTrip('trip-one').revision,4);
 const old=snapshot('trip-one',3);old.days[0].stops[0].name='過期回應';assert.equal(cache.writeTrip('trip-one',old),false);assert.equal(cache.readTrip('trip-one').days[0].stops[0].name,'台北車站');
 assert.equal(cache.writeTrip('trip-one',snapshot('trip-one',4)),true);clock+=CACHE_TTL_MS-1;assert.equal(cache.readTrip('trip-one').revision,4);clock++;assert.equal(cache.readTrip('trip-one'),null);assert.equal(storage.getItem(cache.accountPrefix+'trip:trip-one'),null);
});

test('catalogue and places expire after 24 hours; clearing one never erases the other trip data',()=>{
 let clock=1;const storage=memory(),cache=make(storage,{now:()=>clock});cache.writeTrip('trip-one',snapshot());cache.writeCatalogue({trips:[entry()],deletedTrips:[]});cache.writePlaces('trip-one',{'https://maps.app.goo.gl/taipei':{query:'台北車站'}});
 assert.equal(cache.clearCatalogue(),true);assert.equal(cache.readCatalogue(),null);assert.equal(cache.readTrip('trip-one').revision,1);assert.ok(cache.readPlaces('trip-one'));
 cache.writeCatalogue({trips:[entry()],deletedTrips:[]});clock+=CACHE_TTL_MS;assert.equal(cache.readCatalogue(),null);assert.equal(cache.readPlaces('trip-one'),null);
 cache.writeTrip('trip-one',snapshot());cache.writePlaces('trip-one',{'https://maps.app.goo.gl/taipei':{query:'台北車站'}});assert.equal(cache.deleteTrip('trip-one'),true);assert.equal(cache.readTrip('trip-one'),null);assert.equal(cache.readPlaces('trip-one'),null);
});

test('bad versions, broken JSON, mismatched trip identities and invalid day calendars are removed safely',()=>{
 const storage=memory(),cache=make(storage,{now:()=>1000}),key=cache.accountPrefix+'trip:trip-one';
 for(const raw of ['{broken',JSON.stringify({version:CACHE_VERSION+1,savedAt:1000,data:snapshot()}),JSON.stringify({version:CACHE_VERSION,savedAt:1000,data:snapshot('wrong-trip')})]){storage.setItem(key,raw);assert.equal(cache.readTrip('trip-one'),null);assert.equal(storage.getItem(key),null);}
 const invalid=snapshot();invalid.days[1].isoDate='2028-03-01';assert.equal(cache.writeTrip('trip-one',invalid),false);invalid.days[1].isoDate='2028-02-29';invalid.days.pop();assert.equal(cache.writeTrip('trip-one',invalid),false);
 const duplicate=snapshot();duplicate.days[1].stops=[duplicate.days[0].stops[0]];assert.equal(cache.writeTrip('trip-one',duplicate),false);
 assert.equal(cache.writeTrip('trip-one',snapshot('different-id')),false);assert.equal(cache.writeTrip('bad id',snapshot()),false);
});

test('catalogue failures and older metadata never overwrite a known newer trip snapshot',()=>{
 const storage=memory(),cache=make(storage);cache.writeTrip('trip-one',snapshot('trip-one',12));cache.writeCatalogue({trips:[entry('trip-one',12)],deletedTrips:[]});
 assert.equal(cache.writeCatalogue({trips:[entry('trip-one',2)],deletedTrips:[]}),true);assert.equal(cache.readTrip('trip-one').revision,12);
 assert.equal(cache.writeCatalogue({trips:'bad',deletedTrips:[]}),false);assert.equal(cache.readCatalogue().trips[0].revision,2);assert.equal(cache.readTrip('trip-one').revision,12);
 storage.setItem(cache.accountPrefix+'catalogue','invalid JSON');assert.equal(cache.readCatalogue(),null);assert.equal(cache.readTrip('trip-one').revision,12);
 const limited=Array.from({length:250},(_,i)=>entry('trip-'+i));assert.equal(cache.writeCatalogue({trips:limited,deletedTrips:[]}),true);assert.equal(cache.readCatalogue().trips.length,200);
 const deleted={...entry('deleted-trip',7),deletedAt:'2026-10-03T00:00:00.000Z'};assert.equal(cache.writeCatalogue({trips:[],deletedTrips:[deleted]}),true);assert.equal(cache.readCatalogue().deletedTrips[0].canShare,undefined);
});

test('place caches keep only validated original Maps URLs and bounded queries, without resolver secrets or redirects',()=>{
 const storage=memory(),cache=make(storage),url='https://maps.app.goo.gl/taipei';
 assert.equal(cache.writePlaces('trip-one',new Map([[url,{query:'台北車站',label:'unused',redirectUrl:'https://google.com/private-secret',apiKey:'private-secret'}]])),true);assert.deepEqual(cache.readPlaces('trip-one'),{[url]:{query:'台北車站'}});assert.ok(!storage.getItem(cache.accountPrefix+'places:trip-one').includes('private-secret'));
 for(const bad of ['https://evil.example/maps','https://maps.app.goo.gl/taipei?key=private-secret','https://www.google.com/maps/embed/v1/place?q=Taipei&key=private-secret'])assert.equal(cache.writePlaces('trip-one',{[bad]:{query:'台北'}}),false);
 assert.equal(cache.writePlaces('trip-one',{[url]:{query:'x'.repeat(1001)}}),false);assert.deepEqual(cache.readPlaces('trip-one'),{[url]:{query:'台北車站'}});
 const many=Object.fromEntries(Array.from({length:105},(_,i)=>['https://maps.app.goo.gl/place'+i,{query:'地點'+i}]));assert.equal(cache.writePlaces('trip-one',many),true);assert.equal(Object.keys(cache.readPlaces('trip-one')).length,100);assert.equal(cache.readPlaces('trip-one')['https://maps.app.goo.gl/place0'],undefined);
});

test('cache entry and byte limits evict oldest accounts trips and reject oversized snapshots without data loss',()=>{
 let clock=0;const storage=memory(),cache=make(storage,{now:()=>++clock});
 for(let i=0;i<CACHE_MAX_TRIPS+1;i++){const id='trip-'+i;assert.equal(cache.writeTrip(id,snapshot(id)),true);assert.equal(cache.writePlaces(id,{'https://maps.app.goo.gl/taipei':{query:'台北'}}),true);}
 assert.equal(cache.readTrip('trip-0'),null);assert.equal(cache.readPlaces('trip-0'),null);assert.ok(cache.readTrip('trip-20'));assert.equal([...storage.values.keys()].filter(key=>key.includes(':trip:')).length,CACHE_MAX_TRIPS);
 const large=snapshot('trip-20',2);large.days[0].stops=Array.from({length:100},(_,i)=>({id:'stop-'+i,name:'景點',desc:'樽'.repeat(2000)}));assert.equal(cache.writeTrip('trip-20',large),false);assert.equal(cache.readTrip('trip-20').revision,1);
});

test('blocked local storage and quota failures never interrupt the app or overwrite previously saved data',()=>{
 const throwing={getItem(){throw Error('blocked');},setItem(){throw Error('quota');},removeItem(){throw Error('blocked');}},disabled=make(throwing);
 assert.equal(disabled.readTrip('trip-one'),null);assert.equal(disabled.writeTrip('trip-one',snapshot()),false);assert.equal(disabled.readCatalogue(),null);assert.equal(disabled.writeCatalogue({trips:[],deletedTrips:[]}),false);assert.equal(disabled.clearAccount(),false);
 const getter={get getItem(){throw Error('blocked');}};assert.doesNotThrow(()=>make(getter));assert.equal(make(getter).writeTrip('trip-one',snapshot()),false);
 const storage=memory(),cache=make(storage);cache.writeTrip('trip-one',snapshot('trip-one',3));cache.writeCatalogue({trips:[entry('trip-one',3)],deletedTrips:[]});const originalSet=storage.setItem;
 storage.setItem=()=>{throw Error('quota');};assert.equal(cache.writeTrip('trip-one',snapshot('trip-one',4)),false);assert.equal(cache.writeCatalogue({trips:[],deletedTrips:[]}),false);assert.equal(cache.readTrip('trip-one').revision,3);assert.equal(cache.readCatalogue().trips.length,1);storage.setItem=originalSet;
});
