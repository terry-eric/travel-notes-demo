import {flightInstant} from './flights.js';
import {routeLocation} from './transport.js';

const MINUTE=60_000;
const normalized=value=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';
const clock=value=>{
 const match=/^(\d{1,2}):(\d{2})(?:\s|$)/.exec(typeof value==='string'?value.trim():'');
 return match&&Number(match[1])<24&&Number(match[2])<60?`${match[1].padStart(2,'0')}:${match[2]}`:'';
};
function isoDate(day){
 if(typeof day?.isoDate==='string')return day.isoDate;
 if(typeof day?.date==='string'&&/^\d{1,2}\/\d{1,2}$/.test(day.date))return '2026-'+day.date.split('/').map(part=>part.padStart(2,'0')).join('-');
 return '';
}
function intersects(a,b){
 if(!a||!b)return false;
 if(a.start===a.end)return b.start===b.end?a.start===b.start:a.start>=b.start&&a.start<b.end;
 if(b.start===b.end)return b.start>=a.start&&b.start<a.end;
 return a.start<b.end&&b.start<a.end;
}

// Review is advisory and never moves, deduplicates or edits an itinerary. All
// intervals use real instants, so an overnight flight also reserves its arrival day.
export function reviewImport(rows,days,trip={}){
 if(!Array.isArray(rows)||!Array.isArray(days))return [];
 const zone=trip.timezone||'UTC',instantCache=new Map(),issues=[],seen=new Set();
 const instant=(local,timezone,field)=>{
  const key=timezone+'|'+local;
  if(!instantCache.has(key)){
   try{instantCache.set(key,flightInstant(local,timezone,field));}catch{instantCache.set(key,null);}
  }
  return instantCache.get(key);
 };
 function interval(stop,date){
  if(stop?.kind==='flight'){
   const flight=stop.flight;
   if(!flight)return null;
   const start=instant(flight.departureDateTime,flight.departureTimezone,'departureDateTime');
   const end=instant(flight.arrivalDateTime,flight.arrivalTimezone,'arrivalDateTime');
   return start!==null&&end!==null&&end>start?{start,end}:null;
  }
  const time=clock(stop?.time);
  if(!date||!time)return null;
  const start=instant(date+'T'+time,zone);
  if(start===null)return null;
  const duration=Number.isSafeInteger(stop.duration)&&stop.duration>=0?stop.duration:0;
  return {start,end:start+duration*MINUTE};
 }
 function record(stop,day,row=null){
  const date=isoDate(days[day]);
  const name=normalized(stop?.name),place=normalized(routeLocation(stop,days[day]?.stops||[]));
  return {row,day,date,name,place,display:stop?.name?.trim()||'未命名行程',interval:interval(stop,date)};
 }
 const existing=days.flatMap((day,index)=>(Array.isArray(day?.stops)?day.stops:[]).map(stop=>record(stop,index)));
 const added=rows.map((row,index)=>record(row,row?.day,index));
 function add(candidate,type,other){
  const where=other.row===null?'既有行程':'本次第 '+(other.row+1)+' 筆行程';
  const label=`${where}「${other.display}」`;
  const message=type==='duplicate'?`與${label}在同一天使用相同名稱及地點，可能重複匯入。`:`時間與${label}重疊，請調整日期、時間或停留時間。`;
  const key=candidate.row+'|'+type+'|'+message;
  if(!seen.has(key)){seen.add(key);issues.push({row:candidate.row,message,type});}
 }
 function compare(candidate,other){
  if(candidate.date&&candidate.date===other.date&&candidate.name&&candidate.place&&candidate.name===other.name&&candidate.place===other.place)add(candidate,'duplicate',other);
  if(intersects(candidate.interval,other.interval))add(candidate,'overlap',other);
 }
 for(let index=0;index<added.length;index++){
  const candidate=added[index];
  for(const other of existing)compare(candidate,other);
  for(let prior=0;prior<index;prior++){compare(candidate,added[prior]);compare(added[prior],candidate);}
 }
 return issues.sort((a,b)=>a.row-b.row||(a.type==='duplicate'?-1:1)-(b.type==='duplicate'?-1:1));
}
