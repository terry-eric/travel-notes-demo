import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoApi,demoStorageKey} from '../demo/api.js';
import {cleanState,DEMO_EMAIL} from '../demo/model.js';
import {DEMO_TRIP_ID} from '../demo/seed.js';
import {legSignature,savedTravelMinutes} from '../public/transport.js';
import {parseGptImport,buildGptPrompt} from '../public/gpt-import.js';
import {insertImported} from '../public/import.js';

function memoryStorage(){const data=new Map();return {getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key),key:index=>[...data.keys()][index]??null,get length(){return data.size;},data};}
const call=async(api,path,method='GET',body)=>{const response=await api.fetch('/travel-demo/api/'+path,{method,...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:response.status===204?null:await response.json()};};
const trip=()=>`trip?trip=${DEMO_TRIP_ID}`;

test('synthetic seed persists without backend and exposes a browser-only identity',async()=>{
 const storage=memoryStorage(),api=createDemoApi({storage,base:'/travel-demo'});
 const session=await call(api,'session?trip='+DEMO_TRIP_ID);
 assert.equal(session.data.email,DEMO_EMAIL);assert.equal(session.data.canEdit,true);assert.equal(session.data.canShare,false);assert.equal(session.data.logoutUrl,undefined);
 const loaded=await call(api,trip());assert.equal(loaded.data.days.length,3);assert.equal(loaded.data.trip.timezone,'Asia/Tokyo');assert.equal(loaded.data.days[0].stops[2].createdBy,'demo-a@example.invalid');
 assert.deepEqual((await call(createDemoApi({storage,base:'/travel-demo'}),trip())).data,loaded.data);
 assert.equal((await call(api,'maps-config')).data.embedKey,'');assert.equal((await call(api,'shares')).status,501);
 assert.equal((await api.fetch('/other/api/trip')).status,404);
});

test('create, rename, soft delete and restore survive a fresh API instance',async()=>{
 const storage=memoryStorage(),api=createDemoApi({storage,base:'/travel-demo'});
 const input={title:'新的示範旅行',startDate:'2028-02-28',endDate:'2028-03-01',timezone:'Asia/Taipei',creationId:'created-demo'};
 const created=await call(api,'trips','POST',input);assert.equal(created.status,201);assert.equal(created.data.days.length,3);assert.equal(created.data.days[1].isoDate,'2028-02-29');
 assert.equal((await call(api,'trips','POST',input)).data.revision,0);
 const renamed=await call(api,'trips','PATCH',{id:'created-demo',title:'改名後',baseTitle:input.title,revision:0,mutationId:'rename-demo'});assert.equal(renamed.data.trip.title,'改名後');assert.equal(renamed.data.revision,1);
 const conflicting=await call(api,'trips','PATCH',{id:'created-demo',title:'不同名稱',baseTitle:input.title,revision:0,mutationId:'rename-conflict'});assert.equal(conflicting.status,409);assert.equal(conflicting.data.trip.title,'改名後');
 assert.equal((await call(api,'trips','DELETE',{id:'created-demo',revision:1})).status,200);
 const list=await call(createDemoApi({storage,base:'/travel-demo'}),'trips');assert.equal(list.data.deletedTrips[0].title,'改名後');assert.ok(!list.data.trips.some(item=>item.id==='created-demo'));
 assert.equal((await call(api,'trip?trip=created-demo')).status,403);
 assert.equal((await call(api,'trips','PUT',{id:'created-demo',revision:2,action:'restore'})).status,200);
 assert.equal((await call(api,'trip?trip=created-demo')).data.trip.title,'改名後');
});

test('stop edits, ordering, manual minutes and fixed creator attribution persist with undo',async()=>{
 const storage=memoryStorage(),api=createDemoApi({storage,base:'/travel-demo'}),original=(await call(api,trip())).data;
 const days=structuredClone(original.days),stops=days[0].stops;
 stops.unshift({id:'added-demo-stop',name:'示範新增行程',time:'08:00',q:'Kyoto Station',tag:'交通',desc:'新增及排序',mode:'transit',duration:30,live:true,createdBy:'someone@example.com'});
 stops[1].travelMinutes=20;stops[1].travelSignature=legSignature(stops,1);stops[2].name='改名景點';
 const saved=await call(api,trip(),'PUT',{days,revision:0,mutationId:'stops-save'});assert.equal(saved.status,200);assert.equal(saved.data.days[0].stops[0].createdBy,DEMO_EMAIL);assert.equal(saved.data.days[0].stops[3].createdBy,'demo-a@example.invalid');assert.equal(savedTravelMinutes(saved.data.days[0].stops,1),20);assert.deepEqual(saved.data.previous,original.days);
 assert.equal((await call(api,trip(),'PUT',{days,revision:0,mutationId:'stops-save'})).data.revision,1);
 assert.equal((await call(api,trip(),'PUT',{days,revision:0,mutationId:'stale-save'})).status,409);
 const fresh=createDemoApi({storage,base:'/travel-demo'}),loaded=(await call(fresh,trip())).data;assert.equal(loaded.days[0].stops[2].name,'改名景點');
 const undo=await call(fresh,trip(),'PUT',{days:loaded.previous,revision:1,mutationId:'undo-save'});assert.deepEqual(undo.data.days,original.days.map(day=>({...day,stops:day.stops.map(stop=>({...stop,createdBy:stop.createdBy||DEMO_EMAIL}))})));
 assert.equal((await call(fresh,trip()+'&revision=2')).status,204);
});

test('date edit, add, order and deletion keep calendar and metadata consistent',async()=>{
 const api=createDemoApi({storage:memoryStorage(),base:'/travel-demo'}),path='demo/days?trip='+DEMO_TRIP_ID;
 const edit=await call(api,path,'PUT',{action:'edit',index:0,revision:0,title:'新主題',sub:'新的小標',intro:'介紹',tip:'提醒'});assert.equal(edit.data.days[0].title,'新主題');
 const add=await call(api,path,'PUT',{action:'add',revision:1});assert.equal(add.data.days.length,4);assert.equal(add.data.trip.endDate,'2027-04-15');
 const move=await call(api,path,'PUT',{action:'move',index:0,to:2,revision:2});assert.equal(move.data.days[2].title,'新主題');assert.equal(move.data.days[2].isoDate,'2027-04-14');
 const remove=await call(api,path,'PUT',{action:'delete',index:1,revision:3});assert.equal(remove.data.days.length,3);assert.equal(remove.data.trip.endDate,'2027-04-14');assert.equal(remove.data.previous,null);assert.equal(remove.data.days[1].title,'新主題');
 assert.equal((await call(api,path,'PUT',{action:'delete',index:0,revision:2})).status,409);
});

test('schema strips unrelated fields and rejects malformed dates, duplicate ids and credential map URLs',async()=>{
 const api=createDemoApi({storage:memoryStorage(),base:'/travel-demo'}),initial=(await call(api,trip())).data;
 const state=api.load();state.credentials='must not persist';state.trips[0].days[0].stops[0].token='must not persist';const clean=cleanState(state);assert.equal(clean.credentials,undefined);assert.equal(clean.trips[0].days[0].stops[0].token,undefined);
 for(const change of [days=>days[0].stops[0].duration=-1,days=>days[0].stops[1].id=days[0].stops[0].id,days=>days[0].stops[0].mapUrl='https://www.google.com/maps/search/?api=1&query=Kyoto&key=demo-secret']){
  const days=structuredClone(initial.days);change(days);assert.equal((await call(api,trip(),'PUT',{days,revision:0,mutationId:'invalid-stop'})).status,400);
 }
 assert.equal((await call(api,'trips','POST',{title:'壞日期',startDate:'2027-02-30',endDate:'2027-03-01',creationId:'bad-date'})).status,400);
 assert.equal((await call(api,trip())).data.revision,0);
});

test('malformed/versioned storage recovers only demo scope; reset leaves unrelated apps intact',async()=>{
 const storage=memoryStorage(),api=createDemoApi({storage,base:'/travel-demo'});
 const unrelated=[demoStorageKey('/other-demo'),'production-setting','trip-cache-v1:%2Ftravel-demo:user%40example.com:trip:private','trip-draft-v2:/other-demo:demo-local@example.invalid:trip:tab'];
 for(const key of unrelated)storage.setItem(key,'keep');
 storage.setItem(api.storageKey,JSON.stringify({version:999,trips:[]}));assert.equal(api.load().trips.length,1);assert.equal(api.recovered,true);
 storage.setItem('trip-cache-v1:%2Ftravel-demo:demo-local%40example.invalid:trip:demo','discard');storage.setItem('trip-draft-v2:/travel-demo:demo-local@example.invalid:demo:tab','discard');
 api.reset();assert.equal(api.recovered,false);assert.equal(storage.getItem('trip-cache-v1:%2Ftravel-demo:demo-local%40example.invalid:trip:demo'),null);assert.equal(storage.getItem('trip-draft-v2:/travel-demo:demo-local@example.invalid:demo:tab'),null);
 for(const key of unrelated)assert.equal(storage.getItem(key),'keep');
 assert.equal(api.load().trips[0].trip.id,DEMO_TRIP_ID);
});

test('storage failures are reported without claiming that the data was saved',async()=>{
 const storage=memoryStorage(),api=createDemoApi({storage,base:'/travel-demo'});await call(api,trip());
 storage.setItem=()=>{throw Error('Quota exceeded');};
 const initial=(await call(api,trip())).data,days=structuredClone(initial.days);days[0].stops[0].name='Unsaved';
 const failed=await call(api,trip(),'PUT',{days,revision:0,mutationId:'failed-save'});assert.equal(failed.status,503);assert.match(failed.data.error,/無法儲存/);assert.equal((await call(api,trip())).data.days[0].stops[0].name,initial.days[0].stops[0].name);
});

test('concurrent creation and Request inputs preserve both browser mutations',async()=>{
 const api=createDemoApi({storage:memoryStorage(),base:'/travel-demo'});
 const body=id=>({title:id,startDate:'2027-01-01',endDate:'2027-01-01',timezone:'Asia/Taipei',creationId:id});
 const results=await Promise.all([
  api.fetch(new Request('https://demo.invalid/travel-demo/api/trips',{method:'POST',body:JSON.stringify(body('first-demo'))})),
  api.fetch(new Request('https://demo.invalid/travel-demo/api/trips',{method:'POST',body:JSON.stringify(body('second-demo'))}))
 ]);
 assert.deepEqual(results.map(response=>response.status),[201,201]);
 const catalogue=(await call(api,'trips')).data;
 assert.ok(catalogue.trips.some(item=>item.id==='first-demo'));assert.ok(catalogue.trips.some(item=>item.id==='second-demo'));
});

test('GPT import runs locally and the resulting fixed stop is saved with synthetic attribution',async()=>{
 const api=createDemoApi({storage:memoryStorage(),base:'/travel-demo'}),initial=(await call(api,trip())).data;
 const prompt=buildGptPrompt(initial.days,initial.trip);assert.match(prompt,/2027-04-12/);assert.match(prompt,/京都散步/);assert.doesNotMatch(prompt,/札幌|小樽|milet|YOASOBI/);
 const input=JSON.stringify({format:'trip-gpt-v1',stops:[{date:'2027-04-14',time:'11:00',name:'示範書店預約',place:'Kyoto Japan',durationMinutes:45,tag:'預約',mode:'walking',fixed:true,notes:'合成匯入內容'}]});
 const rows=parseGptImport(input,initial.days).map((row,index)=>({...row,id:'import-demo-'+index})),days=insertImported(initial.days,rows);
 const saved=await call(api,trip(),'PUT',{days,revision:0,mutationId:'gpt-import-demo'}),stop=saved.data.days[2].stops.find(item=>item.id==='import-demo-0');
 assert.equal(saved.status,200);assert.equal(stop.live,true);assert.equal(stop.createdBy,DEMO_EMAIL);assert.equal(stop.duration,45);assert.equal(stop.desc,'合成匯入內容');assert.equal(new URL(stop.mapUrl).searchParams.get('query'),'Kyoto Japan');
});
