import {parseMapsShare} from './maps-link.js';
import {withStopIds} from './identity.js';
export const CACHE_VERSION=1;
export const CACHE_TTL_MS=24*60*60*1000;
export const CACHE_MAX_TRIPS=20;
const MAX_TRIP_BYTES=500000,MAX_CATALOGUE_BYTES=200000,MAX_PLACES_BYTES=250000,MAX_CATALOGUE_ITEMS=200,MAX_PLACES=100;
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const encoder=new TextEncoder(),bytes=value=>encoder.encode(value).byteLength;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const roles=new Set(['owner','editor','viewer']);
const creator=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())?value.trim().toLowerCase():'';
function string(value,max,required=false){if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('Invalid cache text');return value;}
function stamp(value){if(typeof value!=='string'||! /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))throw Error('Invalid cache date');const parsed=new Date(value+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('Invalid cache date');return parsed.getTime();}
function metadata(value){
 if(!object(value)||!safeId(value.id))throw Error('Invalid cache trip');
 const start=stamp(value.startDate),end=stamp(value.endDate),count=(end-start)/86400000+1;if(count<1||count>60||!Number.isInteger(count))throw Error('Invalid cache dates');
 const out={id:value.id,title:string(value.title,120,true),startDate:value.startDate,endDate:value.endDate};
 if(value.timezone!==undefined){string(value.timezone,80,true);new Intl.DateTimeFormat('en',{timeZone:value.timezone});out.timezone=value.timezone;}return out;
}
function revision(value){if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid cache revision');return value;}
function mapsUrl(value){
 const url=new URL(parseMapsShare(string(value,2048,true)));
 if(/\/maps\/embed(?:\/|$)/.test(url.pathname))throw Error('Embed URLs cannot be cached');
 for(const name of url.searchParams.keys())if(/(?:key|token|auth|credential|signature|jwt|secret)/i.test(name))throw Error('Credentials cannot be cached');
 return url.href;
}
function stop(value){
 if(!object(value))throw Error('Invalid cache stop');
 const out={name:string(value.name,120,true),time:string(value.time??'',40),tag:string(value.tag??'行程',30),q:string(value.q??'',300),desc:string(value.desc??'',2000),mode:value.mode??'walking'};
 if(!['walking','transit','driving','bicycling'].includes(out.mode))throw Error('Invalid cache mode');
 if(value.id!==undefined){if(!safeId(value.id))throw Error('Invalid cache stop id');out.id=value.id;}
 for(const name of ['duration','travelMinutes'])if(value[name]!==undefined){if(!Number.isInteger(value[name])||value[name]<0||value[name]>1440)throw Error('Invalid cache duration');out[name]=value[name];}
 if(value.travelMinutes!==undefined)out.travelSignature=string(value.travelSignature,6000,true);
 for(const name of ['from','routeQuery','placeId'])if(value[name]!==undefined)out[name]=string(value[name],300,true);
 if(value.mapUrl)out.mapUrl=mapsUrl(value.mapUrl);
 if(value.live===true)out.live=true;
 const createdBy=creator(value.createdBy);if(createdBy)out.createdBy=createdBy;
 if(['https://wess.jp/milet/','https://wess.jp/yoasobi/'].includes(value.source))out.source=value.source;
 return out;
}
function snapshot(value,id){
 if(!object(value))throw Error('Invalid cache snapshot');const trip=metadata(value.trip);if(trip.id!==id)throw Error('Wrong cached trip');
 const start=stamp(trip.startDate),count=(stamp(trip.endDate)-start)/86400000+1;
 if(!Array.isArray(value.days)||value.days.length!==count)throw Error('Invalid cache days');
 const days=value.days.map((day,index)=>{
  if(!object(day)||!Array.isArray(day.stops)||day.stops.length>100)throw Error('Invalid cache day');
  const date=new Date(start+index*86400000),isoDate=date.toISOString().slice(0,10),label=`${date.getUTCMonth()+1}/${date.getUTCDate()}`;
  if(day.isoDate!==undefined&&day.isoDate!==isoDate)throw Error('Wrong cached day');
  if(day.date!==undefined){if(typeof day.date!=='string'||!/^\d{1,2}\/\d{1,2}$/.test(day.date)||day.date.split('/').map(Number).join('/')!==label)throw Error('Wrong cached date');}
  const out={isoDate,date:label,week:['週日','週一','週二','週三','週四','週五','週六'][date.getUTCDay()],stops:day.stops.map(stop)};
  for(const name of ['color','tint']){const color=day[name]??(name==='color'?'#557c68':'#e9f0e8');if(typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color))throw Error('Invalid cache color');out[name]=color;}
  for(const [name,max] of [['title',120],['sub',300],['intro',2000],['tip',2000]])out[name]=string(day[name]??'',max);
  return out;
 });
 const out={trip,days:withStopIds(days),revision:revision(value.revision)};if(roles.has(value.role))out.role=value.role;return out;
}
function catalogue(value){
 if(!object(value)||!Array.isArray(value.trips)||!Array.isArray(value.deletedTrips??[]))throw Error('Invalid cache catalogue');
 const seen=new Set(),list=(items,deleted)=>items.slice(0,MAX_CATALOGUE_ITEMS).map(item=>{
  const out={...metadata(item),revision:revision(item.revision)};if(seen.has(out.id))throw Error('Duplicate cache trip');seen.add(out.id);
  if(roles.has(item.role))out.role=item.role;
  if(deleted){if(item.role!=='owner'||typeof item.deletedAt!=='string'||item.deletedAt.length>40||!Number.isFinite(Date.parse(item.deletedAt)))throw Error('Invalid archived cache trip');out.deletedAt=item.deletedAt;}
  return out;
 });
 return {trips:list(value.trips,false),deletedTrips:list(value.deletedTrips??[],true)};
}
function places(value){
 let entries;if(value instanceof Map)entries=[...value];else if(Array.isArray(value))entries=value;else if(object(value))entries=Object.entries(value);else throw Error('Invalid cache places');
 const out={};for(const entry of entries.slice(-MAX_PLACES)){
  if(!Array.isArray(entry)||entry.length!==2||!object(entry[1]))throw Error('Invalid cache place');
  out[mapsUrl(entry[0])]={query:string(entry[1].query,1000,true)};
 }return out;
}
function defaultStorage(){try{return globalThis.localStorage;}catch{return null;}}
/** Create only after a live authenticated session supplies its email. Cached roles never authorize actions. */
export function createTravelCache({storage=defaultStorage(),appBase='',email,now=Date.now}={}){
 let accountPrefix='';try{
  if(typeof email!=='string'||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw Error();
  if(typeof appBase!=='string'||appBase.length>200||appBase&&(!appBase.startsWith('/')||appBase.startsWith('//')||/[?#]/.test(appBase)))throw Error();
  const base=appBase.replace(/\/+$/,'')||'/';accountPrefix=`trip-cache-v${CACHE_VERSION}:${encodeURIComponent(base)}:${encodeURIComponent(email.trim().toLowerCase())}:`;
 }catch{}
 let enabled=false;try{enabled=!!accountPrefix&&!!storage&&['getItem','setItem','removeItem'].every(name=>typeof storage[name]==='function');}catch{}
 const key=(kind,id)=>accountPrefix+kind+(id?':'+id:''),ownsKey=value=>!!accountPrefix&&typeof value==='string'&&value.startsWith(accountPrefix);
 const remove=target=>{try{storage.removeItem(target);return true;}catch{return false;}};
 const time=()=>{const value=now();if(!Number.isFinite(value)||value<0)throw Error('Invalid cache clock');return value;};
 function read(kind,id,sanitize,max){
  if(!enabled||id!==undefined&&!safeId(id))return null;
  const target=key(kind,id);let raw;
  try{
   raw=storage.getItem(target);if(raw===null||raw===undefined)return null;
   if(typeof raw!=='string'||bytes(raw)>max)throw Error('Cache too large');
   const stored=JSON.parse(raw),clock=time();if(!object(stored)||stored.version!==CACHE_VERSION||!Number.isFinite(stored.savedAt)||stored.savedAt<0||stored.savedAt>clock+60000||clock-stored.savedAt>=CACHE_TTL_MS)throw Error('Expired cache');
   return sanitize(stored.data,id);
  }catch{if(raw!==null&&raw!==undefined)remove(target);return null;}
 }
 function ids(){
  const found=new Map();
  try{
   const stored=JSON.parse(storage.getItem(key('index'))||'null');if(stored?.version===CACHE_VERSION&&Array.isArray(stored.entries))for(const item of stored.entries.slice(0,1000))if(safeId(item?.id)&&Number.isFinite(item.at)&&(typeof storage.getItem(key('trip',item.id))==='string'||typeof storage.getItem(key('places',item.id))==='string'))found.set(item.id,item.at);
  }catch{}
  try{
   const count=storage.length;if(Number.isInteger(count)&&count>=0)for(let index=0;index<count;index++){
    const owned=storage.key(index);if(!ownsKey(owned))continue;const match=owned.slice(accountPrefix.length).match(/^(?:trip|places):([a-zA-Z0-9_-]{1,80})$/);if(!match)continue;
    let data=null;try{data=JSON.parse(storage.getItem(owned)||'null');}catch{}if(!found.has(match[1]))found.set(match[1],Number.isFinite(data?.savedAt)?data.savedAt:0);
   }
  }catch{}
  return found;
 }
 function save(kind,id,value,sanitize,max){
  if(!enabled||id!==undefined&&!safeId(id))return false;
  try{
   const data=sanitize(value,id),clock=time(),raw=JSON.stringify({version:CACHE_VERSION,savedAt:clock,data});if(bytes(raw)>max)return false;
   if(kind==='trip'){const previous=read('trip',id,snapshot,MAX_TRIP_BYTES);if(previous&&previous.revision>data.revision)return false;}
   storage.setItem(key(kind,id),raw);
   if(id!==undefined){
    const known=ids();known.set(id,clock);const ordered=[...known].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    let evicted=true;while(ordered.length>CACHE_MAX_TRIPS){let index=ordered.length-1;if(ordered[index][0]===id)index--;const [expired]=ordered.splice(index,1),tripRemoved=remove(key('trip',expired[0])),placesRemoved=remove(key('places',expired[0]));if(!tripRemoved||!placesRemoved)evicted=false;}
    try{storage.setItem(key('index'),JSON.stringify({version:CACHE_VERSION,entries:ordered.map(([tripId,at])=>({id:tripId,at}))}));}catch{}
    if(!evicted)return false;
   }
   return true;
  }catch{return false;}
 }
 function deleteTrip(id){
  if(!enabled||!safeId(id))return false;const a=remove(key('trip',id)),b=remove(key('places',id));
  try{const known=ids();known.delete(id);storage.setItem(key('index'),JSON.stringify({version:CACHE_VERSION,entries:[...known].map(([tripId,at])=>({id:tripId,at}))}));}catch{}
  return a&&b;
 }
 function clearAccount(){
  if(!enabled)return false;const keys=new Set([key('catalogue'),key('index')]);for(const id of ids().keys()){keys.add(key('trip',id));keys.add(key('places',id));}
  try{for(let index=0;index<storage.length;index++){const candidate=storage.key(index);if(ownsKey(candidate))keys.add(candidate);}}catch{}
  let okay=true;for(const target of keys)if(!remove(target))okay=false;return okay;
 }
 return Object.freeze({accountPrefix,ownsKey,readTrip:id=>read('trip',id,snapshot,MAX_TRIP_BYTES),writeTrip:(id,value)=>save('trip',id,value,snapshot,MAX_TRIP_BYTES),deleteTrip,
  readCatalogue:()=>read('catalogue',undefined,catalogue,MAX_CATALOGUE_BYTES),writeCatalogue:value=>save('catalogue',undefined,value,catalogue,MAX_CATALOGUE_BYTES),clearCatalogue:()=>enabled&&remove(key('catalogue')),
  readPlaces:id=>read('places',id,places,MAX_PLACES_BYTES),writePlaces:(id,value)=>save('places',id,value,places,MAX_PLACES_BYTES),clearAccount});
}
