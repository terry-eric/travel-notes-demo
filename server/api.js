import {parseMapsShare} from '../public/maps-link.js';
import {withStopIds} from '../public/identity.js';
import {normalizeCoordinates} from '../public/map-coordinates.js';
import {sanitizeFlight,flightTripSchedule} from '../public/flights.js';
import {validateDayName} from '../public/day-names.js';
import {API_CLIENT,LEGACY_TRIP_ID,LEGACY_OWNER,apiReply,authenticatedEmail,ensureLegacy,tripAccess,requestedTrip,tripMetadata,calendarDays,dateRange,cleanTitle,cleanTimezone,cleanEmail,mutationBody} from './trips.js';
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('請確認欄位內容與長度。');return v.trim();};
export function validateDays(input,trip={id:LEGACY_TRIP_ID,startDate:'2026-11-11',endDate:'2026-11-15'}){
 const calendar=calendarDays(trip);
 if(!Array.isArray(input)||input.length!==calendar.length)throw Error('行程日期數量必須符合此行程的開始與結束日期。');
 return input.map((day,i)=>{
  if(!day||!Array.isArray(day.stops)||day.stops.length>100)throw Error('每天最多可安排 100 個項目。');
  const stops=day.stops.map(s=>{
   if(!s||typeof s!=='object')throw Error('行程格式不正確。');
   const out={name:text(s.name,120,true),time:text(s.time??'',40),tag:text(s.tag??'行程',30),q:text(s.q??'',300),desc:text(s.desc??'',2000),mode:s.mode??'walking'};
   out.id=s.id===undefined?crypto.randomUUID():text(s.id,80,true);
   if(!['walking','transit','driving','bicycling'].includes(out.mode))throw Error('請選擇有效的交通方式。');
   if(s.duration!==undefined&&s.duration!==null&&s.duration!==''){if(!Number.isInteger(s.duration)||s.duration<0||s.duration>1440)throw Error('停留時間需介於 0 與 1440 分鐘。');out.duration=s.duration;}
   if(s.travelMinutes!==undefined){if(!Number.isInteger(s.travelMinutes)||s.travelMinutes<0||s.travelMinutes>1440)throw Error('交通時間需介於 0 與 1440 分鐘。');out.travelMinutes=s.travelMinutes;out.travelSignature=text(s.travelSignature,6000,true);}
   if(s.live===true)out.live=true;
   if(s.source!==undefined){const src=text(s.source,300);if(!['https://wess.jp/milet/','https://wess.jp/yoasobi/'].includes(src))throw Error('演唱會來源不正確。');out.source=src;}
   if(s.from)out.from=text(s.from,300);
   if(s.routeQuery)out.routeQuery=text(s.routeQuery,300,true);
   if(s.placeId)out.placeId=text(s.placeId,300,true);
   if(s.mapUrl)out.mapUrl=parseMapsShare(text(s.mapUrl,2048,true));
   if(s.coordinates!==undefined){const point=normalizeCoordinates(s.coordinates);if(!point)throw Error('請填寫有效的景點座標。');out.coordinates=point;}
   if(s.kind!==undefined&&!['place','flight'].includes(s.kind))throw Error('行程類型不正確。');
   if(s.kind==='flight'){
    out.kind='flight';out.flight=sanitizeFlight(s.flight);const schedule=flightTripSchedule(out.flight,trip.timezone||'Asia/Taipei');
    if(schedule.date!==calendar[i].isoDate)throw Error('航班出發時間換算後不在此行程日期，請調整安排日期。');
    out.time=schedule.time;out.duration=schedule.duration;out.live=true;out.q=out.flight.departureAirport;out.routeQuery=out.q;
   }
   return out;
  });
  return {...calendar[i],title:validateDayName(day.title,i),stops};
 });
}
function storedCreator(value){try{return cleanEmail(value);}catch{return null;}}
function readableStop(value){
 const {createdBy,...stop}=value,creator=storedCreator(createdBy);
 return creator?{...stop,createdBy:creator}:stop;
}
function attributeStops(days,row,email,ledger){
 const known=new Set(),creators=new Map();
 // Ledger tombstones are authoritative, including NULL for known legacy IDs.
 // A deleted stop remains known after it leaves both undo snapshots.
 for(const entry of ledger){
  if(typeof entry.stop_id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(entry.stop_id))continue;
  known.add(entry.stop_id);creators.set(entry.stop_id,storedCreator(entry.created_by));
 }
 // Both snapshots are from this same authoritative revision. The current
 // creator wins; undo can recover a removed ID from the previous snapshot.
 for(const payload of [row.payload,row.previous])if(payload){
  for(const day of withStopIds(JSON.parse(payload)))for(const stop of day.stops){
   known.add(stop.id);const creator=storedCreator(stop.createdBy);
   if(creator&&!creators.has(stop.id))creators.set(stop.id,creator);
  }
 }
 return days.map(day=>({...day,stops:day.stops.map(stop=>{
  const {createdBy,...cleanStop}=stop;
  const creator=creators.get(stop.id)||(!known.has(stop.id)?email:null);
  return creator?{...cleanStop,createdBy:creator}:cleanStop;
 })}));
}
async function creatorLedger(db,id,daySets){
 const ids=[...new Set(daySets.filter(Boolean).flatMap(days=>days.flatMap(day=>day.stops.map(stop=>stop.id))))];
 if(!ids.length)return [];
 // Query only this snapshot's IDs, not every tombstone from the trip's history.
 const {results}=await db.prepare('SELECT stop_id,created_by FROM stop_creators WHERE trip_id=? AND stop_id IN (SELECT value FROM json_each(?))').bind(id,JSON.stringify(ids)).all();
 return results;
}
async function rowData(db,row,role){
 const trip=tripMetadata(row),calendar=calendarDays(trip);
 const normalize=payload=>withStopIds(JSON.parse(payload).map((day,i)=>({...calendar[i],title:validateDayName(day.title,i),stops:day.stops.map(readableStop)})));
 const days=normalize(row.payload),previous=role==='viewer'||!row.previous?null:normalize(row.previous);
 const ledger=await creatorLedger(db,row.id,[days,previous]);
 return {trip,role,days:attributeStops(days,row,null,ledger),previous:previous&&attributeStops(previous,row,null,ledger),revision:row.revision};
}
const unavailable=()=>apiReply({error:'暫時無法連上雲端，修改內容仍保留在畫面中，請稍後重試。'},503);
const denied=()=>apiReply({error:'你沒有權限查看這個行程，或邀請已撤銷。'},403);
async function permanentlyDeleteTrip(env,email,body){
 let id;try{
  id=text(body.id,80,true);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('行程識別碼不正確。');
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('版本不正確。');
  if(body.permanent!==true)throw Error('永久刪除無法復原，請重新整理網站並確認刪除。');
 }catch(error){return apiReply({error:error.message},400);}
 const done=()=>apiReply({ok:true,id,deleted:true,permanent:true});
 const tombstone=()=>env.DB.prepare('SELECT owner_email,revision FROM deleted_itineraries WHERE id=?').bind(id).first();
 const prior=await tombstone();
 if(prior)return prior.owner_email===email&&prior.revision===body.revision?done():apiReply({error:'只有旅行擁有者能確認這次永久刪除。'},403);
 const row=await env.DB.prepare('SELECT id,revision FROM itineraries WHERE id=? AND owner_email=? AND deleted_at IS NULL').bind(id,email).first();
 if(!row)return apiReply({error:'只有旅行擁有者可以永久刪除這個旅行。'},403);
 if(row.revision!==body.revision)return apiReply({error:'行程已在其他裝置更新，請更新行程列表後重試。'},409);
 const result=await env.DB.prepare('DELETE FROM itineraries WHERE id=? AND owner_email=? AND revision=? AND deleted_at IS NULL').bind(id,email,body.revision).run();
 if(result.meta.changes)return done();
 const latest=await tombstone();
 if(latest?.owner_email===email&&latest.revision===body.revision)return done();
 return apiReply({error:'行程已在其他裝置更新，請更新行程列表後重試。'},409);
}
async function renameTrip(env,email,body){
 let id,title,baseTitle;try{
  id=text(body.id,80,true);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('行程識別碼不正確。');
  title=cleanTitle(body.title);baseTitle=cleanTitle(body.baseTitle);
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('版本不正確。');
  const mutationId=text(body.mutationId,80,true);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(mutationId))throw Error('修改識別碼不正確。');
 }catch(error){return apiReply({error:error.message},400);}
 const done=access=>apiReply({ok:true,trip:tripMetadata(access.row),revision:access.row.revision,role:access.role});
 const conflict=(access,message='旅行名稱已被其他人更改，請選擇保留雲端名稱或使用你的名稱。')=>apiReply({error:message,trip:tripMetadata(access.row),revision:access.row.revision},409);
 let access=await tripAccess(env.DB,email,id);
 for(let attempt=0;attempt<3;attempt++){
  if(!access||access.role==='viewer')return apiReply({error:'你目前無法更改這趟旅行的名稱。'},403);
  const row=access.row;
  if(body.revision>row.revision)return conflict(access);
  if(row.title===title)return done(access);
  if(row.title!==baseTitle)return conflict(access);
  // Keep the content mutation identifier intact: a lost-reply days save must
  // remain idempotent after a rename, preserving its existing undo snapshot.
  // Equal current titles make rename retries idempotent without another write.
  const result=await env.DB.prepare("UPDATE itineraries SET title=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND title=? AND deleted_at IS NULL AND (owner_email=? OR EXISTS (SELECT 1 FROM itinerary_members WHERE trip_id=itineraries.id AND email=? AND role='editor' AND enabled=1))").bind(title,new Date().toISOString(),id,row.revision,row.title,email,email).run();
  access=await tripAccess(env.DB,email,id);
  if(!access||access.role==='viewer')return apiReply({error:'你目前無法更改這趟旅行的名稱。'},403);
  if(access.row.title===title)return done(access);
  if(result.meta.changes||access.row.title!==baseTitle)return conflict(access);
 }
 return conflict(access,'行程正在其他裝置更新，請重試更名。');
}
export async function handleTrips(request,env){
 const email=authenticatedEmail(request);if(!email)return apiReply({error:'請重新登入網站後再試。'},401);
 if(!['GET','POST','DELETE','PUT','PATCH'].includes(request.method))return apiReply({error:'不支援此操作。'},405);
 try{
  await ensureLegacy(env.DB,env.OWNER_EMAIL||LEGACY_OWNER);
  if(request.method==='GET'){
   const {results}=await env.DB.prepare("SELECT i.id,i.owner_email,i.title,i.start_date,i.end_date,i.timezone,i.revision,CASE WHEN i.owner_email=? THEN 'owner' ELSE m.role END AS access_role FROM itineraries i LEFT JOIN itinerary_members m ON m.trip_id=i.id AND m.email=? AND m.enabled=1 WHERE i.deleted_at IS NULL AND (i.owner_email=? OR m.role IN ('viewer','editor')) ORDER BY i.updated_at DESC,i.id").bind(email,email,email).all();
   return apiReply({email,trips:results.map(row=>({...tripMetadata(row),role:row.access_role,canEdit:['owner','editor'].includes(row.access_role),canShare:row.access_role==='owner',revision:row.revision})),deletedTrips:[]});
  }
  if(request.headers.get('X-Trip-Client')!==API_CLIENT)return apiReply({error:'網站已更新，請重新整理一次再儲存。'},428);
  const parsed=await mutationBody(request,4096);if(parsed.error)return parsed.error;const body=parsed.body;
  if(request.method==='PATCH')return await renameTrip(env,email,body);
  if(request.method==='DELETE')return await permanentlyDeleteTrip(env,email,body);
  if(request.method==='PUT')return apiReply({error:'已刪除的旅行不提供恢復功能。'},405);
  let trip;try{
   const title=cleanTitle(body.title);dateRange(body.startDate,body.endDate);
   if(body.creationId!==undefined&&!(typeof body.creationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.creationId)))throw Error('建立行程識別碼不正確。');
   trip={id:body.creationId?.toLowerCase()||crypto.randomUUID(),title,startDate:body.startDate,endDate:body.endDate,timezone:cleanTimezone(body.timezone)};
  }catch(e){return apiReply({error:e.message},400);}
  const deleted=()=>env.DB.prepare('SELECT id FROM deleted_itineraries WHERE id=?').bind(trip.id).first();
  if(await deleted())return apiReply({error:'這個旅行已永久刪除，請建立新的旅行。'},409);
  const retry=await env.DB.prepare('SELECT * FROM itineraries WHERE id=?').bind(trip.id).first();
  if(retry)return retry.owner_email===email?(retry.deleted_at!==null?apiReply({error:'這個旅行已刪除，請建立新的旅行。'},409):apiReply(await rowData(env.DB,retry,'owner'))):apiReply({error:'無法建立這個行程，請重試。'},409);
  const days=calendarDays(trip),now=new Date().toISOString();
  // Old archived rows remain untouched and hidden. New deletions free a slot.
  // Keep the active cap in the insertion so concurrent creates cannot bypass it.
  const result=await env.DB.prepare('INSERT INTO itineraries (id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) SELECT ?,?,?,?,?,?,?,NULL,0,\'\',?,? WHERE (SELECT COUNT(*) FROM itineraries WHERE owner_email=? AND deleted_at IS NULL)<100 AND NOT EXISTS (SELECT 1 FROM deleted_itineraries WHERE id=?) ON CONFLICT(id) DO NOTHING').bind(trip.id,email,trip.title,trip.startDate,trip.endDate,trip.timezone,JSON.stringify(days),now,now,email,trip.id).run();
  if(!result.meta.changes){if(await deleted())return apiReply({error:'這個旅行已永久刪除，請建立新的旅行。'},409);const created=await env.DB.prepare('SELECT * FROM itineraries WHERE id=? AND owner_email=?').bind(trip.id,email).first();if(created)return created.deleted_at!==null?apiReply({error:'這個旅行已刪除，請建立新的旅行。'},409):apiReply(await rowData(env.DB,created,'owner'));return apiReply({error:'每個帳號最多可保留 100 個旅行，請先刪除不再需要的旅行。'},400);}
  return apiReply({trip,days,revision:0,previous:null},201);
 }catch(error){console.error('Trip catalogue unavailable',error.message);return unavailable();}
}
async function permanentlyDeleteStop(env,email,id,access,body){
 let stopId;
 try{
  stopId=text(body.deleteStopId,80,true);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(stopId))throw Error('行程識別碼不正確。');
  if(body.permanent!==true)throw Error('永久刪除無法復原，請確認刪除此行程。');
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('版本不正確。');text(body.mutationId,80,true);
 }catch(error){return apiReply({error:error.message},400);}
 const {row,role}=access;
 // A lost reply can be retried after other edits without restoring the stop.
 if(await env.DB.prepare('SELECT stop_id FROM deleted_stops WHERE trip_id=? AND stop_id=?').bind(id,stopId).first())return apiReply({...await rowData(env.DB,row,role),deletedStopId:stopId,permanent:true});
 if(row.revision!==body.revision)return apiReply({error:'另一個分頁已更新行程。請載入最新版本後再刪除。'},409);
 const original=withStopIds(JSON.parse(row.payload));
 if(!original.some(day=>day.stops.some(stop=>stop.id===stopId)))return apiReply({error:'此行程已不在最新版本，請重新載入。'},409);
 const remove=days=>days.map(day=>({...day,stops:day.stops.filter(stop=>stop.id!==stopId)}));
 const payload=JSON.stringify(remove(original)),previous=row.previous?JSON.stringify(remove(withStopIds(JSON.parse(row.previous)))):null;
 // D1 batch is atomic. Its first two statements use the same version and live editor
 // permission, so failed CAS/revocation cannot leave a deletion tombstone.
 const guard="id=? AND revision=? AND deleted_at IS NULL AND (owner_email=? OR EXISTS (SELECT 1 FROM itinerary_members WHERE trip_id=itineraries.id AND email=? AND role='editor' AND enabled=1))";
 const results=await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO deleted_stops (trip_id,stop_id) SELECT id,? FROM itineraries WHERE '+guard).bind(stopId,id,body.revision,email,email),
  env.DB.prepare('UPDATE itineraries SET payload=?,previous=?,revision=revision+1,mutation_id=?,updated_at=? WHERE '+guard).bind(payload,previous,body.mutationId,new Date().toISOString(),id,body.revision,email,email),
  // changes() describes the immediately preceding UPDATE, not its attribution
  // triggers. A failed CAS must not erase an existing stop's creator, even if
  // a concurrent writer happens to reuse the same mutation identifier.
  env.DB.prepare("DELETE FROM stop_creators WHERE trip_id=? AND stop_id=? AND changes()>0 AND EXISTS (SELECT 1 FROM itineraries WHERE id=? AND revision=? AND mutation_id=? AND deleted_at IS NULL AND (owner_email=? OR EXISTS (SELECT 1 FROM itinerary_members WHERE trip_id=itineraries.id AND email=? AND role='editor' AND enabled=1)))").bind(id,stopId,id,body.revision+1,body.mutationId,email,email)
 ]);
 const latest=await tripAccess(env.DB,email,id);if(!latest)return denied();
 if(latest.role==='viewer')return apiReply({error:'你目前只能查看行程，無法刪除。'},403);
 if(!results[1].meta.changes)return apiReply({error:'行程已在其他分頁變更，請重新載入。'},409);
 return apiReply({...await rowData(env.DB,latest.row,latest.role),deletedStopId:stopId,permanent:true});
}
export async function handleApi(request,env){
 const email=authenticatedEmail(request);if(!email)return apiReply({error:'請重新登入網站後再試。'},401);
 if(!['GET','PUT'].includes(request.method))return apiReply({error:'不支援此操作。'},405);
 try{
  await ensureLegacy(env.DB,env.OWNER_EMAIL||LEGACY_OWNER);
  const id=requestedTrip(request),access=await tripAccess(env.DB,email,id);if(!access)return denied();
  const {row,role}=access;
  if(request.method==='GET'){
   const known=new URL(request.url).searchParams.get('revision');
   if(known!==null&&/^\d+$/.test(known)&&Number.isSafeInteger(Number(known))&&row.revision===Number(known))return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store','X-Trip-Role':role}});
   return apiReply(await rowData(env.DB,row,role));
  }
  if(role==='viewer')return apiReply({error:'你目前只能查看行程，無法儲存修改。'},403);
  if(request.headers.get('X-Trip-Client')!==API_CLIENT)return apiReply({error:'網站已更新，請重新整理一次再儲存。'},428);
  const parsed=await mutationBody(request);if(parsed.error)return parsed.error;
  const body=parsed.body;let clean,title;
  if(Object.hasOwn(body,'deleteStopId'))return await permanentlyDeleteStop(env,email,id,access,body);
  try{
   if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('版本不正確。');text(body.mutationId,80,true);
   if(body.trip!==undefined&&(!body.trip||typeof body.trip!=='object'||Array.isArray(body.trip)))throw Error('行程資料格式不正確。');
   if(body.trip?.id!==undefined&&body.trip.id!==id)throw Error('行程識別碼不正確。');
   if(body.trip?.startDate!==undefined&&body.trip.startDate!==row.start_date||body.trip?.endDate!==undefined&&body.trip.endDate!==row.end_date||body.trip?.timezone!==undefined&&body.trip.timezone!==row.timezone)throw Error('請建立新行程來使用不同日期或時區。');
   title=body.trip?.title!==undefined?cleanTitle(body.trip.title):body.title!==undefined?cleanTitle(body.title):row.title;
   clean=withStopIds(validateDays(body.days,tripMetadata(row)));
  }catch(e){return apiReply({error:e.message},400);}
  if(row.mutation_id===body.mutationId)return apiReply(await rowData(env.DB,row,role));
  const stopIds=clean.flatMap(day=>day.stops.map(stop=>stop.id));
  const removed=await env.DB.prepare('SELECT stop_id FROM deleted_stops WHERE trip_id=? AND stop_id IN (SELECT value FROM json_each(?))').bind(id,JSON.stringify(stopIds)).all();
  if(removed.results.length)return apiReply({error:'部分行程已永久刪除，請重新載入最新內容，無法透過復原或舊草稿恢復。',code:'PERMANENT_STOP_DELETED',deletedStopIds:removed.results.map(record=>record.stop_id)},409);
  if(row.revision!==body.revision)return apiReply({error:'另一個分頁已更新行程。請載入最新版本後再儲存。'},409);
  // Storage failures stay in the outer 503 handler, separate from input errors.
  const ledger=await creatorLedger(env.DB,id,[clean]);clean=attributeStops(clean,row,email,ledger);
  const result=await env.DB.prepare("UPDATE itineraries SET title=?,payload=?,previous=payload,revision=revision+1,mutation_id=?,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL AND (owner_email=? OR EXISTS (SELECT 1 FROM itinerary_members WHERE trip_id=itineraries.id AND email=? AND role='editor' AND enabled=1))").bind(title,JSON.stringify(clean),body.mutationId,new Date().toISOString(),id,body.revision,email,email).run();
  const latest=await tripAccess(env.DB,email,id);if(!latest)return denied();
  if(!result.meta.changes&&latest.role==='viewer')return apiReply({error:'你目前只能查看行程，無法儲存修改。'},403);
  if(!result.meta.changes&&latest.row.mutation_id!==body.mutationId)return apiReply({error:'行程已在其他分頁變更，請重新載入。'},409);
  return apiReply(await rowData(env.DB,latest.row,latest.role));
 }catch(error){console.error('Trip storage unavailable',error.message);return unavailable();}
}
