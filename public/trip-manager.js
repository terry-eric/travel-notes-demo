import {demoMode} from './runtime.js';
const DAY_MS=86400000;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function parseTravelDate(value){
 if(typeof value!=='string'||!datePattern.test(value))return null;
 const [year,month,day]=value.split('-').map(Number);
 if(year<1900||year>9999)return null;
 const stamp=Date.UTC(year,month-1,day);
 return new Date(stamp).toISOString().slice(0,10)===value?stamp:null;
}

export function validateNewTrip(input){
 const title=typeof input?.title==='string'?input.title.trim():'';
 if(!title||title.length>120)throw Error('請填寫 1–120 字的旅行名稱。');
 const start=parseTravelDate(input?.startDate),end=parseTravelDate(input?.endDate);
 if(start===null||end===null)throw Error('請選擇有效的出發與結束日期。');
 const dayCount=(end-start)/DAY_MS+1;
 if(dayCount<1)throw Error('結束日期不能早於出發日期。');
 if(dayCount>60)throw Error('每趟旅行可安排 1–60 天。');
 const result={title,startDate:input.startDate,endDate:input.endDate};
 if(input.timezone!==undefined){
  if(typeof input.timezone!=='string'||input.timezone.length>80)throw Error('請選擇有效的旅行時區。');
  try{new Intl.DateTimeFormat('en',{timeZone:input.timezone});}catch{throw Error('請選擇有效的旅行時區。');}
  result.timezone=input.timezone;
 }
 return result;
}

export function tripDateLabel(trip){
 const start=parseTravelDate(trip?.startDate),end=parseTravelDate(trip?.endDate);
 if(start===null||end===null)return '日期尚未設定';
 const count=(end-start)/DAY_MS+1;
 return `${trip.startDate.replaceAll('-','/')} — ${trip.endDate.replaceAll('-','/')} · ${count} 天`;
}

export function tripRoleLabel(role){
 return ({owner:'我的旅行',editor:'受邀 · 可編輯',viewer:'受邀 · 僅查看'})[role]||'受邀旅行';
}

export function tripMutation(trip,action='delete'){
 if(!trip||trip.role!=='owner')throw Error('只有旅行擁有者能刪除或恢復旅行。');
 if(typeof trip.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(trip.id)||!Number.isSafeInteger(trip.revision)||trip.revision<0)throw Error('旅行版本不完整，請重新載入清單後再試。');
 if(action!=='delete'&&action!=='restore')throw Error('旅行操作不正確。');
 return {id:trip.id,revision:trip.revision,...(action==='restore'?{action:'restore'}:{})};
}

export function updateCurrentTripRecord(record,metadata){
 if(!record||record.id!==metadata?.id||!Number.isSafeInteger(metadata.revision)||metadata.revision<0)return record;
 const known=Number.isSafeInteger(record.revision)?record.revision:-1;
 if(metadata.revision<known)return record;
 const next={...record,revision:metadata.revision};
 for(const field of ['title','startDate','endDate','timezone'])if(typeof metadata[field]==='string')next[field]=metadata[field];
 return next;
}

export function groupTripsByMonth(items){
 const date=trip=>parseTravelDate(trip?.startDate)??Number.MAX_SAFE_INTEGER;
 const sorted=[...items].sort((a,b)=>date(a)-date(b)||String(a.title||'').localeCompare(String(b.title||''),'zh-Hant')||String(a.id).localeCompare(String(b.id)));
 const groups=new Map();
 for(const trip of sorted){
  const dated=parseTravelDate(trip?.startDate)!==null,key=dated?trip.startDate.slice(0,7):'undated';
  if(!groups.has(key))groups.set(key,{key,label:dated?`${Number(key.slice(0,4))} 年 ${Number(key.slice(5))} 月`:'日期尚未設定',trips:[]});
  groups.get(key).trips.push(trip);
 }
 return [...groups.values()];
}

export function initTripManager({apiPath,readJson,onSelect,onDelete=()=>{},onRenamed=()=>{},onPendingChange=()=>{},onAuthFailure=()=>{},canSwitch=()=>true,fetcher=fetch,now=Date.now}){
 const $=id=>document.getElementById(id),panel=$('trips-panel');
 let trips=[],deletedTrips=[],currentId='',pending=false,currentTitle='',ready=false,creationAttempt=null,deleteReview='',createDirty=false,catalogueStale=false;
 let cache=null,cacheEmail='',sessionEmail='',catalogueFlight=null,catalogueGeneration=0,stateEpoch=0,catalogueLoadedAt=null,catalogueAuthoritative=false,catalogueStatusText='',reviewedTrip=null,currentMetadata=null;
 let renameDraft=null;
 const request=options=>fetcher(apiPath('/api/trips'),{cache:'no-store',signal:AbortSignal.timeout(15000),...options}).then(readJson);
 const writeStatus=(message,isError=false)=>{$('trips-status').textContent=message;$('trips-status').classList.toggle('form-error',isError);};
 const status=(message,isError=false)=>{catalogueStatusText='';writeStatus(message,isError);};
 const catalogueStatus=(message,isError=false,force=false)=>{
  if(!force&&$('trips-status').textContent&&$('trips-status').textContent!==catalogueStatusText&&(pending||deleteReview||createDirty||renameDraft||$('trips-status').classList.contains('form-error')))return;
  catalogueStatusText=message;writeStatus(message,isError);
 };
 const invalidateFlight=()=>{catalogueGeneration++;catalogueFlight=null;};
 const invalidateCacheCatalogue=()=>{try{cache?.clearCatalogue?.();}catch{}};
 const persistCatalogue=()=>{try{if(cache?.writeCatalogue({trips,deletedTrips})===false)invalidateCacheCatalogue();}catch{invalidateCacheCatalogue();}};
 const lock=()=>{
  panel.querySelectorAll('button,input,select').forEach(el=>{el.disabled=pending;});
  panel.querySelectorAll('[data-trip-delete],[data-delete-confirm],[data-trip-restore],[data-trip-rename]').forEach(el=>{el.disabled=pending||catalogueStale||!catalogueAuthoritative;});
  for(const id of ['trip-create-open','trip-empty-create','trip-create-save'])if($(id))$(id).disabled=pending||!sessionEmail;
  $('trips-open').disabled=pending;
 };
 const setPending=value=>{pending=value;lock();onPendingChange(value);};
 const deleteIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';
 const renameIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';
 const captureRename=()=>{
  if(!renameDraft)return;
  const input=$('trip-library').querySelector('[data-rename-input]');
  if(input){renameDraft.title=input.value;renameDraft.dirty=input.value!==renameDraft.baseTitle||renameDraft.uncertain||!!renameDraft.remote;if(Number.isInteger(input.selectionStart)&&Number.isInteger(input.selectionEnd))renameDraft.selection=[input.selectionStart,input.selectionEnd];}
 };
 const focusRename=()=>{const input=$('trip-library').querySelector('[data-rename-input]');input?.focus();if(renameDraft?.selection)input?.setSelectionRange?.(...renameDraft.selection);};
 const renameForm=trip=>{
  if(renameDraft?.id!==trip.id)return '';
  const remote=renameDraft.remote;
  return `<form class="trip-rename-form" data-trip-rename-form="${esc(trip.id)}"><label for="trip-rename-title-${esc(trip.id)}">旅行名稱</label><input class="trip-rename-input" id="trip-rename-title-${esc(trip.id)}" data-rename-input name="title" value="${esc(renameDraft.title)}" maxlength="120" required autocomplete="off"><p class="trip-rename-error" role="alert">${esc(renameDraft.error)}</p>${remote?`<div class="trip-rename-conflict"><p>目前名稱：<strong>${esc(remote.trip.title)}</strong></p><p>另一個裝置已更新名稱，請選擇要使用的版本。</p><div><button type="button" class="secondary" data-rename-remote>使用目前名稱</button><button type="button" class="primary" data-rename-mine>儲存我的名稱</button></div></div>`:''}<div class="trip-rename-actions"><button type="button" class="plain" data-rename-cancel>取消</button>${remote?'':'<button type="submit" class="primary" data-rename-save>儲存名稱</button>'}</div></form>`;
 };
 const render=()=>{
  captureRename();
  const focused=document.activeElement,focusKey=focused?.dataset?.deleteConfirm?'data-delete-confirm':focused?.hasAttribute?.('data-delete-cancel')?'data-delete-cancel':null,renameFocus=focused?.hasAttribute?.('data-rename-input'),selection=renameFocus?[focused.selectionStart,focused.selectionEnd]:null;
  const card=trip=>`<article class="trip-library-card${trip.id===currentId?' is-current':''}" data-trip-card="${esc(trip.id)}"><div class="trip-card-top"><span class="trip-role${trip.role==='owner'?' is-owner':''}">${tripRoleLabel(trip.role)}</span>${trip.id===currentId?'<span class="trip-current-badge">目前旅行</span>':''}</div><div class="trip-card-actions"><button type="button" class="trip-select" data-trip-id="${esc(trip.id)}" aria-label="開啟旅行：${esc(trip.title)}"${trip.id===currentId?' aria-current="true"':''}><strong>${esc(trip.title)}</strong><span class="trip-card-dates">${esc(tripDateLabel(trip))}</span></button>${['owner','editor'].includes(trip.role)?`<button type="button" class="trip-rename-icon" data-trip-rename="${esc(trip.id)}" aria-label="修改旅行名稱：${esc(trip.title)}" title="修改旅行名稱">${renameIcon}</button>`:''}${trip.role==='owner'?`<button type="button" class="trip-delete-icon" data-trip-delete="${esc(trip.id)}" aria-label="刪除旅行：${esc(trip.title)}" title="刪除旅行">${deleteIcon}</button>`:''}</div>${renameForm(trip)}${deleteReview===trip.id?`<div class="trip-delete-review"><p>將「${esc(trip.title)}」移到已刪除？你可以恢復，同行者暫時無法查看。</p><div><button type="button" class="plain" data-delete-cancel>取消</button><button type="button" class="plain danger" data-delete-confirm="${esc(trip.id)}">確認刪除</button></div></div>`:''}</article>`;
  const displayed=renameDraft&&!trips.some(trip=>trip.id===renameDraft.id)?[...trips,renameDraft.trip]:trips;
  $('trip-library').innerHTML=groupTripsByMonth(displayed).map(group=>`<section class="trip-month-group"><h2>${esc(group.label)}<span>${group.trips.length} 趟旅行</span></h2><div class="trip-month-cards">${group.trips.map(card).join('')}</div></section>`).join('');
  $('trip-library-empty').hidden=trips.length>0||!!renameDraft||!ready;
  $('trip-list-count').textContent=ready?String(trips.length):'';
  $('trip-deleted-count').textContent=String(deletedTrips.length);
  $('trip-deleted-library').innerHTML=deletedTrips.map(trip=>`<article class="trip-deleted-card"><strong>${esc(trip.title)}</strong><small>${esc(tripDateLabel(trip))}</small><button type="button" class="secondary" data-trip-restore="${esc(trip.id)}" aria-label="恢復旅行：${esc(trip.title)}">恢復旅行</button></article>`).join('')||'<p class="trip-empty-deleted">目前沒有已刪除的旅行。</p>';
  $('trip-deleted').hidden=!ready;
  lock();
  if(focusKey&&deleteReview)$('trip-library').querySelector(`[${focusKey}]`)?.focus();
  if(renameFocus&&renameDraft){const input=$('trip-library').querySelector('[data-rename-input]');input?.focus();if(Number.isInteger(selection[0])&&Number.isInteger(selection[1]))input?.setSelectionRange?.(...selection);}
 };
 const focusTrash=id=>[...$('trip-library').querySelectorAll('[data-trip-delete]')].find(button=>button.dataset.tripDelete===id)?.focus();
 const switchAllowed=(allowCreateDraft=false,allowRenameDraft=false)=>{
  captureRename();
  if(renameDraft&&!allowRenameDraft){status('請先儲存或取消修改中的旅行名稱，再切換或管理旅行。',true);return false;}
  if(createDirty&&!allowCreateDraft){status('請先完成或取消建立中的旅行，再切換或管理其他旅行。',true);return false;}
  if(canSwitch())return true;
  status('請先儲存或取消目前的編輯，再切換或管理旅行。',true);
  return false;
 };
 function clear(){
  stateEpoch++;invalidateFlight();
  trips=[];deletedTrips=[];currentId='';currentTitle='';currentMetadata=null;ready=false;creationAttempt=null;deleteReview='';reviewedTrip=null;createDirty=false;renameDraft=null;catalogueStale=true;catalogueAuthoritative=false;catalogueLoadedAt=null;cache=null;cacheEmail='';sessionEmail='';
  $('trip-create-panel').hidden=true;$('trip-create-form').reset?.();$('trip-create-error').textContent='';$('trip-current-title').textContent='選擇或建立一趟旅行';$('trip-account-email').textContent='尚未登入';$('trip-sign-out').hidden=true;
  status('');render();setPending(false);
 }
 const authFailure=error=>{
  if(error?.status!==401&&error?.status!==403)return false;
  try{cache?.clearAccount();}catch{}
  clear();onAuthFailure(error);status(error.status===401?'登入已失效，請重新登入。':'無法讀取這個帳號的旅行，請重新登入。',true);return true;
 };
 async function refresh({force=true,background=false,internal=false}={}){
  if(pending&&!internal)return;
  if(!force&&catalogueAuthoritative&&!catalogueStale&&catalogueLoadedAt!==null&&now()-catalogueLoadedAt<60000)return {email:sessionEmail,trips,deletedTrips};
  if(catalogueFlight&&!force)return catalogueFlight.promise;
  if(force)invalidateFlight();
  const generation=++catalogueGeneration,epoch=stateEpoch,previouslyReady=ready;
  const flight={generation,promise:null};catalogueFlight=flight;
  if(!internal){
   if(!ready)catalogueStatus('正在讀取我的旅行…',false,true);
   else if(!background)catalogueStatus('正在更新旅行清單…',false,true);
  }
  flight.promise=(async()=>{
   try{
    const data=await request();
    if(generation!==catalogueGeneration||epoch!==stateEpoch)return;
    if(!Array.isArray(data?.trips)||data.deletedTrips!==undefined&&!Array.isArray(data.deletedTrips)||typeof data.email!=='string'||!data.email.trim())throw Error('旅行清單回應不完整，請重新載入。');
    if(sessionEmail&&data.email.trim().toLowerCase()!==sessionEmail){const error=Error('登入帳號已變更，請重新登入。');error.status=401;throw error;}
    trips=data.trips.map(record=>updateCurrentTripRecord(record,currentMetadata));deletedTrips=data.deletedTrips||[];ready=true;catalogueStale=false;catalogueAuthoritative=true;catalogueLoadedAt=now();
    if(deleteReview&&!trips.some(trip=>trip.id===deleteReview)){deleteReview='';reviewedTrip=null;}
    if(renameDraft&&!trips.some(trip=>trip.id===renameDraft.id))renameDraft.error='這趟旅行已不在最新清單。請先複製名稱，再取消編輯。';
    if(data.email)$('trip-account-email').textContent=demoMode?'此瀏覽器的示範資料':data.email;
    persistCatalogue();render();catalogueStatus('');return data;
   }catch(error){
    if(generation!==catalogueGeneration||epoch!==stateEpoch)return;
    if(!authFailure(error)){
     catalogueStale=true;lock();
     if(!internal)catalogueStatus(previouslyReady?'顯示上次的旅行清單，連線失敗，請稍後重新載入。':error.message||'無法讀取旅行，請重試。',true,!background);
    }
    if(internal)throw error;
   }finally{if(catalogueFlight===flight)catalogueFlight=null;}
  })();
  return flight.promise;
 }
 async function select(trip){
  if(pending||!trip||!switchAllowed())return;
  const epoch=stateEpoch;
  setPending(true);status('正在開啟旅行…');
  try{await onSelect(trip.id,trip);}
  catch(error){if(epoch===stateEpoch)status(error.message||'無法開啟旅行，請重試。',true);}
  finally{if(epoch===stateEpoch)setPending(false);}
 }
 function enter(){
  return refresh({force:false,background:ready});
 }
 function setCurrent(value){
  const id=typeof value==='string'?value:value?.id||'';
  if(id!==currentId)currentMetadata=null;
  currentId=id;
  if(value&&typeof value==='object'&&Number.isSafeInteger(value.revision)&&value.revision>=0&&(!currentMetadata||value.revision>=currentMetadata.revision))currentMetadata={...value};
  if(value&&typeof value==='object')trips=trips.map(record=>updateCurrentTripRecord(record,value));
  currentTitle=typeof value==='object'&&value?value.title||'':trips.find(trip=>trip.id===currentId)?.title||'';
  $('trip-current-title').textContent=currentTitle||'選擇或建立一趟旅行';
  render();
 }
 function setSession(session){
  const email=typeof session?.email==='string'?session.email.trim().toLowerCase():'';
  if(sessionEmail&&email!==sessionEmail)clear();
  sessionEmail=email;
  $('trip-account-email').textContent=demoMode?'此瀏覽器的示範資料':session?.email||'尚未登入';
  $('trip-sign-out').hidden=!session?.logoutUrl;
  if(session?.logoutUrl)$('trip-sign-out').href=session.logoutUrl;
  lock();
 }
 function setCache(adapter){
  if(ready&&cacheEmail===sessionEmail){cache=adapter;return;}
  cache=adapter;cacheEmail=sessionEmail;
  if(!sessionEmail||!adapter)return;
  let saved;try{saved=adapter.readCatalogue();}catch{return;}
  if(!Array.isArray(saved?.trips)||!Array.isArray(saved.deletedTrips))return;
  trips=saved.trips;deletedTrips=saved.deletedTrips;ready=true;catalogueStale=true;catalogueAuthoritative=false;catalogueLoadedAt=null;
  render();catalogueStatus('已顯示上次的旅行清單，背景更新中');
 }
 function openRename(id){
  if(pending)return false;
  if(renameDraft?.id===id){$('trip-library').querySelector('[data-rename-input]')?.focus();return true;}
  if(!switchAllowed())return false;
  const trip=trips.find(item=>item.id===id);
  if(!trip||!['owner','editor'].includes(trip.role)){status('只有旅行擁有者及可編輯的同行者能修改名稱。',true);return false;}
  if(catalogueStale||!catalogueAuthoritative){status('請先更新旅行清單，再修改名稱。',true);return false;}
  if(!Number.isSafeInteger(trip.revision)||trip.revision<0){status('旅行版本不完整，請重新載入清單後再試。',true);return false;}
  deleteReview='';reviewedTrip=null;
  renameDraft={id,trip:{...trip},title:trip.title,baseTitle:trip.title,revision:trip.revision,role:trip.role,dirty:false,uncertain:false,error:'',remote:null,attempt:null};
  render();const input=$('trip-library').querySelector('[data-rename-input]');input?.focus();input?.select?.();return true;
 }
 function renameMetadata(data,id){
  if(data?.trip?.id!==id||typeof data.trip.title!=='string'||!data.trip.title.trim()||data.trip.title.length>120||!Number.isSafeInteger(data.revision)||data.revision<0)return null;
  let trip;try{trip={id,...validateNewTrip(data.trip)};}catch{return null;}
  return {trip,revision:data.revision,...(['owner','editor','viewer'].includes(data.role)?{role:data.role}:{})};
 }
 function rememberRename(result){
  const metadata={...result.trip,revision:result.revision};
  trips=trips.map(record=>record.id===metadata.id?updateCurrentTripRecord(record,metadata):record);
  if(currentId===metadata.id){
   currentMetadata=updateCurrentTripRecord(currentMetadata||{id:currentId},metadata);
   currentTitle=trips.find(trip=>trip.id===currentId)?.title||metadata.title;$('trip-current-title').textContent=currentTitle;
  }
  try{
   const saved=cache?.readTrip?.(metadata.id);
   if(saved&&Number.isSafeInteger(saved.revision)&&saved.revision<=result.revision)cache?.writeTrip?.(metadata.id,{...saved,trip:{...saved.trip,title:metadata.title}});
  }catch{}
  catalogueLoadedAt=null;persistCatalogue();
 }
 async function finishRename(result){
  const epoch=stateEpoch;rememberRename(result);renameDraft=null;render();status('旅行名稱已更新。');
  try{await onRenamed(result);}catch{if(epoch===stateEpoch)status('名稱已儲存，請重新載入確認畫面。',true);}
 }
 async function useRemoteRename(){
  if(pending||!renameDraft?.remote||!switchAllowed(false,true))return;
  const epoch=stateEpoch,result=renameDraft.remote;invalidateFlight();setPending(true);
  try{await finishRename(result);}finally{if(epoch===stateEpoch)setPending(false);}
 }
 async function saveRename(overwrite=false){
  if(pending||!renameDraft||!switchAllowed(false,true))return;
  captureRename();
  const record=trips.find(trip=>trip.id===renameDraft.id);
  if(!record||!['owner','editor'].includes(record.role)||!catalogueAuthoritative){renameDraft.error='目前無法修改這趟旅行，請先更新清單或取消編輯。';render();return;}
  const title=renameDraft.title.trim();
  if(!title||title.length>120){renameDraft.error='請填寫 1–120 字的旅行名稱。';render();return;}
  if(renameDraft.remote){
   if(!overwrite)return;
   if(title===renameDraft.remote.trip.title){await useRemoteRename();return;}
   renameDraft.baseTitle=renameDraft.remote.trip.title;renameDraft.revision=renameDraft.remote.revision;renameDraft.attempt=null;renameDraft.remote=null;
  }
  if(title===renameDraft.baseTitle&&!renameDraft.uncertain){renameDraft=null;render();status('');return;}
  const body={id:renameDraft.id,title,baseTitle:renameDraft.baseTitle,revision:renameDraft.revision},fingerprint=JSON.stringify(body);
  if(renameDraft.attempt?.fingerprint!==fingerprint)renameDraft.attempt={fingerprint,id:crypto.randomUUID()};
  body.mutationId=renameDraft.attempt.id;
  const epoch=stateEpoch;invalidateFlight();setPending(true);renameDraft.error='';status('正在儲存旅行名稱…');
  try{
   const data=await request({method:'PATCH',headers:{'Content-Type':'application/json','X-Trip-Client':'multi-1'},body:JSON.stringify(body)});
   if(epoch!==stateEpoch)return;
   const result=renameMetadata(data,body.id);
   if(data?.ok!==true||!result||!['owner','editor'].includes(result.role))throw Error('名稱已送出，但回應不完整。請重試或重新載入確認。');
   await finishRename(result);
  }catch(error){
   if(epoch!==stateEpoch)return;
   if(authFailure(error))return;
   const remote=error.status===409?renameMetadata(error.data||error.body,body.id):null;
   catalogueStale=true;catalogueLoadedAt=null;
   if(remote){
    renameDraft.remote=remote;renameDraft.uncertain=false;renameDraft.error='名稱已被其他裝置更新，請選擇要使用的名稱。';rememberRename(remote);
   }else{
    renameDraft.uncertain=true;renameDraft.dirty=true;renameDraft.error=error.message||'名稱暫時無法儲存，請重試。';invalidateCacheCatalogue();
   }
   render();status(renameDraft.error,true);
  }finally{if(epoch===stateEpoch){setPending(false);if(renameDraft)focusRename();}}
 }
 const showCreate=()=>{
  if(pending||!switchAllowed(true))return;
  if(!sessionEmail){status('請先登入，再建立旅行。',true);return;}
  $('trip-create-panel').hidden=false;
  $('trip-create-name').focus();
 };
 async function mutate(trip,action){
  if(pending||!switchAllowed())return;
  if(catalogueStale||!catalogueAuthoritative){status('請先重新載入旅行清單，確認最新內容後再操作。',true);return;}
  let body;try{body=tripMutation(trip,action);}catch(error){status(error.message,true);return;}
  const epoch=stateEpoch;invalidateFlight();
  setPending(true);status(action==='delete'?'正在刪除旅行…':'正在恢復旅行…');
  try{
   const data=await request({method:action==='delete'?'DELETE':'PUT',headers:{'Content-Type':'application/json','X-Trip-Client':'multi-1'},body:JSON.stringify(body)});
   if(epoch!==stateEpoch)return;
   if(data?.ok!==true||data.id!==trip.id)throw Error('操作回應不完整，請重新載入清單確認。');
   const wasCurrent=action==='delete'&&currentId===trip.id;
   deleteReview='';reviewedTrip=null;catalogueStale=true;catalogueLoadedAt=null;
   if(action==='delete')trips=trips.filter(item=>item.id!==trip.id);else deletedTrips=deletedTrips.filter(item=>item.id!==trip.id);
   if(action==='delete')try{cache?.deleteTrip(trip.id);}catch{}
   persistCatalogue();
   if(wasCurrent)setCurrent('');else render();
   try{await refresh({force:true,internal:true});if(epoch!==stateEpoch)return;status(action==='delete'?'旅行已移到已刪除，可以隨時恢復。':'旅行已恢復，原本有效的同行者邀請也會恢復。');}
   catch(error){if(epoch!==stateEpoch)return;catalogueStale=true;status(`旅行已${action==='delete'?'刪除':'恢復'}，但清單更新失敗。請重新載入。`,true);}
   if(wasCurrent)await onDelete(trip.id);
  }catch(error){
   if(epoch!==stateEpoch)return;
   if(authFailure(error))return;
   deleteReview='';reviewedTrip=null;catalogueStale=true;catalogueLoadedAt=null;invalidateCacheCatalogue();
   if(error.status===409){
    let reloaded=false;try{reloaded=!!await refresh({force:true,internal:true});}catch{}
    if(epoch!==stateEpoch)return;
    status(reloaded?'旅行已被其他裝置更新。已重新載入清單，請確認內容後再操作。':'旅行已被其他裝置更新，但清單暫時無法載入。請先重新載入清單再操作。',true);
   }else status(error.message||'無法完成操作，請重新載入清單後再試。',true);
   render();
  }finally{if(epoch===stateEpoch)setPending(false);}
 }
 $('trips-reload').addEventListener('click',()=>void refresh({force:true}));
 $('trip-create-open').addEventListener('click',showCreate);
 $('trip-empty-create').addEventListener('click',showCreate);
 $('trip-create-cancel').addEventListener('click',()=>{
  if(pending)return;
  createDirty=false;$('trip-create-panel').hidden=true;$('trip-create-error').textContent='';
 });
 for(const type of ['input','change'])$('trip-create-form').addEventListener(type,()=>{createDirty=true;});
 $('trip-library').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||pending)return;
  if(button.hasAttribute('data-rename-cancel')){renameDraft=null;render();status('');return;}
  if(button.hasAttribute('data-rename-remote')){void useRemoteRename();return;}
  if(button.hasAttribute('data-rename-mine')){void saveRename(true);return;}
  if(button.hasAttribute('data-trip-rename')){openRename(button.dataset.tripRename);return;}
  if(button.hasAttribute('data-delete-cancel')){const id=deleteReview;deleteReview='';reviewedTrip=null;render();focusTrash(id);return;}
  const id=button.dataset.tripId||button.dataset.tripDelete||button.dataset.deleteConfirm,trip=trips.find(item=>item.id===id);
  if(button.hasAttribute('data-trip-delete')){
   if(trip?.role!=='owner'||!switchAllowed())return;
   if(catalogueStale||!catalogueAuthoritative){status('請先重新載入旅行清單，確認最新內容後再操作。',true);return;}
   reviewedTrip={...trip};
   deleteReview=id;render();$('trip-library').querySelector('[data-delete-cancel]')?.focus();return;
  }
  if(button.hasAttribute('data-delete-confirm')){void mutate(reviewedTrip?.id===id?reviewedTrip:trip,'delete');return;}
  if(button.hasAttribute('data-trip-id'))void select(trip);
 });
 for(const type of ['input','change'])$('trip-library').addEventListener(type,event=>{
  if(event.target.hasAttribute?.('data-rename-input'))captureRename();
 });
 $('trip-library').addEventListener('submit',event=>{
  if(!event.target.hasAttribute?.('data-trip-rename-form'))return;
  event.preventDefault();void saveRename();
 });
 $('trip-deleted-library').addEventListener('click',event=>{
  const button=event.target.closest('[data-trip-restore]');
  if(button)void mutate(deletedTrips.find(trip=>trip.id===button.dataset.tripRestore),'restore');
 });
 $('trip-create-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(pending||!switchAllowed(true))return;
  if(!sessionEmail){status('請先登入，再建立旅行。',true);return;}
  let input;
  try{input=validateNewTrip({title:$('trip-create-name').value,startDate:$('trip-create-start').value,endDate:$('trip-create-end').value,timezone:$('trip-create-timezone').value});}
  catch(error){$('trip-create-error').textContent=error.message;return;}
  const fingerprint=JSON.stringify(input);
  if(creationAttempt?.fingerprint!==fingerprint)creationAttempt={fingerprint,id:crypto.randomUUID()};
  const epoch=stateEpoch;let created=false;invalidateFlight();
  setPending(true);$('trip-create-error').textContent='';status('正在建立旅行…');
  try{
   const data=await request({method:'POST',headers:{'Content-Type':'application/json','X-Trip-Client':'multi-1'},body:JSON.stringify({...input,creationId:creationAttempt.id})});
   if(epoch!==stateEpoch)return;
   if(!data?.trip?.id)throw Error('旅行已送出，但回應不完整，請重新載入清單確認。');
   creationAttempt=null;createDirty=false;created=true;catalogueLoadedAt=null;
   const createdTrip={...data.trip,revision:data.revision??0,role:'owner',canEdit:true,canShare:true};
   trips=[createdTrip,...trips.filter(trip=>trip.id!==createdTrip.id)];ready=true;persistCatalogue();render();
   $('trip-create-panel').hidden=true;status('已建立旅行，正在開啟…');
   await onSelect(createdTrip.id,createdTrip);
  }catch(error){
   if(epoch!==stateEpoch)return;
   if(authFailure(error))return;
   if(!created){catalogueStale=true;catalogueLoadedAt=null;invalidateCacheCatalogue();}
   status(error.message||(created?'旅行已建立，但無法開啟。請從清單重試。':'無法建立旅行，請重試。'),true);
  }
  finally{if(epoch===stateEpoch)setPending(false);}
 });
 const todayDate=new Date(),today=`${todayDate.getFullYear()}-${String(todayDate.getMonth()+1).padStart(2,'0')}-${String(todayDate.getDate()).padStart(2,'0')}`;
 $('trip-create-start').value=today;$('trip-create-end').value=today;
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Taipei';
 const timezones=[...new Set([zone,'Asia/Taipei','Asia/Tokyo','Asia/Seoul','Asia/Bangkok','Europe/London','Europe/Paris','America/New_York','America/Los_Angeles','Australia/Sydney','UTC'])];
 const zoneNames={'Asia/Taipei':'台灣 · 台北','Asia/Tokyo':'日本 · 東京','Asia/Seoul':'韓國 · 首爾','Asia/Bangkok':'泰國 · 曼谷','Europe/London':'英國 · 倫敦','Europe/Paris':'法國 · 巴黎','America/New_York':'美國 · 紐約','America/Los_Angeles':'美國 · 洛杉磯','Australia/Sydney':'澳洲 · 雪梨','UTC':'UTC'};
 const otherZones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone').filter(value=>!timezones.includes(value)):[];
 const zoneOptions=values=>values.map(value=>`<option value="${esc(value)}">${esc(zoneNames[value]||value)}</option>`).join('');
 $('trip-create-timezone').innerHTML=zoneOptions(timezones)+(otherZones.length?`<optgroup label="其他目的地時區">${zoneOptions(otherZones)}</optgroup>`:'');
 $('trip-create-timezone').value=zone;
 return {enter,refresh,setCurrent,setSession,setCache,clear,openRename,get pending(){return pending;},get dirty(){captureRename();return createDirty||!!renameDraft?.dirty;}};
}
