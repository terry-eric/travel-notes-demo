import {parseMapsShare,locationFromMapsUrl} from './maps-link.js';
import {clockMinutes} from './transport.js';
import {buildGptPrompt,parseGptImport} from './gpt-import.js';
import {formatDuration} from './duration.js';

export function parseImportText(text){
 if(typeof text!=='string'||text.length>80000)throw Error('分享內容過長，請分批匯入。');
 const entries=[];let label='';
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  const urls=line.match(/https:\/\/[^\s<>"「」]+/gi);
  if(!urls){label=line.trim();continue;}
  for(const candidate of urls){
   const mapUrl=parseMapsShare(candidate),location=locationFromMapsUrl(mapUrl);
   const prefix=line.slice(0,line.indexOf(candidate)).trim().replace(/[|：:]\s*$/,'').trim();
   const name=prefix||label||location?.label||`匯入地點 ${entries.length+1}`;
   if(name.length>120)throw Error('行程名稱最多 120 個字，請縮短分享地點前的名稱。');
   entries.push({name,mapUrl,q:location?.query||''});label='';
   if(entries.length>100)throw Error('一次最多匯入 100 個行程。');
  }
 }
 if(!entries.length)throw Error('請貼上 Google Maps 分享連結，每個地點分開一行。');
 return entries;
}

function scheduledImportTime(value){
 const match=/^(\d{1,2}:\d{2})(?:\s|$)/.exec((value||'').trim());
 return match?clockMinutes(match[1]):null;
}
export function insertImported(days,rows){
 const next=structuredClone(days),ids=new Set(next.flatMap(d=>d.stops.map(s=>s.id)));
 for(const row of rows){
  if(!Number.isInteger(row.day)||!next[row.day]||clockMinutes(row.time)===null)throw Error('請選擇有效的行程日期和時間。');
  if(!row.id||ids.has(row.id)||!row.name?.trim()||row.name.length>120)throw Error('請確認匯入行程的名稱。');
  const mapUrl=parseMapsShare(row.mapUrl);if(!mapUrl||!row.q?.trim())throw Error('請先確認分享連結的地點。');
  const {day,...fields}=row,stop={...fields,mapUrl,tag:fields.tag??'其他',desc:fields.desc??'',mode:fields.mode??'walking'},items=next[day].stops;
  if(items.length>=100)throw Error(`${next[day].date} 最多可安排 100 個行程。`);
  // Preserve existing order while respecting fixed times such as "17:30 抵達".
  const at=items.findIndex(s=>scheduledImportTime(s.time)!==null&&scheduledImportTime(s.time)>clockMinutes(stop.time));
  items.splice(at<0?items.length:at,0,stop);ids.add(stop.id);
 }
 return next;
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initImport({canWrite,getScope,onSave,onChange,onClose}){
 const $=id=>document.getElementById(id);let scope=null,rows=[],dirty=false,working=false,kind='maps';
 const options=selected=>scope.days.map((day,i)=>`<option value="${i}" ${i===selected?'selected':''}>${escape(day.date)} ${escape(day.week)}</option>`).join('');
 function collect(){
  return rows.map((row,i)=>{const el=$('import-rows').querySelector(`[data-import-row="${i}"]`);const result={...row,name:el.querySelector('[name="importName"]').value.trim(),day:Number(el.querySelector('[name="importDay"]').value),time:el.querySelector('[name="importTime"]').value};if(kind==='gpt'){result.q=el.querySelector('[name="importPlace"]').value.trim();if(result.q!==row.q)result.mapUrl='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(result.q);}return result;});
 }
 function render(){
  $('import-rows').innerHTML=rows.map((row,i)=>`<article class="import-row" data-import-row="${i}"><label>行程名稱<input name="importName" aria-label="第 ${i+1} 筆行程名稱" value="${escape(row.name)}" required maxlength="120"></label><label>日期<select name="importDay" aria-label="第 ${i+1} 筆日期">${options(row.day)}</select></label><label>時間<input type="time" name="importTime" aria-label="第 ${i+1} 筆時間" value="${escape(row.time)}" required></label>${kind==='gpt'?`<label class="import-place">地點／地址<input name="importPlace" aria-label="第 ${i+1} 筆地點" value="${escape(row.q)}" required maxlength="300"></label><div class="import-meta"><span class="tag">${escape(row.tag)}</span><span>停留 ${formatDuration(row.duration)}</span><span>${({walking:'步行',transit:'大眾運輸',driving:'開車',bicycling:'自行車'})[row.mode]}</span>${row.live?'<span>固定時間</span>':''}${row.desc?`<p>${escape(row.desc)}</p>`:''}</div>`:''}<a class="stop-link" href="${escape(row.mapUrl)}" target="_blank" rel="noopener noreferrer">確認 Google Maps 地點 ↗</a><button type="button" class="plain danger" data-import-remove="${i}" aria-label="移除第 ${i+1} 筆">移除</button></article>`).join('');
  $('import-save').hidden=!rows.length;$('import-count').textContent=rows.length?`${rows.length} 筆行程，每筆可分別設定日期和時間。匯入會加入現有行程。`:'';
 }
 function showKind(value){
  kind=value==='gpt'?'gpt':'maps';$('gpt-prompt-panel').hidden=kind!=='gpt';$('gpt-prompt').value=buildGptPrompt(scope.days,scope.trip||{});$('gpt-copy-status').textContent='';
  $('import-title').textContent=kind==='gpt'?'匯入 GPT 行程':'匯入行程';
  $('import-help').textContent=kind==='gpt'?'複製提示詞交給 AI，再將完整 JSON 貼到下方。地點由 AI 建議，可在 Google Maps 確認後匯入。':'貼上 Google Maps 分享連結，每個地點分開一行；可在連結前加上行程名稱。';
  $('import-text-name').textContent=kind==='gpt'?'2. 貼上 GPT 產生的行程 JSON':'Google Maps 分享內容';
  $('import-text').placeholder=kind==='gpt'?'{"format":"trip-gpt-v1","stops":[…]}':'咖啡時間 https://maps.app.goo.gl/…\n預約餐廳 https://www.google.com/maps/place/…';
  $('import-defaults').hidden=kind==='gpt';
  document.querySelectorAll('[data-import-type]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.importType===kind)));
 }
 function open(day,type='maps'){
  if(!canWrite())return;scope=getScope();rows=[];dirty=false;$('import-form').reset();$('import-day').innerHTML=options(day);$('import-time').value='09:00';$('import-error').textContent='';showKind(type);$('gpt-prompt-panel').open=true;render();$('import-dialog').showModal();$(kind==='gpt'?'gpt-copy':'import-text').focus();
 }
 function close(){dirty=false;scope=null;rows=[];$('import-dialog').close();onChange();onClose();}
 const api={open,close,get dirty(){return dirty;},lock(locked){for(const id of ['import-open','gpt-import-open'])$(id).disabled=locked||!canWrite();for(const el of $('import-form').querySelectorAll('input,textarea,select,button'))el.disabled=el.hasAttribute('data-import-close')?working:locked||working||!canWrite();},snapshot(){return dirty&&scope?{scope,kind,prompt:kind==='gpt'?$('gpt-prompt').value:undefined,rows:rows.length?collect():[],text:$('import-text').value,day:$('import-day').value,time:$('import-time').value}:null;},restore(saved){scope=saved.scope;rows=saved.rows||[];dirty=true;$('import-day').innerHTML=options(Number(saved.day));$('import-time').value=saved.time;$('import-text').value=saved.text;$('import-error').textContent='';showKind(saved.kind);if(typeof saved.prompt==='string')$('gpt-prompt').value=saved.prompt;$('gpt-prompt-panel').open=false;render();$('import-dialog').showModal();}};
 $('import-open').addEventListener('click',()=>open(Number($('toolbar-add').dataset.add)));
 $('gpt-import-open').addEventListener('click',()=>open(Number($('toolbar-add').dataset.add),'gpt'));
 for(const button of document.querySelectorAll('[data-import-type]'))button.addEventListener('click',()=>{if(working||!canWrite())return;const next=button.dataset.importType;if(next===kind)return;rows=[];$('import-text').value='';$('import-error').textContent='';showKind(next);render();dirty=true;onChange();});
 $('gpt-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('gpt-prompt').value);$('gpt-copy-status').textContent='提示詞已複製，貼給 ChatGPT 或其他 AI。';}catch{$('gpt-prompt').focus();$('gpt-prompt').select();$('gpt-copy-status').textContent='請複製已選取的提示詞，再貼給 AI。';}});
 $('import-preview').addEventListener('click',()=>{
  try{rows=(kind==='gpt'?parseGptImport($('import-text').value,scope.days):parseImportText($('import-text').value).map(row=>({...row,day:Number($('import-day').value),time:$('import-time').value||'09:00'}))).map(row=>({...row,id:crypto.randomUUID()}));dirty=true;render();$('import-error').textContent='';if(kind==='gpt')$('gpt-prompt-panel').open=false;onChange();}
  catch(error){$('import-error').textContent=error.message;}
 });
 $('import-apply').addEventListener('click',()=>{rows=collect().map(row=>({...row,day:Number($('import-day').value),time:$('import-time').value}));dirty=true;render();onChange();});
 $('import-rows').addEventListener('click',event=>{const button=event.target.closest('[data-import-remove]');if(!button)return;rows=collect();rows.splice(Number(button.dataset.importRemove),1);dirty=true;render();onChange();});
 $('import-rows').addEventListener('input',event=>{if(event.target.name!=='importPlace')return;const row=event.target.closest('[data-import-row]');row.querySelector('a').href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(event.target.value.trim());});
 $('import-text').addEventListener('input',()=>{rows=[];render();$('import-error').textContent='';});
 for(const type of ['input','change'])$('import-form').addEventListener(type,()=>{dirty=true;onChange();});
 $('import-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!rows.length||working||!canWrite())return;rows=collect();working=true;api.lock(true);$('import-error').textContent=kind==='gpt'?'正在儲存 AI 行程…':'正在確認分享地點…';
  try{await onSave(rows,scope);if($('import-dialog').open)$('import-error').textContent='修改尚未儲存，請依畫面提示重試或處理衝突。';}
  catch(error){$('import-error').textContent=error.message;}
  finally{working=false;api.lock(false);onChange();}
 });
 for(const button of $('import-dialog').querySelectorAll('[data-import-close]'))button.addEventListener('click',()=>{if(!working)close();});
 $('import-dialog').addEventListener('cancel',event=>{if(working){event.preventDefault();return;}close();});
 $('import-dialog').addEventListener('close',onClose);
 return api;
}
