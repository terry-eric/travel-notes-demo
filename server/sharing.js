import {LEGACY_TRIP_ID,LEGACY_OWNER,API_CLIENT,apiReply,authenticatedEmail,ensureLegacy,tripAccess,requestedTrip,mutationBody,cleanEmail} from './trips.js';
export {cleanEmail};
export async function memberRole(db,email,owner=LEGACY_OWNER,tripId=LEGACY_TRIP_ID){
 await ensureLegacy(db,owner);return (await tripAccess(db,cleanEmail(email),tripId))?.role??null;
}
export const sessionInfo=(email,role)=>({email,role,canEdit:role==='owner'||role==='editor',canShare:role==='owner'});
export async function handleSharing(request,env){
 const email=authenticatedEmail(request);if(!email)return apiReply({error:'請重新登入網站後再試。'},401);
 try{
  await ensureLegacy(env.DB,env.OWNER_EMAIL||LEGACY_OWNER);
  const id=requestedTrip(request),access=await tripAccess(env.DB,email,id);
  if(access?.role!=='owner')return apiReply({error:'只有行程擁有者可以管理邀請名單。'},403);
  if(request.method==='GET'){
   const {results}=await env.DB.prepare('SELECT email,role,enabled FROM itinerary_members WHERE trip_id=? ORDER BY enabled DESC,email LIMIT 201').bind(id).all();
   return apiReply({owner:access.row.owner_email,members:results});
  }
  if(request.method!=='PUT')return apiReply({error:'不支援此操作。'},405);
  if(request.headers.get('X-Trip-Client')!==API_CLIENT)return apiReply({error:'網站已更新，請重新整理一次再儲存。'},428);
  const parsed=await mutationBody(request,4096);if(parsed.error)return parsed.error;
  const body=parsed.body;let target;
  try{
   target=cleanEmail(body.email);
   if(!['viewer','editor'].includes(body.role)||typeof body.enabled!=='boolean')throw Error('請選擇有效的權限。');
   if(target===access.row.owner_email)throw Error('你的擁有者權限無法移除或變更。');
  }catch(e){return apiReply({error:e.message},400);}
  const result=await env.DB.prepare('INSERT INTO itinerary_members (trip_id,email,role,enabled,updated_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM itineraries WHERE id=? AND owner_email=? AND deleted_at IS NULL) AND ((SELECT COUNT(*) FROM itinerary_members WHERE trip_id=?)<200 OR EXISTS (SELECT 1 FROM itinerary_members WHERE trip_id=? AND email=?)) ON CONFLICT(trip_id,email) DO UPDATE SET role=excluded.role,enabled=excluded.enabled,updated_at=excluded.updated_at').bind(id,target,body.role,body.enabled?1:0,new Date().toISOString(),id,email,id,id,target).run();
  if(!result.meta.changes&&!(await tripAccess(env.DB,email,id)))return apiReply({error:'這個行程已刪除或你沒有權限。'},403);
  if(!result.meta.changes)return apiReply({error:'邀請名單已達 200 個帳號。'},400);
  return apiReply({saved:true});
 }catch{return apiReply({error:'暫時無法讀取分享設定，請稍後重試。'},503);}
}
