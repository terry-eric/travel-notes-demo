import {parseMapsShare} from '../public/maps-link.js';
import {withStopIds} from '../public/identity.js';
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
   return out;
  });
  return {...calendar[i],stops};
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
 const normalize=payload=>withStopIds(JSON.parse(payload).map((day,i)=>({...calendar[i],stops:day.stops.map(readableStop)})));
 const days=normalize(row.payload),previous=role==='viewer'||!row.previous?null:normalize(row.previous);
 const ledger=await creatorLedger(db,row.id,[days,previous]);
 return {trip,role,days:attributeStops(days,row,null,ledger),previous:previous&&attributeStops(previous,row,null,ledger),revision:row.revision};
}
const unavailable=()=>apiReply({error:'暫時無法連上雲端，修改內容仍保留在畫面中，請稍後重試。'},503);
const denied=()=>apiReply({error:'你沒有權限查看這個行程，或邀請已撤銷。'},403);
async function changeTripArchive(request,env,email,body){
 let id;try{
  id=text(body.id,80,true);if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('行程識別碼不正確。');
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('版本不正確。');
  if(request.method==='PUT'&&body.action!=='restore')throw Error('不支援此操作。');
 }catch(error){return apiReply({error:error.message},400);}
 const row=await env.DB.prepare('SELECT id,owner_email,title,start_date,end_date,timezone,revision,deleted_at FROM itineraries WHERE id=? AND owner_email=?').bind(id,email).first();
 if(!row)return apiReply({error:'只有行程擁有者可以刪除或恢復這個行程。'},403);
 const deleting=request.method==='DELETE',done=deleted=>apiReply({ok:true,id,deleted});
 if(deleting&&row.deleted_at!==null)return done(true);
 if(!deleting&&row.deleted_at===null)return done(false);
 if(row.revision!==body.revision)return apiReply({error:'行程已在其他裝置更新，請更新行程列表後重試。'},409);
 if(!deleting){try{dateRange(row.start_date,row.end_date);cleanTimezone(row.timezone);}catch{return apiReply({error:'行程日期或時區資料不正確，無法恢復。'},400);}}
 const now=new Date().toISOString();
 const result=deleting?
  await env.DB.prepare("UPDATE itineraries SET deleted_at=?,updated_at=?,revision=revision+1,mutation_id='' WHERE id=? AND owner_email=? AND revision=? AND deleted_at IS NULL").bind(now,now,id,email,body.revision).run():
  await env.DB.prepare("UPDATE itineraries SET deleted_at=NULL,updated_at=?,revision=revision+1,mutation_id='' WHERE id=? AND owner_email=? AND revision=? AND deleted_at IS NOT NULL AND (SELECT COUNT(*) FROM itineraries WHERE owner_email=? AND deleted_at IS NULL)<100").bind(now,id,email,body.revision,email).run();
 if(result.meta.changes)return done(deleting);
 const latest=await env.DB.prepare('SELECT revision,deleted_at FROM itineraries WHERE id=? AND owner_email=?').bind(id,email).first();
 if(latest&&(deleting?latest.deleted_at!==null:latest.deleted_at===null))return done(deleting);
 if(!latest||latest.revision!==body.revision)return apiReply({error:'行程已在其他裝置更新，請更新行程列表後重試。'},409);
 return apiReply({error:'最多可保留 100 個進行中的行程，請先刪除其他行程再恢復。'},400);
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
   const archived=await env.DB.prepare('SELECT id,title,start_date,end_date,timezone,revision,deleted_at FROM itineraries WHERE owner_email=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id').bind(email).all();
   return apiReply({email,trips:results.map(row=>({...tripMetadata(row),role:row.access_role,canEdit:['owner','editor'].includes(row.access_role),canShare:row.access_role==='owner',revision:row.revision})),deletedTrips:archived.results.map(row=>({...tripMetadata(row),role:'owner',canEdit:false,canShare:false,revision:row.revision,deletedAt:row.deleted_at}))});
  }
  if(request.headers.get('X-Trip-Client')!==API_CLIENT)return apiReply({error:'網站已更新，請重新整理一次再儲存。'},428);
  const parsed=await mutationBody(request,4096);if(parsed.error)return parsed.error;const body=parsed.body;
  if(request.method==='PATCH')return await renameTrip(env,email,body);
  if(request.method==='DELETE'||request.method==='PUT')return await changeTripArchive(request,env,email,body);
  let trip;try{
   const title=cleanTitle(body.title);dateRange(body.startDate,body.endDate);
   if(body.creationId!==undefined&&!(typeof body.creationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.creationId)))throw Error('建立行程識別碼不正確。');
   trip={id:body.creationId?.toLowerCase()||crypto.randomUUID(),title,startDate:body.startDate,endDate:body.endDate,timezone:cleanTimezone(body.timezone)};
  }catch(e){return apiReply({error:e.message},400);}
  const retry=await env.DB.prepare('SELECT * FROM itineraries WHERE id=?').bind(trip.id).first();
  if(retry)return retry.owner_email===email?(retry.deleted_at!==null?apiReply({error:'這個行程已刪除，請從已刪除行程中恢復。'},409):apiReply(await rowData(env.DB,retry,'owner'))):apiReply({error:'無法建立這個行程，請重試。'},409);
  const days=calendarDays(trip),now=new Date().toISOString();
  // The subquery cap is in the insertion itself, so concurrent requests cannot bypass it.
  const result=await env.DB.prepare('INSERT INTO itineraries (id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) SELECT ?,?,?,?,?,?,?,NULL,0,\'\',?,? WHERE (SELECT COUNT(*) FROM itineraries WHERE owner_email=? AND deleted_at IS NULL)<100 ON CONFLICT(id) DO NOTHING').bind(trip.id,email,trip.title,trip.startDate,trip.endDate,trip.timezone,JSON.stringify(days),now,now,email).run();
  if(!result.meta.changes){const created=await env.DB.prepare('SELECT * FROM itineraries WHERE id=? AND owner_email=?').bind(trip.id,email).first();if(created)return created.deleted_at!==null?apiReply({error:'這個行程已刪除，請從已刪除行程中恢復。'},409):apiReply(await rowData(env.DB,created,'owner'));return apiReply({error:'無法建立行程，每個帳號最多可建立 100 個進行中的行程。'},400);}
  return apiReply({trip,days,revision:0,previous:null},201);
 }catch(error){console.error('Trip catalogue unavailable',error.message);return unavailable();}
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
  try{
   if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('版本不正確。');text(body.mutationId,80,true);
   if(body.trip!==undefined&&(!body.trip||typeof body.trip!=='object'||Array.isArray(body.trip)))throw Error('行程資料格式不正確。');
   if(body.trip?.id!==undefined&&body.trip.id!==id)throw Error('行程識別碼不正確。');
   if(body.trip?.startDate!==undefined&&body.trip.startDate!==row.start_date||body.trip?.endDate!==undefined&&body.trip.endDate!==row.end_date||body.trip?.timezone!==undefined&&body.trip.timezone!==row.timezone)throw Error('請建立新行程來使用不同日期或時區。');
   title=body.trip?.title!==undefined?cleanTitle(body.trip.title):body.title!==undefined?cleanTitle(body.title):row.title;
   clean=withStopIds(validateDays(body.days,tripMetadata(row)));
  }catch(e){return apiReply({error:e.message},400);}
  if(row.mutation_id===body.mutationId)return apiReply(await rowData(env.DB,row,role));
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
