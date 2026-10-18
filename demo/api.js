import {calendarDays,cleanDays,cleanState,metadata,text,safeId,DEMO_EMAIL,DAY_MS,dateStamp} from './model.js';
import {createDemoState,hydrateDemoCoordinates} from './seed.js';
import {locationFromMapsUrl,parseMapsShare} from '../public/maps-link.js';
import {clearStaleTravel} from '../public/transport.js';
import {withoutDeletedStops} from '../public/drafts.js';

const MAX_BYTES=3000000;
export function demoStorageKey(base=''){
 if(typeof base!=='string'||base&&(!base.startsWith('/')||base.startsWith('//')||/[?#]/.test(base)))throw Error('示範路徑不正確。');
 return 'travel-notes-demo:v1:'+encodeURIComponent(base.replace(/\/+$/,'')||'/')+':state';
}
export function demoOwnedStorageKey(key,base=''){
 base=base.replace(/\/+$/,'');const normalized=base||'/';
 return key===demoStorageKey(base)||typeof key==='string'&&(key.startsWith(`trip-cache-v1:${encodeURIComponent(normalized)}:${encodeURIComponent(DEMO_EMAIL)}:`)||key.startsWith(`trip-geocode-v1:${encodeURIComponent(normalized)}:${encodeURIComponent(DEMO_EMAIL)}:`)||key.startsWith(`trip-draft-v2:${base}:${DEMO_EMAIL}:`)||key.startsWith(`trip-draft-v1:${base}:${DEMO_EMAIL}:`));
}
function fault(message,status=400){const error=Error(message);error.status=status;return error;}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const snapshot=entry=>({trip:entry.trip,days:entry.days,previous:entry.previous,revision:entry.revision,role:'owner'});
const record=entry=>({...entry.trip,role:'owner',canEdit:!entry.deletedAt,canShare:false,revision:entry.revision,...(entry.deletedAt?{deletedAt:entry.deletedAt}:{})});
export function createDemoApi({storage,base='',now=Date.now,uuid=()=>crypto.randomUUID()}={}){
 const key=demoStorageKey(base);base=base.replace(/\/+$/,'');let recovered=false;
 function save(state){
  const clean=cleanState(state),raw=JSON.stringify(clean);
  if(new TextEncoder().encode(raw).length>MAX_BYTES)throw fault('示範資料已超過瀏覽器容量限制。請刪除部分旅行或重設示範。',413);
  try{storage.setItem(key,raw);}catch{throw fault('此瀏覽器無法儲存示範資料。請允許網站儲存空間後重試。',503);}
  return clean;
 }
 function load(){
  let raw;try{raw=storage.getItem(key);}catch{throw fault('此瀏覽器無法讀取示範資料。請允許網站儲存空間後重試。',503);}
  if(raw===null||raw===undefined)return save(createDemoState());
  try{if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_BYTES)throw Error();const state=cleanState(JSON.parse(raw));return hydrateDemoCoordinates(state)?save(state):state;}
  catch{recovered=true;return save(createDemoState());}
 }
 function find(state,id,deleted=false){
  const entry=state.trips.find(item=>item.trip.id===id&&(deleted||!item.deletedAt));
  if(!entry)throw fault('這趟示範旅行已刪除或不存在，請在「我的旅行」選擇。',403);
  return entry;
 }
 function revision(entry,body){if(!Number.isSafeInteger(body.revision)||body.revision<0)throw fault('版本不正確。');if(body.revision!==entry.revision)throw fault('另一個分頁已更新示範行程，請重新載入後再儲存。',409);}
 async function bodyFor(input,options){
  let raw=options.body;
  if(raw===undefined&&input instanceof Request)raw=await input.text();
  if(typeof raw!=='string'||raw.length>MAX_BYTES)throw fault('示範請求格式不正確。');
  let body;try{body=JSON.parse(raw);}catch{throw fault('示範請求格式不正確。');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw fault('示範請求格式不正確。');return body;
 }
 async function fetcher(input,options={}){
  try{
   const url=new URL(input instanceof Request?input.url:String(input),'https://demo.invalid'),path=url.pathname.slice(base.length),method=(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
   if(!url.pathname.startsWith(base+'/api/'))return json({error:'示範模式只能使用瀏覽器內的示範 API。'},404);
   if(options.signal?.aborted)throw options.signal.reason||new DOMException('Aborted','AbortError');
   if(path==='/api/shares')return json({error:'示範模式無法邀請同行者；資料只儲存在此瀏覽器。'},501);
   if(path==='/api/maps-config')return json({embedKey:''});
   if(path==='/api/maps-resolve'){
    const body=await bodyFor(input,options),place=locationFromMapsUrl(parseMapsShare(body.url));
    return place?json(place):json({error:'示範模式不會連線解析短網址。請在行程填入店名或地址，或使用完整 Google Maps 地點網址。'},422);
   }
   // Parse asynchronous Request bodies first, then read the latest local state.
   // Same-tab mutations never yield between that read and their persistence.
   const body=method==='GET'?null:await bodyFor(input,options);
   const state=load(),id=url.searchParams.get('trip')||'';
   if(path==='/api/session'){
    const entry=id?find(state,id):null;
    return json({email:DEMO_EMAIL,role:entry?'owner':null,canEdit:!!entry,canShare:false,...(entry?{trip:entry.trip}:{})});
   }
   if(path==='/api/trips'&&method==='GET')return json({email:DEMO_EMAIL,trips:state.trips.filter(item=>!item.deletedAt).map(record),deletedTrips:[]});
   if(path==='/api/trip'&&method==='GET'){
    const entry=find(state,id);if(url.searchParams.get('revision')===String(entry.revision))return new Response(null,{status:204,headers:{'X-Trip-Role':'owner'}});
    return json(snapshot(entry));
   }
   if(path==='/api/trips'&&method==='POST'){
    const trip=metadata({id:body.creationId||uuid(),...body});
    if(state.deletedTrips.some(marker=>marker.id===trip.id))return json({error:'這趟旅行已永久刪除，請建立新旅行。'},409);
    const existing=state.trips.find(item=>item.trip.id===trip.id);
    if(existing)return existing.deletedAt?json({error:'這趟旅行已刪除，請建立新旅行。'},409):json(snapshot(existing));
    if(state.trips.filter(item=>!item.deletedAt).length>=100||state.trips.length>=200)throw fault('示範最多可保留 100 趟旅行及 200 筆含已刪除的旅行。');
    const entry={trip,days:calendarDays(trip),previous:null,revision:0,deletedAt:null,mutationId:'',creators:{}};
    state.trips.push(entry);save(state);return json(snapshot(entry),201);
   }
   if(path==='/api/trips'&&method==='PATCH'){
    const entry=find(state,body.id),title=text(body.title,120,true),baseTitle=text(body.baseTitle,120,true);
    if(!safeId(body.mutationId)||!Number.isSafeInteger(body.revision)||body.revision<0)throw fault('修改識別碼或版本不正確。');
    if(entry.trip.title===title)return json({ok:true,...snapshot(entry)});
    if(entry.trip.title!==baseTitle||body.revision>entry.revision)return json({error:'另一個分頁已修改名稱，請選擇保留的版本。',trip:entry.trip,revision:entry.revision},409);
    entry.trip.title=title;entry.revision++;save(state);return json({ok:true,...snapshot(entry)});
   }
   if(path==='/api/trips'&&method==='PUT')return json({error:'永久刪除的旅行不能恢復。'},405);
   if(path==='/api/trips'&&method==='DELETE'){
    if(body.permanent!==true||!safeId(body.id)||!Number.isSafeInteger(body.revision)||body.revision<0)throw fault('永久刪除無法復原，請明確確認刪除。');
    const tombstone=state.deletedTrips.find(marker=>marker.id===body.id);
    if(tombstone)return tombstone.revision===body.revision?json({ok:true,id:body.id,deleted:true,permanent:true}):json({error:'刪除版本不正確。'},409);
    const entry=find(state,body.id);revision(entry,body);
    state.trips=state.trips.filter(item=>item.trip.id!==entry.trip.id);state.deletedTrips.push({id:entry.trip.id,revision:entry.revision});save(state);
    return json({ok:true,id:entry.trip.id,deleted:true,permanent:true});
   }
   if(path==='/api/trip'&&method==='PUT'){
    const entry=find(state,id);if(!safeId(body.mutationId))throw fault('修改識別碼不正確。');
    if(Object.hasOwn(body,'deleteStopId')){
     if(body.permanent!==true||!safeId(body.deleteStopId)||!Number.isSafeInteger(body.revision)||body.revision<0)throw fault('永久刪除無法復原，請確認刪除此行程。');
     const stopId=body.deleteStopId;
     if(entry.deletedStops.includes(stopId))return json({...snapshot(entry),deletedStopId:stopId,permanent:true});
     revision(entry,body);if(!entry.days.some(day=>day.stops.some(stop=>stop.id===stopId)))throw fault('此行程已變更或不存在。',409);
     entry.days=clearStaleTravel(withoutDeletedStops(entry.days,[stopId]));
     if(entry.previous)entry.previous=clearStaleTravel(withoutDeletedStops(entry.previous,[stopId]));
     entry.deletedStops.push(stopId);entry.revision++;entry.mutationId=body.mutationId;save(state);
     return json({...snapshot(entry),deletedStopId:stopId,permanent:true});
    }
    if(entry.mutationId===body.mutationId)return json(snapshot(entry));
    revision(entry,body);
    if(body.trip&&(body.trip.id!==id||body.trip.startDate!==entry.trip.startDate||body.trip.endDate!==entry.trip.endDate||body.trip.timezone!==entry.trip.timezone))throw fault('日期變動請使用「管理日期」。');
    const days=cleanDays(body.days,entry.trip);
    const removed=days.flatMap(day=>day.stops.filter(stop=>entry.deletedStops.includes(stop.id)).map(stop=>stop.id));
    if(removed.length)return json({error:'有行程已永久刪除，請重新載入後再編輯。',...snapshot(entry),deletedStopIds:removed},409);
    for(const day of days)for(const stop of day.stops){entry.creators[stop.id]??=DEMO_EMAIL;stop.createdBy=entry.creators[stop.id];}
    entry.previous=entry.days;entry.days=days;entry.revision++;entry.mutationId=body.mutationId;save(state);return json(snapshot(entry));
   }
   if(path==='/api/demo/days'&&method==='PUT'){
    const entry=find(state,id);revision(entry,body);
    const index=body.index;
    if(body.action==='add'){
     if(entry.days.length>=60)throw fault('每趟旅行最多可安排 60 天。');
     entry.trip.endDate=new Date(dateStamp(entry.trip.endDate)+DAY_MS).toISOString().slice(0,10);metadata(entry.trip);
     entry.days.push(calendarDays(entry.trip).at(-1));
    }else{
     if(!Number.isSafeInteger(index)||index<0||index>=entry.days.length)throw fault('日期不正確。');
     if(body.action==='edit')for(const [name,max] of [['title',120],['sub',300],['intro',2000],['tip',2000]])entry.days[index][name]=text(body[name]??'',max,name==='title');
     else if(body.action==='delete'){
      if(entry.days.length===1)throw fault('旅行至少需要保留一天。');
      entry.days.splice(index,1);entry.trip.endDate=new Date(dateStamp(entry.trip.endDate)-DAY_MS).toISOString().slice(0,10);
     }else if(body.action==='move'){
      if(!Number.isSafeInteger(body.to)||body.to<0||body.to>=entry.days.length)throw fault('日期順序不正確。');
      entry.days.splice(body.to,0,...entry.days.splice(index,1));
     }else throw fault('日期操作不正確。');
    }
    entry.days=cleanDays(clearStaleTravel(entry.days),entry.trip);entry.previous=null;entry.revision++;entry.mutationId='';save(state);return json(snapshot(entry));
   }
   return json({error:'不支援此示範操作。'},405);
  }catch(error){if(error.name==='AbortError')throw error;return json({error:error.message||'無法讀取瀏覽器示範資料。'},error.status||400);}
 }
 function reset(){
  const keys=[];try{for(let index=0;index<storage.length;index++){const candidate=storage.key(index);if(demoOwnedStorageKey(candidate,base))keys.push(candidate);}for(const candidate of keys)storage.removeItem(candidate);}catch{throw fault('無法重設示範資料，請允許網站儲存空間後重試。',503);}
  const state=save(createDemoState());recovered=false;return state;
 }
 return {fetch:fetcher,load,reset,storageKey:key,get recovered(){return recovered;}};
}
