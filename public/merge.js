import {withStopIds} from './identity.js';
const equal=(a,b)=>a===b||!!(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k])));
export const fieldLabels={name:'名稱',time:'時間',tag:'標籤',desc:'備註',duration:'停留時間',from:'出發地',live:'固定行程',source:'演出資訊',location:'導航地點',travel:'交通方式與時間',day:'安排日期'};
const groups={location:['q','routeQuery','placeId','mapUrl'],travel:['mode','travelMinutes','travelSignature']};
const fields=['name','time','tag','desc','duration','from','live','source','location','travel'];
const group=(stop,field)=>groups[field]?Object.fromEntries(groups[field].filter(k=>stop?.[k]!==undefined).map(k=>[k,stop[k]])):stop?.[field];
const records=days=>new Map(days.flatMap((day,d)=>day.stops.map(stop=>[stop.id,{stop,day:d}])));
const creator=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())?value.trim().toLowerCase():'';
const editableRecord=record=>{
 if(!record)return record;
 const {createdBy,...stop}=record.stop;
 return {...record,stop};
};
const equalEditable=(a,b)=>equal(editableRecord(a),editableRecord(b));
// Attribution comes from the latest cloud record, or the known base when a
// deleted item is retained. Local drafts cannot assign their own creator.
function attributed(record,source){
 const out=structuredClone(record);delete out.stop.createdBy;
 const email=creator(source?.stop.createdBy);if(email)out.stop.createdBy=email;
 return out;
}
function project(ids,preferred,other){
 const allowed=new Set(ids),out=preferred.filter(id=>allowed.has(id));
 for(let i=0;i<other.length;i++){
  const id=other[i];if(!allowed.has(id)||out.includes(id))continue;
  let before=-1;for(let j=i-1;j>=0;j--)if(out.includes(other[j])){before=out.indexOf(other[j]);break;}
  if(before>=0)out.splice(before+1,0,id);
  else{const after=other.slice(i+1).find(id=>out.includes(id));out.splice(after?out.indexOf(after):out.length,0,id);}
 }
 for(const id of ids)if(!out.includes(id))out.push(id);
 return out;
}
function mergeOrder(ids,base,mine,theirs){
 const positions=list=>new Map(list.map((id,i)=>[id,i]));
 const b=positions(base),m=positions(mine),t=positions(theirs),edges=new Map(ids.map(id=>[id,new Set()])),degrees=new Map(ids.map(id=>[id,0]));
 const relation=(map,a,z)=>map.has(a)&&map.has(z)?map.get(a)<map.get(z):null;
 let incompatible=false;
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i],z=ids[j],br=relation(b,a,z),mr=relation(m,a,z),tr=relation(t,a,z);let pick;
  if(mr===tr)pick=mr;
  else if(mr===null)pick=tr;
  else if(tr===null)pick=mr;
  else if(mr===br)pick=tr;
  else if(tr===br)pick=mr;
  else{incompatible=true;continue;}
  if(pick===null)continue;
  const [from,to]=pick?[a,z]:[z,a];edges.get(from).add(to);degrees.set(to,degrees.get(to)+1);
 }
 const priority=project(ids,theirs,mine),out=[];
 while(out.length<ids.length){
  const next=priority.find(id=>!out.includes(id)&&degrees.get(id)===0);if(!next)return null;
  out.push(next);for(const id of edges.get(next))degrees.set(id,degrees.get(id)-1);
 }
 return incompatible?null:out;
}
export function mergeTrip(baseDays,mineDays,theirDays,choices={}){
 const base=withStopIds(baseDays),mine=withStopIds(mineDays),theirs=withStopIds(theirDays);
 const b=records(base),m=records(mine),t=records(theirs),result=new Map(),conflicts=[];
 function pick(key,label,name,original,local,remote,type='field',same=equal){
  if(same(local,remote))return local;
  if(same(local,original))return remote;
  if(same(remote,original))return local;
  const resolved=['mine','theirs'].includes(choices[key]);
  conflicts.push({key,label,name,type,base:original,mine:local,theirs:remote,resolved});
  return choices[key]==='mine'?local:remote;
 }
 for(const id of new Set([...b.keys(),...m.keys(),...t.keys()])){
  const original=b.get(id),local=m.get(id),remote=t.get(id),name=local?.stop.name||remote?.stop.name||original?.stop.name||'行程';
  if(!local||!remote){
   const survivor=local||remote;
   if(!original){if(survivor)result.set(id,attributed(survivor,remote));continue;}
   if(!survivor||equalEditable(survivor,original))continue;
   const chosen=pick('presence:'+id,'刪除或保留',name,original,local,remote,'presence',equalEditable);
   if(chosen)result.set(id,attributed(chosen,remote||original));continue;
  }
  const stop={id};
  for(const field of fields){
   const value=pick(id+':'+field,fieldLabels[field],name,group(original?.stop,field),group(local.stop,field),group(remote.stop,field));
   if(groups[field])Object.assign(stop,value);else if(value!==undefined)stop[field]=value;
  }
  const day=pick(id+':day',fieldLabels.day,name,original?.day,local.day,remote.day);
  result.set(id,attributed({stop,day},remote));
 }
 const days=theirs.map((day,d)=>{
  const ids=[...result].filter(([,entry])=>entry.day===d).map(([id])=>id);
  const orders=[base,mine,theirs].map(ds=>ds[d].stops.map(s=>s.id));
  let order=mergeOrder(ids,...orders);
  if(!order){
   const key='order:'+d,local=project(ids,orders[1],orders[2]),remote=project(ids,orders[2],orders[1]);
   conflicts.push({key,label:'行程順序',name:day.date,type:'order',mine:local.map(id=>result.get(id).stop.name),theirs:remote.map(id=>result.get(id).stop.name),resolved:['mine','theirs'].includes(choices[key])});
   order=choices[key]==='mine'?local:remote;
  }
  return {...day,stops:order.map(id=>result.get(id).stop)};
 });
 return {days,conflicts,unresolved:conflicts.filter(c=>!c.resolved)};
}
