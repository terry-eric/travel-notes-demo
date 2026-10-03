export function withStopIds(days){
 const seen=new Set();
 return days.map((day,d)=>({...day,stops:day.stops.map((stop,i)=>{
  const id=stop.id||`legacy-${d}-${i}`;
  if(typeof id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(id)||seen.has(id))throw Error('行程識別碼不正確或重複。');
  seen.add(id);return {time:'',q:'',tag:'行程',desc:'',mode:'walking',...stop,id};
 })}));
}
