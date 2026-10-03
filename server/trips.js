import {seedDays} from '../public/seed.js';
export const LEGACY_TRIP_ID='legacy-hokkaido-2026';
export const LEGACY_OWNER='owner@example.com';
export const API_CLIENT='multi-1';
export const apiReply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function cleanEmail(value){
 if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw Error('請填寫有效的 email。');
 return value.trim().toLowerCase();
}
export function cleanTitle(value){if(typeof value!=='string'||!value.trim()||value.length>120)throw Error('行程名稱需介於 1 與 120 個字。');return value.trim();}
const validDate=value=>{
 if(typeof value!=='string'||! /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))throw Error('請填寫有效的日期。');
 const parsed=new Date(value+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('請填寫有效的日期。');return parsed;
};
export function dateRange(startDate,endDate){
 const start=validDate(startDate),end=validDate(endDate),count=(end-start)/86400000+1;
 if(!Number.isInteger(count)||count<1||count>60)throw Error('每個行程可安排 1 至 60 天，結束日期不能早於開始日期。');
 return Array.from({length:count},(_,i)=>new Date(start.getTime()+i*86400000));
}
export function cleanTimezone(value='Asia/Taipei'){
 if(typeof value!=='string'||value.length>80)throw Error('請選擇有效的時區。');
 try{new Intl.DateTimeFormat('en',{timeZone:value});}catch{throw Error('請選擇有效的時區。');}return value;
}
export function tripMetadata(row){return {id:row.id,title:row.title,startDate:row.start_date??row.startDate,endDate:row.end_date??row.endDate,timezone:row.timezone||'Asia/Taipei'};}
export function calendarDays(trip){
 const dates=dateRange(trip.startDate,trip.endDate),palette=[['#557c68','#e9f0e8'],['#a66b4f','#f5ebe4'],['#617b98','#eaf0f6'],['#9a7599','#f3edf3']];
 return dates.map((date,i)=>{
  const [color,tint]=palette[i%palette.length],isoDate=date.toISOString().slice(0,10);
  const legacy=trip.id===LEGACY_TRIP_ID?seedDays[i]:null;
  return {...(legacy||{color,tint,title:`第 ${i+1} 天`,sub:'',intro:'',tip:''}),isoDate,date:`${date.getUTCMonth()+1}/${date.getUTCDate()}`,week:['週日','週一','週二','週三','週四','週五','週六'][date.getUTCDay()],stops:[]};
 });
}
export async function ensureLegacy(db,owner=LEGACY_OWNER){
 if(await db.prepare("SELECT name FROM app_migrations WHERE name='legacy-members-v1'").bind().first())return;
 owner=cleanEmail(owner);const now=new Date().toISOString();
 const statements=[
  db.prepare("INSERT OR IGNORE INTO itineraries (id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) SELECT ?,?,'台灣城市漫遊（虛構範例）','2026-11-11','2026-11-15','Asia/Tokyo',payload,previous,revision,mutation_id,updated_at,updated_at FROM trips WHERE lower(user_id)=? ORDER BY updated_at DESC LIMIT 1").bind(LEGACY_TRIP_ID,owner,owner),
  db.prepare("INSERT OR IGNORE INTO itineraries (id,owner_email,title,start_date,end_date,timezone,payload,previous,revision,mutation_id,created_at,updated_at) VALUES (?,?,'台灣城市漫遊（虛構範例）','2026-11-11','2026-11-15','Asia/Taipei',?,NULL,0,'',?,?)").bind(LEGACY_TRIP_ID,owner,JSON.stringify(seedDays),now,now),
  db.prepare("INSERT OR IGNORE INTO itinerary_members (trip_id,email,role,enabled,updated_at) SELECT ?,lower(email),role,enabled,updated_at FROM trip_members WHERE role IN ('viewer','editor') AND NOT EXISTS (SELECT 1 FROM app_migrations WHERE name='legacy-members-v1')").bind(LEGACY_TRIP_ID),
  db.prepare("INSERT OR IGNORE INTO app_migrations (name) VALUES ('legacy-members-v1')").bind()
 ];
 await db.batch(statements);
}
export async function tripAccess(db,email,id){
 const row=await db.prepare('SELECT i.*,m.role AS member_role FROM itineraries i LEFT JOIN itinerary_members m ON m.trip_id=i.id AND m.email=? AND m.enabled=1 WHERE i.id=? AND i.deleted_at IS NULL').bind(email,id).first();
 const role=row?.owner_email===email?'owner':(['viewer','editor'].includes(row?.member_role)?row.member_role:null);
 return role?{row,role,session:{email,role,canEdit:role==='owner'||role==='editor',canShare:role==='owner',logoutUrl:'/cdn-cgi/access/logout',trip:tripMetadata(row)}}:null;
}
export function requestedTrip(request){
 const value=new URL(request.url).searchParams.get('trip');
 if(value===null)return LEGACY_TRIP_ID;
 return /^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:null;
}
export async function mutationBody(request,maxBytes=1000000){
 if(request.headers.get('Origin')!==new URL(request.url).origin)return {error:apiReply({error:'請從本站儲存行程。'},403)};
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return {error:apiReply({error:'資料格式不正確。'},415)};
 if(Number(request.headers.get('Content-Length'))>maxBytes)return {error:apiReply({error:'內容過長。'},413)};
 const reader=request.body?.getReader();if(!reader)return {error:apiReply({error:'請填寫資料。'},400)};
 let size=0,raw='';const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();return {error:apiReply({error:'內容過長。'},413)};}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();try{const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return {body};}catch{return {error:apiReply({error:'資料格式不正確。'},400)};}
}
export function authenticatedEmail(request){try{return cleanEmail(request.headers.get('oai-authenticated-user-id'));}catch{return null;}}
export async function sessionFor(request,env){
 const email=authenticatedEmail(request);if(!email)return apiReply({error:'請重新登入網站後再試。'},401);
 if(request.method!=='GET')return apiReply({error:'不支援此操作。'},405);
 try{
  await ensureLegacy(env.DB,env.OWNER_EMAIL||LEGACY_OWNER);
  if(!new URL(request.url).searchParams.has('trip'))return apiReply({email,role:'personal',canEdit:false,canShare:false,logoutUrl:'/cdn-cgi/access/logout',trip:null});
  const access=await tripAccess(env.DB,email,requestedTrip(request));
  return access?apiReply(access.session):apiReply({error:'你沒有權限查看這個行程，或邀請已撤銷。'},403);
 }catch{return apiReply({error:'暫時無法確認登入，請稍後重試。'},503);}
}
