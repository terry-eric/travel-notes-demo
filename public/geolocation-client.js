import {applyGeocodeOverlay,geocodeStopKey,getLocationQuery,knownStopPoint} from './auto-geolocation.js';
import {normalizeCoordinates} from './map-coordinates.js';
import {parseMapsShare} from './maps-link.js';

const DAY=86400000,STATES=new Set(['resolved','ambiguous','not_found','missing_query','unsafe_query','disabled','limited','unavailable']);
const SOURCES=new Set(['saved','itinerary','google-maps','photon']);
const finalCacheStates=new Set(['resolved','ambiguous','not_found']);
const lookupText=stop=>getLocationQuery(stop);
function usableLink(stop){try{return parseMapsShare(stop?.mapUrl||'');}catch{return '';}}
function safeResult(value){
 if(!value||!STATES.has(value.status))return {status:'unavailable'};
 const result={status:value.status};
 if(value.status==='limited'&&value.reason==='daily_limit')result.reason='daily_limit';
 if(SOURCES.has(value.source))result.source=value.source;
 if(value.status==='resolved'){
  const coordinates=normalizeCoordinates(value.coordinates);if(!coordinates)return {status:'unavailable'};
  result.coordinates=coordinates;
 }
 if(value.status==='ambiguous'&&Array.isArray(value.candidates))result.candidates=value.candidates.slice(0,5).flatMap(candidate=>{
  const coordinates=normalizeCoordinates(candidate?.coordinates);if(!coordinates)return [];
  return [{coordinates,label:String(candidate.label||'').slice(0,300),address:String(candidate.address||'').slice(0,500),kind:['area','address','place'].includes(candidate.kind)?candidate.kind:'place'}];
 });
 return result;
}

export function geolocationStatusText(value){
 const status=typeof value==='string'?value:value?.status;
 if(status==='limited'&&value?.reason==='daily_limit')return '今日定位額度已用完，請先在 Google Maps 確認';
 return ({pending:'正在定位…',resolved:'已定位',ambiguous:'有多個地點，請確認',not_found:'找不到地點，請補上完整地址或分享連結',missing_query:'請補上地點或分享連結',unsafe_query:'請只填地點名稱或地址',disabled:'請貼上完整地點連結或座標',limited:'定位請求較多，請稍後確認',unavailable:'暫時無法定位，仍可查看 Google Maps'})[status]||'尚未定位';
}

/**
 * An account-scoped display overlay, never an itinerary mutation. Scan only on
 * an opened page/save, not on a timer. Identical lookups share one queued job.
 */
export function createGeolocationClient({getScope,getDays,lookup,onChange=()=>{},storage=null,appBase='',now=Date.now,schedule=setTimeout,cancel=clearTimeout,spacing=1600}={}){
 let scopeKey='',storageKey='',generation=0,results=new Map(),attempted=new Set(),groups=new Map(),queue=[],active=null,timer=null,nextStart=0,limitedUntil=0;
 const rows=()=>getDays()?.flatMap(day=>day.stops||[])||[];
 const scope=()=>getScope?.()||{};
 const keyOf=value=>value.email&&value.tripId?JSON.stringify([String(value.email).trim().toLowerCase(),String(value.tripId),value.epoch??0]):'';
 const current=job=>job.generation===generation&&job.scopeKey===keyOf(scope())&&scope().enabled!==false;
 function reset({forget=false}={}){
  generation++;if(timer!==null)cancel(timer);timer=null;active?.controller.abort();active=null;
  if(forget&&storageKey)try{storage?.removeItem(storageKey);}catch{}
  scopeKey=storageKey='';results=new Map();attempted=new Set();groups=new Map();queue=[];nextStart=0;limitedUntil=0;
 }
 function restore(){
  try{
   const raw=storage?.getItem(storageKey);if(!raw)return;
   if(raw.length>300000)throw Error('Oversized location cache');
   const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>1000)throw Error('Invalid location cache');
   const valid=new Set(rows().map(stop=>geocodeStopKey(scope().tripId,stop)));
   for(const entry of data.entries){
    if(!Array.isArray(entry)||entry.length!==3||!valid.has(entry[0])||!Number.isFinite(entry[2])||entry[2]<=now()||entry[2]>now()+30*DAY+60000)continue;
    const result=safeResult(entry[1]);if(finalCacheStates.has(result.status))results.set(entry[0],{...result,expiresAt:entry[2]});
   }
  }catch{try{storage?.removeItem(storageKey);}catch{}}
 }
 function bind(){
  const value=scope(),key=keyOf(value);
  if(!key||value.enabled===false){if(scopeKey)reset();return false;}
  if(key!==scopeKey){
   reset();scopeKey=key;storageKey='trip-geocode-v1:'+encodeURIComponent(appBase||'/')+':'+encodeURIComponent(String(value.email).trim().toLowerCase())+':'+encodeURIComponent(value.tripId);restore();
  }
  return true;
 }
 function persist(){
  if(!storageKey)return;
  const valid=new Set(rows().map(stop=>geocodeStopKey(scope().tripId,stop)));
  const entries=[...results].filter(([key,result])=>valid.has(key)&&finalCacheStates.has(result.status)&&result.expiresAt>now()).slice(-1000).map(([key,result])=>[key,safeResult(result),result.expiresAt]);
  try{storage?.setItem(storageKey,JSON.stringify({version:1,entries}));}catch{}
 }
 function members(job){
  const stops=rows();return [...job.keys].filter(key=>stops.some(stop=>geocodeStopKey(scope().tripId,stop)===key));
 }
 function finishGroup(job){if(groups.get(job.groupKey)===job)groups.delete(job.groupKey);}
 function publish(job,result){
  if(!current(job))return;
  const keys=members(job),value=safeResult(result);
  const expiresAt=finalCacheStates.has(value.status)?now()+(value.status==='resolved'?30*DAY:DAY):0;
  for(const key of keys)results.set(key,{...value,expiresAt});
  persist();if(keys.length)onChange();
 }
 function pump(){
  if(active||timer!==null||!queue.length)return;
  const delay=Math.max(0,nextStart-now());
  if(delay){timer=schedule(()=>{timer=null;pump();},delay);return;}
  const job=queue.shift();if(!current(job)||!members(job).length){finishGroup(job);pump();return;}
  const controller=new AbortController();active={...job,controller};nextStart=now()+Math.max(1500,spacing);
  const timeout=schedule(()=>controller.abort(),12000);
  Promise.resolve().then(()=>lookup({trip:job.tripId,id:job.id,...(job.query?{query:job.query}:{})},controller.signal)).then(reply=>{
   if(!current(job))return;
   const result=reply?.result??reply,retryAfter=Number(reply?.retryAfter??result?.retryAfter);
   if(result?.status==='limited'&&result.reason==='daily_limit'){
    limitedUntil=now()+Math.max(1500,Number.isFinite(retryAfter)?retryAfter*1000:DAY);
    publish(job,result);finishGroup(job);
    for(const waiting of queue){publish(waiting,result);finishGroup(waiting);}queue=[];return;
   }
   if(result?.status==='limited'&&job.retries<2&&Number.isFinite(retryAfter)&&retryAfter>=0&&retryAfter<=10){
    job.retries++;nextStart=Math.max(nextStart,now()+Math.max(1500,retryAfter*1000));queue.push(job);return;
   }
   publish(job,result);finishGroup(job);
  }).catch(()=>{publish(job,{status:'unavailable'});finishGroup(job);}).finally(()=>{
   cancel(timeout);if(active?.controller===controller){active=null;pump();}
  });
 }
 function scan(){
  if(!bind())return;
  const clock=now(),quotaRecovered=limitedUntil>0&&limitedUntil<=clock;
  for(const [key,result] of results){
   if(finalCacheStates.has(result.status)&&result.expiresAt<=clock||quotaRecovered&&result.status==='limited'&&result.reason==='daily_limit'){
    results.delete(key);attempted.delete(key);
   }
  }
  if(quotaRecovered)limitedUntil=0;
  const value=scope(),all=rows(),effective=applyGeocodeOverlay(getDays(),results,value.tripId).flatMap(day=>day.stops||[]);
  const valid=new Set(all.map(stop=>geocodeStopKey(value.tripId,stop)));
  for(const key of results.keys())if(!valid.has(key))results.delete(key);
  let changed=false;
  for(const stop of all){
   if(!stop.id)continue;
   const key=geocodeStopKey(value.tripId,stop),point=knownStopPoint(stop,effective);
   if(point){if(!results.has(key)){results.set(key,{status:'resolved',coordinates:point,source:'itinerary',expiresAt:now()+30*DAY});changed=true;}continue;}
   if(results.has(key)||attempted.has(key))continue;
   const query=lookupText(stop),url=usableLink(stop);
   if(!query&&!url){results.set(key,{status:'missing_query'});changed=true;continue;}
   if(value.canLookup===false){results.set(key,{status:'disabled'});changed=true;continue;}
   if(limitedUntil>now()){results.set(key,{status:'limited',reason:'daily_limit'});attempted.add(key);changed=true;continue;}
   const groupKey=JSON.stringify([query,url]);attempted.add(key);results.set(key,{status:'pending'});changed=true;
   if(groups.has(groupKey)){groups.get(groupKey).keys.add(key);continue;}
   const job={generation,scopeKey,tripId:value.tripId,id:stop.id,query,groupKey,keys:new Set([key]),retries:0};groups.set(groupKey,job);queue.push(job);
  }
  if(changed){persist();onChange();}pump();
 }
 return {
  scan,reset,
  status(stop){if(!bind())return null;return results.get(geocodeStopKey(scope().tripId,stop))||null;},
  overlay(){if(!bind())return structuredClone(getDays()||[]);return applyGeocodeOverlay(getDays(),results,scope().tripId);},
 };
}
