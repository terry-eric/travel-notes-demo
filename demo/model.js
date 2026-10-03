import {parseMapsShare} from '../public/maps-link.js';
import {withStopIds} from '../public/identity.js';

export const DEMO_VERSION=1;
export const DEMO_EMAIL='demo-local@example.invalid';
export const DEMO_CREATORS=[DEMO_EMAIL,'demo-a@example.invalid','demo-b@example.invalid'];
export const DAY_MS=86400000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
export function text(value,max,required=false){
 if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('請確認欄位內容與長度。');
 return value.trim();
}
export function dateStamp(value){
 if(typeof value!=='string'||! /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))throw Error('請選擇有效日期。');
 const stamp=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)throw Error('請選擇有效日期。');
 return stamp;
}
export function metadata(value){
 if(!object(value)||!safeId(value.id))throw Error('旅行識別碼不正確。');
 const start=dateStamp(value.startDate),end=dateStamp(value.endDate),count=(end-start)/DAY_MS+1;
 if(!Number.isInteger(count)||count<1||count>60)throw Error('每趟旅行可安排 1–60 天。');
 const timezone=text(value.timezone??'Asia/Taipei',80,true);
 try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('旅行時區不正確。');}
 return {id:value.id,title:text(value.title,120,true),startDate:value.startDate,endDate:value.endDate,timezone};
}
const colours=[['#557c68','#e9f0e8'],['#a67b28','#f7efdb'],['#786190','#eee8f5']];
export function calendarDays(trip){
 const start=dateStamp(trip.startDate),count=(dateStamp(trip.endDate)-start)/DAY_MS+1;
 return Array.from({length:count},(_,index)=>{
  const date=new Date(start+index*DAY_MS),[color,tint]=colours[index%colours.length];
  return {isoDate:date.toISOString().slice(0,10),date:`${date.getUTCMonth()+1}/${date.getUTCDate()}`,week:['週日','週一','週二','週三','週四','週五','週六'][date.getUTCDay()],color,tint,title:`第 ${index+1} 天`,sub:'自由安排的一天',intro:'',tip:'預留交通與休息時間。',stops:[]};
 });
}
function cleanStop(value){
 if(!object(value)||!safeId(value.id))throw Error('行程識別碼不正確。');
 const out={id:value.id,name:text(value.name,120,true),time:text(value.time??'',40),tag:text(value.tag??'行程',30),q:text(value.q??'',300),desc:text(value.desc??'',2000),mode:value.mode??'walking'};
 if(!['walking','transit','driving','bicycling'].includes(out.mode))throw Error('交通方式不正確。');
 for(const name of ['duration','travelMinutes'])if(value[name]!==undefined){
  if(!Number.isInteger(value[name])||value[name]<0||value[name]>1440)throw Error('時間需介於 0 與 1440 分鐘。');
  out[name]=value[name];
 }
 if(value.travelMinutes!==undefined)out.travelSignature=text(value.travelSignature,6000,true);
 if(value.live===true)out.live=true;
 for(const name of ['from','routeQuery','placeId'])if(value[name])out[name]=text(value[name],300,true);
 if(value.mapUrl){
  const url=new URL(parseMapsShare(text(value.mapUrl,2048,true)));
  if(/\/maps\/embed(?:\/|$)/.test(url.pathname)||[...url.searchParams.keys()].some(name=>/(?:key|token|auth|credential|signature|jwt|secret)/i.test(name)))throw Error('請使用不含金鑰的 Google Maps 分享連結。');
  out.mapUrl=url.href;
 }
 if(DEMO_CREATORS.includes(value.createdBy))out.createdBy=value.createdBy;
 return out;
}
export function cleanDays(input,trip){
 const calendar=calendarDays(metadata(trip));
 if(!Array.isArray(input)||input.length!==calendar.length)throw Error('日期數量必須符合旅行日期。');
 return withStopIds(input.map((day,index)=>{
  if(!object(day)||!Array.isArray(day.stops)||day.stops.length>100)throw Error('每天最多可安排 100 個行程。');
  const out={...calendar[index],stops:day.stops.map(cleanStop)};
  for(const [name,max] of [['title',120],['sub',300],['intro',2000],['tip',2000]])if(day[name]!==undefined)out[name]=text(day[name],max);
  for(const name of ['color','tint'])if(day[name]!==undefined){if(typeof day[name]!=='string'||!/^#[a-f0-9]{6}$/i.test(day[name]))throw Error('日期顏色不正確。');out[name]=day[name];}
  return out;
 }));
}
export function cleanState(value){
 if(!object(value)||value.version!==DEMO_VERSION||!Array.isArray(value.trips)||value.trips.length>200)throw Error('示範資料版本或格式不正確。');
 const seen=new Set();
 return {version:DEMO_VERSION,trips:value.trips.map(entry=>{
  if(!object(entry))throw Error('旅行資料不正確。');
  const trip=metadata(entry.trip);if(seen.has(trip.id))throw Error('旅行識別碼重複。');seen.add(trip.id);
  if(!Number.isSafeInteger(entry.revision)||entry.revision<0)throw Error('旅行版本不正確。');
  const days=cleanDays(entry.days,trip),previous=entry.previous===null||entry.previous===undefined?null:cleanDays(entry.previous,trip);
  const creators=Object.create(null);
  if(object(entry.creators))for(const [id,email] of Object.entries(entry.creators))if(safeId(id)&&DEMO_CREATORS.includes(email))creators[id]=email;
  for(const set of [days,previous])for(const day of set||[])for(const stop of day.stops)if(stop.createdBy)creators[stop.id]=stop.createdBy;
  if(Object.keys(creators).length>20000)throw Error('此示範旅行資料過多，請重設示範。');
  const deletedAt=entry.deletedAt??null;
  if(deletedAt!==null&&(typeof deletedAt!=='string'||deletedAt.length>40||!Number.isFinite(Date.parse(deletedAt))))throw Error('已刪除旅行格式不正確。');
  return {trip,days,previous,revision:entry.revision,deletedAt,mutationId:safeId(entry.mutationId)?entry.mutationId:'',creators};
 })};
}
