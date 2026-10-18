export function createDraftStore(storage,key){
 let failed=false;
 return {
  read(){try{const draft=JSON.parse(storage.getItem(key)||'null');return draft?.version===1?draft:null;}catch{return null;}},
  write(value){try{storage.setItem(key,JSON.stringify({...value,version:1,updatedAt:Date.now()}));failed=false;return true;}catch{failed=true;return false;}},
  clear(){try{storage.removeItem(key);failed=false;return true;}catch{failed=true;return false;}},
  get failed(){return failed;}
 };
}

export function withoutDeletedStops(days,deletedIds){
 if(!Array.isArray(days))return days;
 const ids=new Set(deletedIds);
 return days.map(day=>({...structuredClone(day),stops:day.stops.filter(stop=>!ids.has(stop.id)).map(stop=>structuredClone(stop))}));
}

// Remove only the deleted IDs from known draft structures. In particular, do
// not traverse surviving flight/private objects or reinterpret edited fields.
export function sanitizePermanentDraft(value,deletedIds){
 if(!value)return null;
 const ids=new Set(deletedIds),out=structuredClone(value);
 const importedHadDeleted=value.imported?.scope?.days?.some(day=>day.stops.some(stop=>ids.has(stop.id)));
 const scope=value=>{if(value?.days)value.days=withoutDeletedStops(value.days,ids);return value;};
 const snapshot=value=>{scope(value);if(value?.previous)value.previous=withoutDeletedStops(value.previous,ids);return value;};
 if(out.editor){
  const edit=out.editor,id=edit.editing?.id||edit.scope?.days?.[edit.editing?.day]?.stops?.[edit.editing?.index]?.id||edit.newStopId;
  if(ids.has(id))delete out.editor;
  else{
   scope(edit.scope);
   if(edit.editing&&id){const day=edit.scope?.days?.findIndex(day=>day.stops.some(stop=>stop.id===id));if(day>=0)edit.editing={...edit.editing,day,index:edit.scope.days[day].stops.findIndex(stop=>stop.id===id),id};else delete out.editor;}
  }
 }
 for(const key of ['transport','tag'])if(out[key]){if(ids.has(out[key].id))delete out[key];else scope(out[key].scope);}
 if(out.stay){scope(out.stay.scope);for(const id of ids)delete out.stay.values?.[id];if(!Object.keys(out.stay.values||{}).length)delete out.stay;}
 if(out.dayName)scope(out.dayName.scope);
 if(out.pending){
  if(ids.has(out.pending.deleteStopId))delete out.pending;
  else{
   snapshot(out.pending);if(out.pending.base)out.pending.base=withoutDeletedStops(out.pending.base,ids);
   if(out.pending.merge){snapshot(out.pending.merge.remote);delete out.pending.merge;}
   for(const key of ['stayId','tagId'])if(ids.has(out.pending[key]))delete out.pending[key];
   if(out.pending.importGuard?.rows)out.pending.importGuard.rows=out.pending.importGuard.rows.filter(row=>!ids.has(row.id));
   if(ids.size)out.pending.message='已儲存檢查後的修改。';
  }
 }
 if(out.imported){
  scope(out.imported.scope);
  if(out.imported.rows)out.imported.rows=out.imported.rows.filter(row=>!ids.has(row.id));
  // Generated context can still contain the removed name/notes; rebuild it
  // from the sanitized scope when the import draft is opened again.
  if(importedHadDeleted)delete out.imported.prompt;
  if(typeof out.imported.text==='string'&&[...ids].some(id=>out.imported.text.includes(JSON.stringify(id))))out.imported.text='';
 }
 return ['editor','transport','stay','dayName','tag','pending','imported'].some(key=>out[key])?out:null;
}
