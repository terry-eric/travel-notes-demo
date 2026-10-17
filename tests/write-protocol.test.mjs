import test from 'node:test';import assert from 'node:assert/strict';
import {handleApi,handleTrips} from '../server/api.js';import {API_CLIENT} from '../server/trips.js';import {localDatabase} from '../scripts/local-db.mjs';
test('a stale page cannot overwrite newly supported flight and location data',async t=>{
 const DB=localDatabase();t.after(()=>DB.close());const env={DB,OWNER_EMAIL:'protocol@example.com'},origin='https://trip.test';
 const request=(path,method='GET',body,client=API_CLIENT)=>new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Trip-Client':client,'oai-authenticated-user-id':'protocol@example.com'},...(body?{body:JSON.stringify(body)}:{})});
 const created=await (await handleTrips(request('/api/trips','POST',{title:'測試',startDate:'2027-04-12',endDate:'2027-04-12',timezone:'Asia/Tokyo'}),env)).json();
 created.days[0].stops=[{id:'flight-protocol',name:'測試機票',time:'10:00',q:'TPE',tag:'機票',desc:'',mode:'transit',kind:'flight',coordinates:{lat:25.08,lng:121.23},flight:{departureAirport:'TPE',arrivalAirport:'CTS',departureDateTime:'2027-04-12T10:00',arrivalDateTime:'2027-04-12T14:00',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo'}}];
 const path='/api/trip?trip='+created.trip.id;
 const saved=await (await handleApi(request(path,'PUT',{revision:0,mutationId:'current-client-save',days:created.days}),env)).json();
 const stale=structuredClone(saved.days);delete stale[0].stops[0].kind;delete stale[0].stops[0].flight;delete stale[0].stops[0].coordinates;
 const denied=await handleApi(request(path,'PUT',{revision:saved.revision,mutationId:'stale-client-save',days:stale},'multi-1'),env);
 assert.equal(denied.status,428);
 const after=await (await handleApi(request(path),env)).json();assert.equal(after.revision,saved.revision);assert.deepEqual(after.days,saved.days);
});
