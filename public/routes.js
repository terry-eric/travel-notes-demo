import {appBase,demoMode} from './runtime.js';
export const pagePaths={trips:'/trips',overview:'/overview',daily:'/daily',map:'/map',notes:'/notes'};
export function readRoute(href,base=appBase,staticMode=demoMode){
 const url=new URL(href,'https://trip.example');
 const legacy=url.hash.match(/^#day-(\d+)-stop-(\d+)$/);
 const hashPages={'#overview':'overview','#daily':'daily','#map-panel':'map','#before':'notes'};
 const queryPage=staticMode&&Object.hasOwn(pagePaths,url.searchParams.get('page'))?url.searchParams.get('page'):'';
 const page=queryPage||Object.keys(pagePaths).find(key=>base+pagePaths[key]===url.pathname)||hashPages[url.hash]||(legacy?'daily':'overview');
 const day=Number(legacy?.[1]??url.searchParams.get('day')??1);
 const stop=Number(legacy?.[2]??url.searchParams.get('stop')??1);
 return {page,day:Number.isInteger(day)&&day>=1&&day<=60?day-1:0,stop:Number.isSafeInteger(stop)&&stop>=1?stop-1:0};
}
export function boundedSelection(days,day=0,stop=0){
 day=Number.isSafeInteger(day)&&day>=0?day:0;stop=Number.isSafeInteger(stop)&&stop>=0?stop:0;
 // Keep a deep link intact while its authenticated trip is still loading.
 if(!days.length)return {day,stop};
 day=Math.min(day,days.length-1);return {day,stop:Math.min(stop,Math.max(0,days[day].stops.length-1))};
}
export function routeUrl(page,day=0,stop=0,base=appBase,tripId=new URL(globalThis.location?.href||'https://trip.example').searchParams.get('trip')||'',staticMode=demoMode){
 page=Object.hasOwn(pagePaths,page)?page:'overview';
 const path=base+(staticMode?'/index.html':pagePaths[page]);
 const params=new URLSearchParams();if(staticMode)params.set('page',page);if(tripId)params.set('trip',tripId);
 if(page==='daily'||page==='map'){params.set('day',day+1);params.set('stop',stop+1);}
 return path+(params.size?'?'+params:'');
}
