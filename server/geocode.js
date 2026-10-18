import {authenticatedEmail,tripAccess,mutationBody,apiReply} from './trips.js';
import {resolveMapsShare} from './maps-resolve.js';
import {parseMapsShare} from '../public/maps-link.js';
import {getStopCoordinates,normalizeCoordinates} from '../public/map-coordinates.js';
import {getLocationQuery,knownStopPoint} from '../public/auto-geolocation.js';

const DAY=86400000,MAX_RESPONSE=65536,DEFAULT_PROVIDER='https://photon.komoot.io/api/';
const OSM_ATTRIBUTION='© OpenStreetMap contributors · Photon';
const text=value=>typeof value==='string'?value.slice(0,300).trim():'';
const normalized=value=>text(value).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');

export function safeGeocodeQuery(value){
 if(typeof value!=='string'||!value.trim()||value.length>300||/[\u0000-\u001f\u007f]/.test(value))return null;
 const query=value.trim();
 // Only the saved location text is sent, never account identity or stop notes.
 if(/(?:https?:\/\/|www\.)|[^\s@]+@[^\s@]+\.[^\s@]+|(?:booking|reservation|pnr|訂位|预订|預訂|護照|护照|passport|信用卡|credit\s*card)/i.test(query))return null;
 if(/(?:\+?\d[\s()-]*){10,}/.test(query))return null;
 return query;
}

export function geocodeProvider(env={}){
 const value=env.GEOCODE_URL??DEFAULT_PROVIDER;
 if(env.GEOCODE_ENABLED==='false'||value===''||/^(?:disabled|off|false)$/i.test(value))return null;
 let url;try{url=new URL(value);}catch{throw Error('Invalid geocode provider');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!host.includes('.')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.includes(':')||/^(?:localhost|metadata\.google\.internal)$|\.(?:localhost|local|internal|test|invalid)$/i.test(host))throw Error('Invalid geocode provider');
 return url;
}

function regionValues(properties){
 const values=['city','district','county','state','country','postcode'].map(key=>text(properties[key])).filter(Boolean);
 if(properties.countrycode==='JP')values.push('日本','Japan');
 if(properties.countrycode==='TW')values.push('台灣','臺灣','Taiwan');
 return values;
}
function hasRegion(query,properties){
 // A country by itself is too broad to disambiguate a branch or common name.
 return ['city','district','county','state','postcode'].map(key=>text(properties[key])).filter(Boolean).some(value=>{
  const norm=normalized(value),short=norm.replace(/(?:都|道|府|県|縣|县|市|区|區)$/u,'');
  return norm.length>=2&&query.includes(norm)||short.length>=2&&query.includes(short);
 });
}
function exactStreetAddress(query,street,house){
 const name=normalized(street),number=normalized(house);if(!name||!number)return false;
 const pair=name+number,reversed=number+name;
 const escaped=number.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return (query.includes(pair)||query.includes(reversed))&&new RegExp('(?:^|[^0-9])'+escaped+'(?![0-9])').test(query);
}
function exactPlaceName(query,properties){
 const name=normalized(properties.name);if(name.length<2||!query.includes(name))return false;
 let remaining=query.replace(name,'');
 const addressParts=[...regionValues(properties),text(properties.street),text(properties.housenumber)].flatMap(value=>[normalized(value),normalized(value).replace(/(?:都|道|府|県|縣|县|市|区|區)$/u,'')]).filter(value=>value.length>=2).sort((a,b)=>b.length-a.length);
 // Remove known address context only. An unexplained branch/building name must
 // not match a shorter POI name just because it is a substring of the query.
 for(const part of addressParts)remaining=remaining.replaceAll(part,'');
 return remaining==='';
}

export function photonCandidates(data,query){
 if(!data||!Array.isArray(data.features))throw Error('Invalid geocode response');
 const q=normalized(query),candidates=[],seen=new Set();
 for(const feature of data.features.slice(0,20)){
  const p=feature?.properties,geometry=feature?.geometry;if(!p||geometry?.type!=='Point'||!Array.isArray(geometry.coordinates))continue;
  const coordinates=normalizeCoordinates({lng:geometry.coordinates[0],lat:geometry.coordinates[1]});if(!coordinates)continue;
  const area=p.osm_key==='boundary'||p.osm_key==='place'||['country','state','county','city','district','locality','municipality'].includes(p.type);
  const name=text(p.name),street=text(p.street),house=text(p.housenumber);
  const address=[house,street,text(p.district),text(p.city),text(p.state),text(p.postcode),text(p.country)].filter(Boolean).join(' ');
  const label=name||[street,house].filter(Boolean).join(' ')||address;
  if(!label)continue;
  const exactName=exactPlaceName(q,p);
  const exactAddress=exactStreetAddress(q,street,house);
  const confidence=!area&&hasRegion(q,p)&&(exactName||exactAddress);
  const key=coordinates.lat.toFixed(6)+','+coordinates.lng.toFixed(6)+'|'+normalized(label);
  if(seen.has(key))continue;seen.add(key);
  candidates.push({label,address,coordinates,kind:area?'area':exactAddress?'address':'place',confidence,source:'photon'});
 }
 const matches=candidates.filter(candidate=>candidate.confidence);
 // Candidate confidence is kept internal; the UI receives escaped plain data.
 const safe=candidates.slice(0,5).map(({confidence,...candidate})=>candidate);
 if(matches.length===1){const {confidence,...candidate}=matches[0];return {status:'resolved',coordinates:candidate.coordinates,label:candidate.label,source:'photon',attribution:OSM_ATTRIBUTION};}
 return {status:candidates.length?'ambiguous':'not_found',candidates:safe,source:'photon',attribution:OSM_ATTRIBUTION};
}

async function queryHash(value){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function reserveGeocodeRequest(db,now){
 // One SQL statement makes both the global spacing and daily limit atomic.
 return !!await db.prepare(`INSERT INTO place_geocode_rate (id,day,requests,next_request_at) VALUES (1,?,1,?)
 ON CONFLICT(id) DO UPDATE SET day=excluded.day,
 requests=CASE WHEN place_geocode_rate.day=excluded.day THEN place_geocode_rate.requests+1 ELSE 1 END,
 next_request_at=excluded.next_request_at
 WHERE place_geocode_rate.next_request_at<=? AND (place_geocode_rate.day<>excluded.day OR place_geocode_rate.requests<200)
 RETURNING requests`).bind(Math.floor(now/DAY),now+1500,now).first();
}

async function withDeadline(task,milliseconds=6000){
 const controller=new AbortController();let timer;
 try{return await Promise.race([task(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Geocode timeout'));},milliseconds);})]);}
 finally{clearTimeout(timer);}
}
async function readProvider(response){
 if(!response.ok||response.status>=300||!/^application\/(?:json|geo\+json)(?:\s*;|$)/i.test(response.headers.get('Content-Type')||''))throw Error('Geocode unavailable');
 if(Number(response.headers.get('Content-Length'))>MAX_RESPONSE)throw Error('Geocode response too large');
 const reader=response.body?.getReader();if(!reader)throw Error('Empty geocode response');
 let bytes=0,raw='';const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE){await reader.cancel();throw Error('Geocode response too large');}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();return JSON.parse(raw);
}

export async function handleGeocode(request,env,{fetcher=fetch,now=Date.now()}={}){
 const email=authenticatedEmail(request);if(!email)return apiReply({error:'請登入後確認地點。'},401);
 if(request.method!=='POST')return apiReply({error:'不支援此操作。'},405);
 const parsed=await mutationBody(request,4096);if(parsed.error)return parsed.error;
 const body=parsed.body;
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(body.trip||'')||typeof body.id!=='string'||!body.id||body.id.length>120||Object.keys(body).some(key=>!['trip','id','query'].includes(key)))return apiReply({error:'請選擇行程中的地點。'},400);
 try{
  const access=await tripAccess(env.DB,email,body.trip);if(!access)return apiReply({error:'你沒有權限查看這個行程。'},403);
  const days=JSON.parse(access.row.payload),stops=Array.isArray(days)?days.flatMap(day=>Array.isArray(day.stops)?day.stops:[]):[];
  const matches=stops.filter(stop=>stop?.id===body.id);if(matches.length!==1)return apiReply({error:'找不到唯一的行程地點，請重新整理。'},matches.length?409:404);
  const stop=matches[0],query=getLocationQuery(stop),reply=value=>apiReply({id:stop.id,...value});
  if(body.query!==undefined&&body.query!==query)return apiReply({error:'地點已變更，請重新整理後再查詢。'},409);
  const point=getStopCoordinates(stop),known=point||knownStopPoint(stop,stops);
  if(known)return reply({status:'resolved',coordinates:known,source:point?'saved':'itinerary',attribution:''});
  let share='';try{if(stop.mapUrl)share=parseMapsShare(stop.mapUrl);}catch{}
  if(!query&&!share)return reply({status:'missing_query',source:'',attribution:''});
  const provider=geocodeProvider(env);
  if(!provider)return reply({status:'disabled',source:'',attribution:''});
  const safeQuery=safeGeocodeQuery(query);
  // Short Maps links can still be resolved without exposing the stop's notes.
  if(query&&!safeQuery&&!share)return reply({status:'unsafe_query',source:'',attribution:''});
  const hash=await queryHash(JSON.stringify(['place-v1',provider.href,query,share]));
  const cached=await env.DB.prepare('SELECT result,expires_at FROM place_geocode_cache WHERE query_hash=?').bind(hash).first();
  if(cached&&cached.expires_at>now){try{return reply({...JSON.parse(cached.result),cacheHit:true});}catch{}}
  if(!await reserveGeocodeRequest(env.DB,now)){
   const rate=await env.DB.prepare('SELECT day,requests,next_request_at FROM place_geocode_rate WHERE id=1').bind().first();
   const daily=rate?.day===Math.floor(now/DAY)&&rate.requests>=200;
   return reply({status:'limited',source:'',attribution:'',reason:daily?'daily_limit':'rate_limit',retryAfter:daily?Math.ceil((DAY-now%DAY)/1000):Math.max(2,Math.ceil(((rate?.next_request_at||now)-now)/1000))});
  }
  let result;
  try{
   result=await withDeadline(async signal=>{
    const boundedFetcher=(url,options={})=>{if(signal.aborted)throw Error('Geocode timeout');return fetcher(url,{...options,redirect:'manual',signal});};
    let lookup=safeQuery;
    if(share){
     try{
      const location=await resolveMapsShare(share,boundedFetcher),coordinates=getStopCoordinates({q:location.query});
      if(coordinates)return {status:'resolved',coordinates,label:location.label,source:'google-maps',attribution:'Google Maps'};
      if(!lookup)lookup=safeGeocodeQuery(location.query);
     }catch{}
    }
    if(!lookup)return {status:'unsafe_query',source:'',attribution:''};
    const url=new URL(provider);url.searchParams.set('q',lookup);url.searchParams.set('limit','10');
    const response=await boundedFetcher(url.href,{method:'GET',headers:{Accept:'application/json','User-Agent':'TripPlanner/2 (geocoding; cached; max 200 queries/day)'}});
    return photonCandidates(await readProvider(response),lookup);
   });
  }catch{return reply({status:'unavailable',source:'',attribution:''});}
  const ttl=result.status==='resolved'?30*DAY:DAY;
  await env.DB.batch([
   env.DB.prepare('DELETE FROM place_geocode_cache WHERE expires_at<=?').bind(now),
   env.DB.prepare('INSERT INTO place_geocode_cache (query_hash,result,expires_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(query_hash) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at,updated_at=excluded.updated_at').bind(hash,JSON.stringify(result),now+ttl,now)
  ]);
  return reply({...result,cacheHit:false});
 }catch{return apiReply({error:'暫時無法確認地點，請稍後重試。',status:'unavailable'},503);}
}
