import {parseMapsShare} from './maps-link.js';
import {clockMinutes} from './transport.js';

export const gptImportFormat='trip-gpt-v1';
const modes=['walking','transit','driving','bicycling'];
function validIsoDate(value){
 if(typeof value!=='string'||! /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
export function importDate(day){
 if(day?.isoDate!==undefined){
  if(!validIsoDate(day.isoDate))throw Error('行程日期不完整，請重新載入旅行後再匯入。');
  return day.isoDate;
 }
 // Earlier Hokkaido drafts and seed fixtures stored only a month/day.
 const legacy=typeof day?.date==='string'&&/^\d{1,2}\/\d{1,2}$/.test(day.date)?`2026-${day.date.split('/').map(part=>part.padStart(2,'0')).join('-')}`:'';
 if(!validIsoDate(legacy))throw Error('行程日期不完整，請重新載入旅行後再匯入。');
 return legacy;
}
export function buildGptPrompt(days,trip={}){
 if(!Array.isArray(days)||!days.length)throw Error('請先選擇一趟旅行，再產生 AI 行程提示詞。');
 const dates=days.map(importDate),existing=days.map(day=>({date:importDate(day),stops:day.stops.map(stop=>({name:stop.name,time:stop.time,place:stop.routeQuery||stop.q||'',...(Number.isInteger(stop.duration)?{durationMinutes:stop.duration}:{}),fixed:stop.live===true}))}));
 const title=trip.title||'我的旅行',timezone=trip.timezone||'旅行目的地的當地時區（請先向我確認）',destination=trip.destination||trip.region||'請依我的需求確認目的地，不要自行假設國家或城市';
 const example={format:gptImportFormat,stops:[{date:dates[0],time:'10:00',name:'行程名稱',place:'完整地點名稱、城市與國家',durationMinutes:60,tag:'景點',mode:'walking',fixed:false,notes:'行程內容與提醒'}]};
 return `請幫我規劃「${title}」，產生可直接匯入「旅手帖」的行程 JSON。\n旅行目的地：${destination}。\n旅行時區：${timezone}。\n\n我的需求：\n（在此填入目的地、想去的地方、餐廳、每天開始時間及其他偏好）\n\n可安排日期：${dates.join('、')}。所有行程時間以旅行時區為準。\n請依實際地點安排合理動線，預留交通與休息時間；若目的地、日期或預約資訊不明確，先向我確認。\n\n目前已安排的行程如下，請避免重複新增，並保留 fixed 為 true 的原定時間，預留預約或入場的緩衝。這次只輸出要新增的項目；網站匯入會加入現有行程。\n${JSON.stringify(existing,null,2)}\n\n輸出規則：\n1. 只輸出一個 JSON 物件，可放在一個 json 程式碼區塊中，不加其他說明。\n2. format 必須是 "${gptImportFormat}"，stops 為 1–100 筆項目的陣列，依日期與時間排列。\n3. date 必須是上述日期之一，使用 YYYY-MM-DD；time 使用 24 小時制 HH:MM。\n4. name 是顯示名稱，最多 120 字；place 是 Google Maps 可搜尋的具體地點或地址，含城市／國家，最多 300 字。不要只填「咖啡」或「午餐」。\n5. durationMinutes 是 0–1440 的整數，優先以 15 分鐘為單位；不確定時填 null。\n6. tag 是分類標籤（例如景點、用餐、咖啡、購物、住宿、預約），最多 30 字。\n7. mode 是從上一站前往此站的交通方式，只能填 walking、transit、driving、bicycling。\n8. fixed 是可省略的布林值 true 或 false；只有已確認的預約、航班或活動才填 true，一般安排填 false。\n9. notes 是行程說明，最多 2000 字。\n10. 不產生交通分鐘數，不編造 Google 地點 ID、營業資訊或分享短網址。地點不確定時先向我確認；網站會用 place 建立 Google Maps 搜尋連結，匯入前由我確認。\n\n格式範例（請用實際規劃內容取代範例值）：\n${JSON.stringify(example,null,2)}`;
}
function field(value,key,max,required=false){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error(`${key}${required?'為必填，且':''}最多 ${max} 字，請確認內容。`);
 return value.trim();
}
export function parseGptImport(text,days){
 if(typeof text!=='string'||text.length>80000)throw Error('AI 行程內容過長，請分批匯入。');
 let source=text.trim();const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);if(fence)source=fence[1].trim();
 let document;
 try{document=JSON.parse(source);}catch{throw Error('無法讀取 JSON。請複製 AI 產生的完整 JSON，包含最外層的大括號，不要加入其他文字。');}
 if(!document||document.format!==gptImportFormat||!Array.isArray(document.stops))throw Error('格式不符，請使用本站的提示詞產生 trip-gpt-v1 行程。');
 if(!document.stops.length||document.stops.length>100)throw Error('一次需匯入 1–100 筆行程。');
 const dates=new Map(days.map((day,index)=>[importDate(day),index]));
 return document.stops.map((entry,index)=>{
  try{
   if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('項目需為 JSON 物件。');
   if(!dates.has(entry.date))throw Error('日期需在 '+[...dates.keys()].join('、')+' 之內。');
   if(typeof entry.time!=='string'||!/^\d{2}:\d{2}$/.test(entry.time)||clockMinutes(entry.time)===null)throw Error('時間需使用 00:00–23:59 的 HH:MM 格式。');
   const name=field(entry.name,'行程名稱',120,true),q=field(entry.place,'地點／地址',300,true);
   const mode=entry.mode??'walking';if(!modes.includes(mode))throw Error('交通方式需為 walking、transit、driving 或 bicycling。');
   let mapUrl;
   if(entry.mapUrl!==undefined){mapUrl=parseMapsShare(field(entry.mapUrl,'Google Maps 連結',2048,true));if(!mapUrl)throw Error('請使用有效的 Google Maps 連結。');}
   else{mapUrl='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q);if(mapUrl.length>2048)throw Error('地點文字過長，請縮短為完整地點名稱與城市。');}
   const row={name,q,mapUrl,day:dates.get(entry.date),time:entry.time,tag:field(entry.tag??'其他','標籤',30)||'其他',desc:field(entry.notes??'','備註',2000),mode};
   if(entry.fixed!==undefined&&typeof entry.fixed!=='boolean')throw Error('fixed 需為 true 或 false 的布林值。');
   if(entry.fixed===true)row.live=true;
   if(entry.durationMinutes!==undefined&&entry.durationMinutes!==null){
    if(!Number.isInteger(entry.durationMinutes)||entry.durationMinutes<0||entry.durationMinutes>1440)throw Error('停留時間需為 0–1440 的整數分鐘，未設定時填 null。');
    row.duration=entry.durationMinutes;
   }
   return row;
  }catch(error){throw Error(`第 ${index+1} 筆：${error.message}`);}
 });
}
