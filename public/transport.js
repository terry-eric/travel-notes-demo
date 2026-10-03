// The destination field is shared by place maps and directions.
// A custom itinerary name or a short share URL is not a location.
import {locationFromMapsUrl} from './maps-link.js';
export function routeLocation(stop,stops=[],resolved=new Map()){
 if(!stop)return '';
 if(stop.routeQuery?.trim())return stop.routeQuery.trim();
 if(stop.placeId)return `place_id:${stop.placeId}`;
 if(stop.q?.trim())return stop.q.trim();
 if(!stop.mapUrl)return '';
 const peer=stops.find(s=>s!==stop&&s.mapUrl===stop.mapUrl&&(s.routeQuery?.trim()||s.q?.trim()||s.placeId));
 if(peer)return routeLocation(peer);
 return resolved.get(stop.mapUrl)?.query||locationFromMapsUrl(stop.mapUrl)?.query||'';
}
export function routeLeg(stops,index,resolved=new Map()){
 const stop=stops[index];if(!stop)return null;
 const origin=index===0?(stop.from||''):routeLocation(stops[index-1],stops,resolved);
 const destination=routeLocation(stop,stops,resolved);
 return {origin,destination,fromName:index===0?(stop.from||'出發地'):stops[index-1].name,toName:stop.name,mode:stop.mode||'walking',complete:!!(origin&&destination),samePlace:!!origin&&origin===destination};
}
export function directionsUrl(leg,mode,key=''){
 if(!leg?.complete)return '';
 const url=new URL(key?'https://www.google.com/maps/embed/v1/directions':'https://www.google.com/maps/dir/');
 const travelMode=['walking','transit','driving','bicycling'].includes(mode)?mode:'walking';
 if(key){url.searchParams.set('key',key);url.searchParams.set('mode',travelMode);url.searchParams.set('language','zh-TW');}
 else{url.searchParams.set('api','1');url.searchParams.set('travelmode',travelMode);}
 for(const end of ['origin','destination']){
  const value=leg[end];
  if(!key&&value.startsWith('place_id:')){url.searchParams.set(end,end==='origin'?leg.fromName:leg.toName);url.searchParams.set(end+'_place_id',value.slice(9));}
  else url.searchParams.set(end,value);
 }
 return url.href;
}

// Bind manually entered minutes to this pair of places and transport mode.
export function legSignature(stops,index){
 const place=s=>s?(routeLocation(s)||s.mapUrl||s.name):'';
 return JSON.stringify([index?place(stops[index-1]):stops[index]?.from||'',place(stops[index]),stops[index]?.mode||'walking']);
}
export function savedTravelMinutes(stops,index){
 const s=stops[index];
 return Number.isInteger(s?.travelMinutes)&&s.travelSignature===legSignature(stops,index)?s.travelMinutes:null;
}
export function clearStaleTravel(days){
 for(const day of days)day.stops.forEach((s,i)=>{if(savedTravelMinutes(day.stops,i)===null){delete s.travelMinutes;delete s.travelSignature;}});
 return days;
}
export function clockMinutes(value){
 const m=/^(\d{1,2}):(\d{2})$/.exec((value||'').trim());
 return m&&+m[1]<24&&+m[2]<60?+m[1]*60+ +m[2]:null;
}
export function pushSchedule(stops,start){
 let changed=0,reason='';
 if(start===0)return {changed,reason:'已儲存交通時間；第一站請自行設定抵達時間。'};
 for(let i=start;i<stops.length;i++){
  const prev=stops[i-1],current=stops[i],time=clockMinutes(prev.time),travel=savedTravelMinutes(stops,i);
  if(time===null||!Number.isInteger(prev.duration)||travel===null){reason=`「${time===null||!Number.isInteger(prev.duration)?prev.name:current.name}」尚缺${time===null?'明確時間（HH:MM）':!Number.isInteger(prev.duration)?'停留時間':'交通時間'}，後續保留原安排。`;break;}
  const arrival=time+prev.duration+travel;
  if(current.live){const fixed=/^(\d{1,2}:\d{2})(?:\s|$)/.exec(current.time||'');const at=fixed?clockMinutes(fixed[1]):null;reason=at!==null&&arrival>at?`預計抵達會晚於「${current.name}」的固定時間，請縮短前段行程。`:'行程時間固定，保留原安排。';break;}
  if(arrival>=1440){reason='順延將跨過午夜，後續保留原安排，請調整當天行程。';break;}
  const planned=clockMinutes(current.time);
  if(planned===null){reason=`「${current.name}」尚未設定明確時間（HH:MM），後續保留原安排。`;break;}
  if(arrival>planned){current.time=String(Math.floor(arrival/60)).padStart(2,'0')+':'+String(arrival%60).padStart(2,'0');changed++;}
 }
 return {changed,reason};
}
