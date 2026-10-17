// Only explicit destinations can become map pins. A Google Maps @lat,lng
// viewport describes the camera, and must never be treated as a saved place.
const DECIMAL=/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
// White pin numbers and matching labels remain readable on every day color.
// Colors are selected here, never taken from imported/user-supplied CSS values.
export const ROUTE_DAY_COLORS=Object.freeze(['#b92667','#1d4ed8','#15803d','#7e22ce','#b45309','#0f766e','#b91c1c','#4338ca','#854d0e','#0e7490','#a21caf','#334155']);

function dayDescriptor(stop){
 const index=Number.isInteger(stop?.dayIndex)&&stop.dayIndex>=0?stop.dayIndex:null;
 const date=typeof stop?.date==='string'?stop.date.trim():'';
 const title=typeof stop?.dayLabel==='string'?stop.dayLabel.trim():'';
 // dayIndex makes a day's color identical in overview and single-day maps.
 // Date-only imported lists use a stable hash, independent of the visible subset.
 let colorIndex=index??0;
 if(index===null&&date)for(const character of date)colorIndex=(colorIndex*31+character.codePointAt(0))%ROUTE_DAY_COLORS.length;
 return {key:index!==null?`day:${index}:${date}`:date?`date:${date}`:'day:default',index,date,title,label:date||title||(index!==null?`第 ${index+1} 天`:'行程'),color:ROUTE_DAY_COLORS[colorIndex%ROUTE_DAY_COLORS.length]};
}

function number(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!DECIMAL.test(value.trim()))return null;
 const parsed=Number(value.trim());return Number.isFinite(parsed)?parsed:null;
}

export function normalizeCoordinates(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const lat=number(value.lat),lng=number(value.lng);
 return lat!==null&&lng!==null&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}

function coordinateText(value){
 if(typeof value!=='string')return null;
 const match=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/.exec(value);
 return match?normalizeCoordinates({lat:match[1],lng:match[2]}):null;
}

function googlePlaceCoordinates(value){
 if(typeof value!=='string'||value.length>5000)return null;
 let url;try{url=new URL(value.trim());}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 if(!/^(?:www\.|maps\.)?google\.(?:com|com\.tw|co\.jp)$/.test(url.hostname))return null;
 if(!(url.pathname==='/maps'||url.pathname.startsWith('/maps/')||url.hostname.startsWith('maps.')&&url.pathname==='/'))return null;
 // Directions may contain several destinations; they are not a saved place.
 if(url.pathname.startsWith('/maps/dir'))return null;
 let path;try{path=decodeURIComponent(url.pathname);}catch{path=url.pathname;}
 const pair=/!3d([+-]?(?:\d+(?:\.\d+)?|\.\d+))!4d([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:!|\/|$)/.exec(path);
 if(pair){const coordinates=normalizeCoordinates({lat:pair[1],lng:pair[2]});if(coordinates)return coordinates;}
 return coordinateText(url.searchParams.get('query'))||coordinateText(url.searchParams.get('q'));
}

export function getStopCoordinates(stop){
 if(!stop||typeof stop!=='object')return null;
 const saved=normalizeCoordinates(stop.coordinates);if(saved)return saved;
 for(const value of [stop.routeQuery,stop.q,stop.mapUrl]){
  const destination=coordinateText(value)||googlePlaceCoordinates(value);
  if(destination)return destination;
 }
 return null;
}

/** Keep sequence numbers; unknown places and date boundaries break connections. */
export function buildRouteMapModel(stops=[]){
 const entries=(Array.isArray(stops)?stops:[]).map((stop,index)=>({
  stop:stop&&typeof stop==='object'?stop:{},
  id:String(stop?.id??`route-stop-${index}`),number:index+1,
  coordinates:getStopCoordinates(stop),
  day:dayDescriptor(stop),
 }));
 const located=entries.filter(entry=>entry.coordinates),missing=entries.filter(entry=>!entry.coordinates),segments=[],days=[];
 const dayKeys=new Set();
 for(const entry of entries)if(!dayKeys.has(entry.day.key)){dayKeys.add(entry.day.key);days.push(entry.day);}
 let run=[];
 const finish=()=>{if(run.length>1)segments.push(run);run=[];};
 for(const entry of entries){
  if(run.length&&run[run.length-1].day.key!==entry.day.key)finish();
  if(entry.coordinates)run.push(entry);else finish();
 }
 finish();
 return {entries,located,missing,segments,days};
}

/** Pixel offsets only: repeated visits keep their true geographical destination. */
export function duplicatePinOffsets(entries=[]){
 const result=new Map(),groups=new Map();
 for(const entry of entries){
  if(!entry.coordinates)continue;
  const {lat,lng}=entry.coordinates,key=`${lat.toFixed(6)},${lng.toFixed(6)}`;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);
 }
 for(const group of groups.values()){
  if(group.length===1){result.set(group[0].id,{x:0,y:0});continue;}
  if(group.length===2){group.forEach((entry,index)=>result.set(entry.id,{x:index?26:-26,y:0}));continue;}
  if(group.length>8){
   const columns=Math.ceil(Math.sqrt(group.length)),rows=Math.ceil(group.length/columns);
   group.forEach((entry,index)=>result.set(entry.id,{x:Math.round((index%columns-(columns-1)/2)*48),y:Math.round((Math.floor(index/columns)-(rows-1)/2)*48)}));
   continue;
  }
  group.forEach((entry,index)=>{
   const angle=-Math.PI/2+2*Math.PI*index/group.length;
   result.set(entry.id,{x:Math.round(Math.cos(angle)*40),y:Math.round(Math.sin(angle)*40)});
  });
 }
 return result;
}
