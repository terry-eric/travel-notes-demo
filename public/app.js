import {appBase,apiPath,tripApiPath,selectedTripId,demoMode} from './runtime.js';
import {initTripManager} from './trip-manager.js';
import {initSharing} from './sharing.js';
import {parseMapsShare} from './maps-link.js';
import {readRoute,routeUrl,boundedSelection} from './routes.js';
import {routeLocation,routeLeg,directionsUrl,legSignature,savedTravelMinutes,clearStaleTravel,pushSchedule} from './transport.js';
import {readCloudJson,fetchEmbedConfig,fetchTripUpdate,loadVerifiedTripSnapshot} from './cloud.js';
import {createTravelCache} from './cache.js';
import {createAutoSync} from './sync.js';
import {mergeTrip} from './merge.js';
import {createDraftStore} from './drafts.js';
import {initConflicts} from './conflicts.js';
import {createMapFrame,placeEmbedUrl} from './map-frame.js';
import {durationParts,durationMinutes,formatDuration} from './duration.js';
import {tagCategory,tagOptions} from './tags.js';
import {renderStopAvatar,stopAvatarLabel} from './stop-avatar.js';
import {initReorder,moveStop} from './reorder.js';
import {initImport,insertImported} from './import.js';
const resolvedPlaces=new Map(),placeRequests=new Map(),placeErrors=new Map();
let transportLoading=false;
let embedKey='',embedState='loading',embedRequest=null,authExpired=false,transportIndex=0,transportMode='walking';
let days=[],currentTrip=null,previous=null,revision=0,ready=false,busy=false,editing=null,pending=null,conflict=false;
let access={canEdit:false,canShare:false};
let travelCache=null,cacheEmail='',identityEpoch=0,permissionEpoch=0,bootRequest=null,loadRequest=null,sessionCheck=null;
let renameSyncNeeded=false;
const sessionChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('trip-session:'+appBase):null;
const tripId=selectedTripId;
let editorScope=null,editorDirty=false,newStopId='',transportScope=null,transportDirty=false,stayDraft=null,draftStore=null,recovery=null;
const initialRoute=readRoute(location.href);
let activeDay=initialRoute.day,activeStop=initialRoute.stop,currentPage=initialRoute.page;
let editorReadOnly=false,dragging=false;
const $=id=>document.getElementById(id);
const sharing=initSharing();
const tripManager=initTripManager({apiPath,readJson:readCloudJson,canSwitch:canSwitchTrip,onPendingChange(value){lock();if(!value&&renameSyncNeeded){renameSyncNeeded=false;if(ready)autoSync.start();else void boot();}},onRenamed:renameSelectedTrip,onAuthFailure:catalogueAuthFailure,onSelect:id=>{if(!canSwitchTrip())return;autoSync.stop();location.assign(routeUrl('overview',0,0,appBase,id));},onDelete:id=>{if(id!==tripId)return;clearUnavailableTrip();location.assign(routeUrl('trips',0,0,appBase,''));}});
function renameSelectedTrip(data){
 if(data.trip?.id!==tripId||data.revision<revision)return;
 permissionEpoch++;autoSync.stop();renameSyncNeeded=true;
 if(loadRequest?.epoch===identityEpoch){identityEpoch++;busy=false;ready=false;}
 if(currentTrip)currentTrip={...currentTrip,title:data.trip.title};
 renderTripMeta();
}
function scopeSnapshot(){return {tripId,trip:currentTrip,days:structuredClone(days),revision};}
function applyTripRole(role){
 if(!['owner','editor','viewer'].includes(role)||role===access.role)return;
 access={...access,role,canEdit:role!=='viewer',canShare:role==='owner'};sharing.setSession(access);tripManager.setSession(access);
 if(!access.canEdit)persistDraft();showPage(currentPage,{record:false,focus:false});lock();
 notice(access.canEdit?'你的行程權限已更新，可以一起編輯。':'權限已改成只能查看，未儲存的草稿保留在這個裝置。');
}
function canSwitchTrip(){return !busy&&!pending&&!conflict&&!dragging&&!editorDirty&&!transportDirty&&!stayDraft&&!importer.dirty&&!recovery;}
function bindAccount(session){
 const email=session.email.toLowerCase();
 if(access.email&&access.email.toLowerCase()!==email){forgetAccount();draftStore=null;recovery=null;location.reload();return;}
 access=session;
 permissionEpoch++;
 if(!travelCache||cacheEmail!==email){
  let storage;try{storage=localStorage;}catch{}
  travelCache=createTravelCache({storage,appBase,email});cacheEmail=email;
 }
 tripManager.setSession(session);tripManager.setCache(travelCache);sharing.setSession(session);
}
function cacheConfirmed(data){if(travelCache&&data?.trip?.id===tripId)travelCache.writeTrip(tripId,data);}
function restorePlaces(){
 const saved=travelCache?.readPlaces(tripId),urls=new Set(days.flatMap(day=>day.stops.map(stop=>stop.mapUrl)));
 if(saved)for(const [url,place] of Object.entries(saved))if(urls.has(url))resolvedPlaces.set(url,place);
}
function forgetAccount(){
 identityEpoch++;renameSyncNeeded=false;travelCache?.clearAccount();clearUnavailableTrip();tripManager.clear();travelCache=null;
 draftStore=null;recovery=null;editorDirty=transportDirty=false;editorScope=transportScope=null;editing=null;stayDraft=null;pending=null;conflict=false;
 if($('import-dialog').open)importer.close();for(const id of ['editor','transport-dialog','conflict-dialog'])if($(id).open)$(id).close();$('draft-recovery').hidden=true;
 access={canEdit:false,canShare:false};cacheEmail='';embedKey='';embedState='auth';resolvedPlaces.clear();placeErrors.clear();placeRequests.clear();busy=false;lock();
}
function catalogueAuthFailure(error){
 forgetAccount();authExpired=true;$('save-status').textContent='需要重新登入';$('sync-error-text').textContent=error.message;$('retry').textContent='重新登入';$('sync-error').hidden=false;
}
function renderTripMeta(){
 tripManager.setCurrent(currentTrip?{...currentTrip,revision}:null);
 $('trip-title').textContent=currentTrip?.title||'每一趟旅行，都從這裡開始。';
 $('trip-eyebrow').textContent='YOUR TRAVEL JOURNAL';
 $('trip-summary').textContent=currentTrip?'安排每日行程，邀請同行的人一起規劃。':'建立自己的旅行，或開啟同行者邀請的旅行。';
 $('trip-dates').textContent=currentTrip?`${currentTrip.startDate.replaceAll('-','/')} — ${currentTrip.endDate.replaceAll('-','/')}`:'選擇或建立一趟旅行';
 $('trip-duration').hidden=!currentTrip;$('trip-duration').textContent=currentTrip?`${days.length} 天 ${Math.max(0,days.length-1)} 夜`:'';
 $('trip-region').hidden=true;$('trip-photo').hidden=true;$('trip-photo-credit').hidden=true;$('trip-footer-note').hidden=currentPage==='trips';
 $('trip-footer-note').textContent=demoMode?'示範資料只儲存在此瀏覽器；請在 Google Maps 確認地點、交通與營業資訊。':'旅程資料與同行者權限分別管理；請在 Google Maps 確認地點、交通與營業資訊。';
 $('overview-title').textContent=currentTrip?`我的 ${days.length} 日行程`:'每日行程';
 $('trip-timezone-note').textContent=currentTrip?`行程時間：${currentTrip.timezone||'目的地當地時間'}`:'請建立或選擇旅行';
 $('trip-notes-summary').textContent='出發前確認航班、住宿、預約與票券，預留交通、休息和天候備案。';
 const anchors=days.flatMap(day=>day.stops.filter(stop=>stop.live).map(stop=>`<li><strong>${esc(day.isoDate||day.date)} ${esc(stop.time)}</strong> · ${esc(stop.name)}</li>`));
 $('travel-notes').hidden=false;$('travel-notes').innerHTML=`${anchors.length?`<details open><summary>固定時間的行程</summary><ul>${anchors.join('')}</ul><p>交通時間順延時會保留這些行程的原定時間。</p></details>`:''}<details open><summary>航班、住宿與預約</summary><p>確認票券、報到時間、住宿地址與預約資訊，將實際抵達與離開時間安排進每日行程。</p></details><details><summary>行李與出發前確認</summary><p>依目的地天候準備衣物、證件與充電設備，保留交通緩衝。地點與所需時間可點開 Google Maps 確認。</p></details>`;
}
function boot(){
 if(bootRequest?.epoch===identityEpoch)return bootRequest.promise;
 const request={epoch:identityEpoch,promise:null};bootRequest=request;
 request.promise=bootAccount(request.epoch).finally(()=>{if(bootRequest===request)bootRequest=null;});return request.promise;
}
async function bootAccount(epoch){
 if(tripId){
  await load();
  if(epoch!==identityEpoch)return;
  if(!travelCache&&!authExpired){try{const session=await readCloudJson(await fetch(apiPath('/api/session'),{cache:'no-store',signal:AbortSignal.timeout(15000)}));if(epoch!==identityEpoch)return;bindAccount(session);}catch{}}
  if(travelCache)await tripManager.enter();
  if(epoch!==identityEpoch)return;
  if(ready)autoSync.start();return;
 }
 try{
  const session=await readCloudJson(await fetch(apiPath('/api/session'),{cache:'no-store',signal:AbortSignal.timeout(15000)}));if(epoch!==identityEpoch)return;
  bindAccount(session);lock();renderTripMeta();
  $('save-status').textContent='我的旅行 · 背景更新中';
  const catalogue=await tripManager.enter();
  if(epoch!==identityEpoch)return;
  if(!catalogue){$('save-status').textContent='我的旅行';return;}
  if(currentPage!=='trips'&&catalogue.trips.length===1&&catalogue.trips[0].id==='legacy-hokkaido-2026'){location.replace(routeUrl(currentPage,activeDay,activeStop,appBase,catalogue.trips[0].id));return;}
  $('save-status').textContent=currentPage==='trips'?'已載入我的旅行':'在「我的旅行」選擇或建立旅行';
 }catch(error){if(epoch!==identityEpoch)return;if(error.status===401||error.status===403)forgetAccount();$('save-status').textContent='無法讀取我的旅行';$('sync-error-text').textContent=error.message;$('sync-error').hidden=false;authExpired=error.status===401;$('retry').textContent=authExpired?'重新登入':'重新連線';}
}
const conflictUI=initConflicts({onResolve:resolveConflicts,onLater:persistDraft,onChoice:choices=>{if(pending?.merge){pending.merge.choices=choices;persistDraft();}}});
let syncInterrupted=false;
const autoSync=createAutoSync({
 getState:()=>({ready,busy:busy||tripManager.pending,pending,conflict,revision,editing:dragging||$('editor').open||$('import-dialog').open||$('transport-dialog').open||!!stayDraft}),
 async fetchSnapshot(version){
  const epoch=identityEpoch,permissions=permissionEpoch,isCurrent=()=>epoch===identityEpoch&&permissions===permissionEpoch;
  try{return await fetchTripUpdate(version,fetch,applyTripRole,isCurrent);}catch(error){if(isCurrent())throw error;return null;}
 },
 isActive:()=>!document.hidden&&navigator.onLine,
 apply(data){cacheConfirmed(data);days=data.days;currentTrip=data.trip||currentTrip;revision=data.revision;previous=data.previous;renderTripMeta();refresh();$('save-status').textContent='已自動同步最新行程';notice('已同步其他裝置或同行者的更新');},
 onDeferred(){if(!syncInterrupted)$('save-status').textContent='有新版本，完成編輯後同步';notice('其他人已更新行程，正在編輯的內容會保留。');},
 onHealthy(){if(syncInterrupted){syncInterrupted=false;$('save-status').textContent='已恢復自動同步';}},
 onError(error){
  syncInterrupted=true;
  if(error.status===401||error.status===403){if(error.status===401)forgetAccount();else{travelCache?.deleteTrip(tripId);travelCache?.clearCatalogue();clearUnavailableTrip();}authExpired=error.status===401;$('save-status').textContent=authExpired?'需要重新登入':'旅行已刪除或無法存取';$('sync-error-text').textContent=error.message;$('retry').textContent=authExpired?'重新登入':'重新確認權限';$('sync-error').hidden=false;lock();if(!authExpired)void tripManager.refresh();}
  else $('save-status').textContent='同步暫時中斷，將自動重試';
 }
});
const importer=initImport({canWrite:canChange,getScope:scopeSnapshot,onSave:importRows,onChange:persistDraft,onClose:()=>void autoSync.tick()});
initReorder($('timeline'),{canStart:canChange,onStart:()=>{dragging=true;return {...scopeSnapshot(),day:activeDay};},onFinish:()=>{dragging=false;void autoSync.tick();},onMove:reorderStop});
const placeFrame=createMapFrame({getFrame:()=>$('map'),status:$('place-map-status'),isActive:()=>currentPage==='map'});
const transportFrame=createMapFrame({getFrame:()=>$('transport-map'),status:$('transport-placeholder'),isActive:()=>$('transport-dialog').open});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const maps=q=>`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const clone=value=>structuredClone(value);
async function ensureLocation(stop,stops,retry=false){
 const known=routeLocation(stop,stops,resolvedPlaces);if(known||!stop?.mapUrl)return known;
 const link=stop.mapUrl;if(placeRequests.has(link))return placeRequests.get(link);
 const epoch=identityEpoch,email=access.email,cache=travelCache;
 if(placeErrors.has(link)&&!retry)return '';
 const task=(async()=>{try{
  const data=await readCloudJson(await fetch(apiPath('/api/maps-resolve'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:link}),signal:AbortSignal.timeout(10000)}));
  if(typeof data.query!=='string'||!data.query.trim())throw Error('分享連結沒有可用地點。');
  if(epoch!==identityEpoch||email!==access.email)return '';
  if(!days.some(day=>day.stops.some(item=>item.mapUrl===link)))return data.query;
  resolvedPlaces.set(link,{query:data.query});placeErrors.delete(link);
  cache?.writePlaces(tripId,[...resolvedPlaces].filter(([url])=>days.some(day=>day.stops.some(item=>item.mapUrl===url))));return data.query;
 }catch(e){if(epoch===identityEpoch)placeErrors.set(link,e.message);return '';}finally{if(placeRequests.get(link)===task)placeRequests.delete(link);}})();
 placeRequests.set(link,task);return task;
}
async function hydrateTransport(index,retry=false){
 const day=activeDay,stops=days[day]?.stops||[];if(!stops[index]){transportLoading=false;return;}transportLoading=true;renderTransport();
 await Promise.all([ensureLocation(stops[index],stops,retry),index>0?ensureLocation(stops[index-1],stops,retry):Promise.resolve('')]);
 if(day===activeDay&&index===transportIndex){transportLoading=false;if($('transport-dialog').open)renderTransport();}
}
function durationPicker(value,label,prefix){
 const parts=durationParts(value),minutes=[0,15,30,45];
 // Keep earlier custom values until the user explicitly chooses a new duration.
 if(!minutes.includes(parts.minutes))minutes.push(parts.minutes);
 return `<div class="duration-picker" data-duration-picker><select id="${prefix}-hours" name="durationHours" aria-label="${esc(label)}的停留小時" ${prefix==='field-duration'?'':'data-write'}><option value="" ${parts.hours===''?'selected':''}>未設定</option>${Array.from({length:25},(_,h)=>`<option value="${h}" ${parts.hours===h?'selected':''}>${h} 小時</option>`).join('')}</select><select id="${prefix}-minutes" name="durationMinutes" aria-label="${esc(label)}的停留分鐘" ${prefix==='field-duration'?'':'data-write'}>${minutes.sort((a,b)=>a-b).map(m=>`<option value="${m}" ${parts.minutes===m?'selected':''} ${parts.hours===24&&m!==0?'disabled':''}>${m} 分鐘${m%15?'（原設定）':''}</option>`).join('')}</select></div>`;
}
function readStay(form){return durationMinutes(form.elements.durationHours.value,form.elements.durationMinutes.value);}
const pageLabels={trips:'我的旅行',overview:'行程總覽',daily:'每日行程',map:'旅途地圖',notes:'出發前筆記'};
function showPage(page,{record=true,focus=true}={}){
 currentPage=Object.hasOwn(pageLabels,page)?page:'overview';
 document.body.dataset.page=currentPage;
 for(const [key,id] of Object.entries({trips:'trips-panel',overview:'overview',daily:'daily',map:'map-page',notes:'before'}))$(id).hidden=key!==currentPage;
 $('trip-heading').hidden=currentPage!=='overview';$('page-heading').hidden=currentPage==='overview'||currentPage==='trips';
 $('trips-title').tabIndex=-1;
 $('page-title').textContent=pageLabels[currentPage];$('page-title').tabIndex=-1;$('current-page-label').textContent=pageLabels[currentPage];
 document.title=`${pageLabels[currentPage]}｜旅手帖`;
 document.querySelectorAll('[data-page-link]').forEach(link=>{link.href=routeUrl(link.dataset.pageLink,activeDay,activeStop);const selected=link.dataset.pageLink===currentPage;link.classList.toggle('nav-active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
 const canEdit=access.canEdit&&['overview','daily','map'].includes(currentPage);
 for(const id of ['undo','toolbar-add','import-open','gpt-import-open'])$(id).hidden=!canEdit;
 $('sharing-open').hidden=currentPage==='trips'||(demoMode?!access.canEdit:!access.canShare);
 $('trip-photo-credit').hidden=true;$('trip-footer-note').hidden=currentPage==='trips';
 const url=routeUrl(currentPage,activeDay,activeStop);
 if(record&&location.pathname+location.search+location.hash!==url)history.pushState(null,'',url);
 selectStop(activeStop);
 if(record&&currentPage==='trips')void tripManager.enter();
 if(focus){window.scrollTo({top:0,behavior:'instant'});(currentPage==='overview'?$('main'):currentPage==='trips'?$('trips-title'):$('page-title')).focus({preventScroll:true});}
}
function renderMapStops(){
 renderDateTabs('map-day-tabs','map-tab','map-day-panel');
 const stops=days[activeDay]?.stops||[];
 $('map-stops').innerHTML=stops.map((s,i)=>`<button class="map-stop ${s.live===true?'has-stop-avatar ':''}category-${tagCategory(s.tag)}" data-map-stop="${i}" aria-pressed="${i===activeStop}"><span class="map-stop-number">${i+1}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.time||'待安排')}${routeLocation(s,stops,resolvedPlaces)||s.mapUrl?'':' · 尚未設定地點'}</small><span class="tag">${esc(s.tag||'其他')}</span></span>${renderStopAvatar(s)}</button>`).join('')||'<p class="empty">這一天還沒有地點，可到每日行程新增。</p>';
}
function renderDateTabs(container,prefix,panel){
 $(container).innerHTML=days.map((item,i)=>`<button role="tab" id="${prefix}-${i}" aria-label="${esc(item.date)} ${esc(item.week)}" aria-selected="${i===activeDay}" aria-controls="${panel}" tabindex="${i===activeDay?0:-1}" data-tab="${i}" data-tab-prefix="${prefix}"><span class="tab-date">${esc(item.date)}</span><span class="tab-week">${esc(item.week)}</span></button>`).join('');
 $(panel).setAttribute('aria-labelledby',`${prefix}-${activeDay}`);
 requestAnimationFrame(()=>{
  const bar=$(container),tab=bar.querySelector('[aria-selected="true"]');if(!tab||!bar.clientWidth)return;
  const left=tab.getBoundingClientRect().left-bar.getBoundingClientRect().left+bar.scrollLeft,right=left+tab.offsetWidth;
  if(left<bar.scrollLeft)bar.scrollLeft=left;else if(right>bar.scrollLeft+bar.clientWidth)bar.scrollLeft=right-bar.clientWidth;
 });
}
function notice(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('toast').hidden=true,5000);}
function canChange(){return !!tripId&&access.canEdit&&ready&&!busy&&!tripManager.pending&&!pending&&!conflict&&(!recovery||restoringDraft);}
function lock(){
 document.body.classList.toggle('read-only',!access.canEdit);
 document.querySelectorAll('[data-write]').forEach(el=>el.disabled=!canChange());
 $('undo').disabled=!canChange()||!previous;
 $('trip-rename-open').hidden=!currentTrip||!access.canEdit;$('trip-rename-open').disabled=!canChange();
 document.querySelectorAll('#editor input,#editor select,#editor textarea,#search-maps').forEach(el=>el.disabled=editorReadOnly||!canChange());
 $('editor-start-edit').hidden=!editorReadOnly||!access.canEdit;$('editor-start-edit').disabled=!canChange();
 $('save-stop').hidden=editorReadOnly||!access.canEdit;$('save-stop').disabled=busy||!access.canEdit||!ready;
 $('save-stop').textContent=conflict?'處理衝突':pending?'重試儲存':editing?'儲存編輯':'儲存行程';
 $('editor-delete').hidden=editorReadOnly||!editing||!access.canEdit;
 if(editorScope)updateEditorOrder();
 $('editor').classList.toggle('viewing',editorReadOnly);$('search-maps').hidden=editorReadOnly;
 document.querySelectorAll('[data-close]').forEach(el=>el.disabled=busy);
 $('retry').disabled=busy;$('conflict-submit').disabled=busy;$('conflict-later').disabled=busy;
 $('draft-restore').disabled=!access.canEdit||!ready||busy||!recovery;$('draft-discard').disabled=busy;
 importer.lock(busy||!!pending||conflict||!!recovery);lockTransport();
}
function bindDraftStore(){
 let storage,tabId;
 try{storage=localStorage;tabId=sessionStorage.getItem('trip-draft-tab');if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem('trip-draft-tab',tabId);}}catch{storage={getItem(){return null;},setItem(){throw Error('Storage unavailable');},removeItem(){}};tabId='current';}
 draftStore=createDraftStore(storage,`trip-draft-v2:${appBase}:${access.email||'local-preview'}:${tripId}:${tabId}`);recovery=draftStore.read();
 if(!recovery&&tripId==='legacy-hokkaido-2026'){
  const legacy=createDraftStore(storage,`trip-draft-v1:${appBase}:${access.email||'local-preview'}:${tabId}`),old=legacy.read();
  if(old){old.tripId=tripId;for(const part of ['editor','transport','stay','imported'])if(old[part]?.scope)old[part].scope.tripId=tripId;if(old.pending)old.pending.tripId=tripId;if(draftStore.write(old)){legacy.clear();recovery=draftStore.read();}}
 }
 if(recovery&&recovery.tripId!==tripId)recovery=null;$('draft-recovery').hidden=!recovery;
}
function editorFields(){return Object.fromEntries(['name','time','day','order','tag','q','mode','mapUrl','desc'].map(key=>[key,$('field-'+key).value]).concat([['fixed',$('field-fixed').checked],['hours',$('editor-form').elements.durationHours?.value??''],['minutes',$('editor-form').elements.durationMinutes?.value??'0']]));}
function persistDraft(){
 if(!draftStore)return false;
 const editor=editorDirty&&editorScope?{scope:editorScope,editing,newStopId,fields:editorFields()}:null;
 const transport=transportDirty&&transportScope?{scope:transportScope,day:activeDay,id:transportScope.days[activeDay].stops[transportIndex]?.id,mode:transportMode,minutes:$('transport-minutes').value}:null;
 const imported=importer.snapshot();
 if(!editor&&!transport&&!stayDraft&&!pending&&!imported)return recovery?true:draftStore.clear();
 const saved=draftStore.write({tripId,editor,transport,stay:stayDraft,pending,imported});
 if(!saved){const warning='此瀏覽器無法保存草稿，請先儲存再離開';$('save-status').textContent=warning;if($('editor').open)$('form-error').textContent=warning;if($('transport-dialog').open)$('transport-feedback').textContent=warning;if($('conflict-dialog').open)conflictUI.message(warning);}
 return saved;
}
function restoreStayInputs(){
 if(!stayDraft)return;
 for(const [id,value] of Object.entries(stayDraft.values)){const index=days[activeDay].stops.findIndex(s=>s.id===id);if(index<0)continue;const form=$('timeline').querySelector(`[data-stay-form="${index}"]`);if(form){form.elements.durationHours.value=value.hours;form.elements.durationMinutes.value=value.minutes;}}
}
function showConflicts(){if(pending?.merge){const m=pending.merge;conflictUI.show(mergeTrip(pending.base,pending.days,m.remote.days,m.choices).conflicts,m.choices);}}
function mergedSchedule(candidate,remote){
 const before=JSON.stringify(candidate);clearStaleTravel(candidate);
 const notes=new Set();if(before!==JSON.stringify(candidate))notes.add('部分交通時間因路線變動已清除，請重新確認。');
 const prior=new Map(remote.flatMap(d=>d.stops.map(s=>[s.id,s])));
 for(const day of candidate){
  let start=day.stops.length;
  day.stops.forEach((s,i)=>{const old=prior.get(s.id);if(!old)return;if(s.duration!==old.duration)start=Math.min(start,i+1);if(s.travelMinutes!==old.travelMinutes&&s.travelMinutes!==undefined)start=Math.min(start,i);});
  if(start<day.stops.length){const shifted=pushSchedule(day.stops,start);if(shifted.reason)notes.add(shifted.reason);}
 }
 return {days:candidate,reason:[...notes].join(' ')};
}
async function resolveConflicts(choices){
 if(!pending?.merge||busy)return;
 const latest=pending.merge.remote,result=mergeTrip(pending.base,pending.days,latest.days,choices);pending.merge.choices=choices;
 if(result.unresolved.length){conflictUI.show(result.conflicts,choices);conflictUI.message('請為每個衝突選擇保留的版本。');persistDraft();return;}
 const merged=mergedSchedule(result.days,latest.days);pending.base=clone(latest.days);pending.days=merged.days;pending.revision=latest.revision;pending.mutationId=crypto.randomUUID();pending.merge=null;pending.message='已依你的選擇合併並儲存。'+merged.reason;conflict=false;conflictUI.close();persistDraft();await commit(null,null,null,null,true);
}

function renderBoard(){
 $('board').innerHTML=days.map((d,i)=>`<article class="day-card day-summary" style="--day:${esc(d.color)};--tint:${esc(d.tint)}"><button class="day-choice" data-open-day="${i}" aria-label="查看第 ${i+1} 天 ${esc(d.date)} 行程"><span class="day-number">第 ${i+1} 天</span><span class="card-date">${esc(d.date)}</span></button><div class="day-items"><div class="card-stops">${d.stops.map((s,j)=>`<button class="mini-stop ${s.live===true?'has-stop-avatar ':''}category-${tagCategory(s.tag)}" data-details="${j}" data-owner="${i}" data-day="${i}" data-stop="${j}" aria-pressed="${activeDay===i&&activeStop===j}"><time>${esc(s.time)}</time><strong>${esc(s.name)}</strong><span class="tag">${esc(s.tag||'其他')}</span>${renderStopAvatar(s)}</button>`).join('')||'<p class="empty">尚未安排行程</p>'}</div><button class="add-day" data-add="${i}" data-write>＋ 新增行程</button></div></article>`).join('');lock();
}
const transportIcons={
 walking:{label:'步行',shape:'<circle cx="13" cy="4" r="2"/><path d="m7 21 3-6 3-3 1 4 4 5M6 11l4-4 4 1 3 4h3M10 7l-1 7"/>'},
 transit:{label:'大眾運輸',shape:'<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 11h14M12 3v8M8 21l2-3m4 0 2 3"/><circle cx="9" cy="15" r=".7"/><circle cx="15" cy="15" r=".7"/>'},
 driving:{label:'開車',shape:'<path d="m5 9 2-5h10l2 5M4 17H3V9h18v8h-1M7 17h10M6 12h2m8 0h2"/><rect x="4" y="15" width="3" height="5" rx="1"/><rect x="17" y="15" width="3" height="5" rx="1"/>'},
 bicycling:{label:'自行車',shape:'<circle cx="5" cy="16" r="4"/><circle cx="19" cy="16" r="4"/><path d="m5 16 5-8 5 8H5m5-8h6l3 8M8 5h4m3 0h3v3"/>'}
};
function renderTransportRow(stops,index){
 if(index===0)return '';
 const {label,shape}=transportIcons[stops[index].mode]||transportIcons.walking;
 const minutes=savedTravelMinutes(stops,index),time=minutes===null?(access.canEdit?'填寫時間':'查看時間'):minutes+' 分鐘';
 const pair=stops[index-1].name+' → '+stops[index].name;
 return `<div class="transfer-row"><button type="button" class="transfer-button" data-transport="${index}" aria-haspopup="dialog" aria-label="${esc(pair)}：${label}，${time}，查看 Google Maps 交通時間" title="${esc(pair)}"><svg class="transport-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg><span>${label}</span><strong>${time}</strong><svg class="transfer-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg></button></div>`;
}
function setDay(index,stop=0){
 const selected=boundedSelection(days,index,stop);activeDay=index=selected.day;activeStop=selected.stop;
 if(!days.length){$('day-tabs').innerHTML='';$('day-intro').innerHTML='<p>先從「我的旅行」建立或選擇一趟旅行。</p>';$('timeline').innerHTML='';renderMapStops();selectStop(activeStop);lock();return;}
 const d=days[index];
 renderDateTabs('day-tabs','tab','day-panel');
 $('day-intro').innerHTML=`<div class="day-edit-heading"><h3>${esc(d.title||'第 '+(index+1)+' 天')}</h3><button class="primary" data-add="${index}" data-write>＋ 新增行程</button></div><p>${esc(d.intro||'')}</p>`;
 $('timeline').innerHTML=d.stops.map((s,j)=>`${renderTransportRow(d.stops,j)}<article class="stop ${s.live===true?'has-stop-avatar ':''}category-${tagCategory(s.tag)} ${j===activeStop?'selected':''}" id="stop-${j}" data-stop-id="${esc(s.id)}" data-reorder-card data-details="${j}" data-owner="${index}" role="button" tabindex="0" aria-label="${esc([s.name,stopAvatarLabel(s)].filter(Boolean).join('，'))}" aria-describedby="reorder-hint"><div class="stop-body"><div class="stop-card-head"><time class="stop-time">${esc(s.time||'待安排')}</time><span class="tag">${tagCategory(s.tag)==='concert'?'♫ ':''}${esc(s.tag||'其他')}</span>${renderStopAvatar(s)}</div><h3 class="stop-name">${esc(s.name)}</h3>${s.desc?`<p class="stop-description">${esc(s.desc).replace(/\n/g,'<br>')}</p>`:''}<div class="stop-summary"><span>停留 ${formatDuration(s.duration)}</span></div></div></article>`).join('')||'<div class="empty-day"><h3>把喜歡的地方，加進今天。</h3><p>這一天還沒有行程。</p><button class="primary" data-add="'+index+'" data-write>＋ 新增第一個行程</button></div>';
 $('reorder-hint').hidden=!access.canEdit;$('map-details').dataset.details=activeStop;$('map-details').dataset.owner=index;
 $('day-tip').textContent=d.tip;$('toolbar-add').dataset.add=index;renderMapStops();selectStop(activeStop);restoreStayInputs();lock();
}
function selectStop(index){
 const d=days[activeDay];activeStop=boundedSelection(days,activeDay,index).stop;index=activeStop;const s=d?.stops[index];
 document.querySelectorAll('.stop').forEach((el,j)=>{el.classList.toggle('selected',j===index);if(j===index)el.setAttribute('aria-current','true');else el.removeAttribute('aria-current');});
 document.querySelectorAll('.mini-stop').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.day)===activeDay&&Number(el.dataset.stop)===index)));
 document.querySelectorAll('[data-map-stop]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.mapStop)===index)));
 let share='';try{share=parseMapsShare(s?.mapUrl);}catch{}
 const destination=routeLocation(s,d?.stops||[],resolvedPlaces),shareOnly=!!share&&!destination;
 if(!destination&&share)void ensureLocation(s,d.stops).then(query=>{if(query&&days[activeDay]===d&&activeStop===index)selectStop(index);});
 $('map-title').textContent=destination||share?s.name:(s?'尚未設定地點':'今天的地圖');const q=destination;
 $('map').hidden=shareOnly;$('shared-map-placeholder').hidden=!shareOnly;
 renderPlaceMap();
 $('map').title=`Google Maps：${destination?s.name:'尚未選擇地點'}`;$('map-link').hidden=!destination&&!share;$('map-link').href=shareOnly?share:maps(q);$('map-link').textContent=shareOnly?'開啟分享地點／導航 ↗':'在 Google Maps 開啟 ↗';
 const leg=routeLeg(d?.stops||[],index,resolvedPlaces),canRoute=!!leg?.complete;$('route-link').hidden=!canRoute;
 if(canRoute){$('route-link').href=directionsUrl(leg,s.mode||'walking');$('route-link').textContent=index===0?'從出發地前往 ↗':'從上一站前往 ↗';}
 $('map-note').textContent=shareOnly?'已保存你貼上的分享連結。按上方按鈕，在 Google Maps 查看地點與導航。':destination?'地圖會隨景點切換；即時交通與營業時間請在 Google Maps 確認。':'新增行程或選擇已設定的地點後，就能查看地圖。';
 $('map-details').hidden=!s;$('map-details').dataset.details=index;$('map-details').dataset.owner=activeDay;
 $('map-transport').hidden=!s||!(index>0||s.from);$('map-transport').dataset.transport=index;
 history.replaceState(null,'',routeUrl(currentPage,activeDay,index));
}
function refresh(day=activeDay,stop=activeStop){renderBoard();setDay(day,stop);}
function mapsConfigMessage(){return demoMode?'示範模式未提供 Google Maps 金鑰，內嵌地圖無法使用。請在 Google Maps 開啟地點或路線，再手動填寫交通分鐘數。':embedState==='loading'?'正在讀取地圖設定…':embedState==='auth'?'登入已過期，請重新登入後載入地圖。':'地圖設定暫時無法讀取，請重新載入。';}
function renderPlaceMap(force=false){
 const stops=days[activeDay]?.stops||[],s=stops[activeStop];let share='';try{share=parseMapsShare(s?.mapUrl);}catch{}
 const destination=routeLocation(s,stops,resolvedPlaces),shareOnly=!!share&&!destination;
 const visible=currentPage==='map'&&!shareOnly;
 $('place-map-wrap').hidden=shareOnly;$('reload-place-map').hidden=!visible;
 $('reload-place-map').textContent=embedState==='auth'?'重新登入載入地圖':'重新載入地圖';
 if(!visible){placeFrame.clear();return;}
 if(!destination){placeFrame.clear();$('map').hidden=true;$('place-map-status').hidden=false;$('place-map-status').textContent='新增或選擇地點後顯示地圖。';$('reload-place-map').hidden=true;return;}
 if(embedKey){$('map').hidden=false;placeFrame.load(placeEmbedUrl(destination,embedKey),'Google Maps：'+s.name,{force});}
 else{placeFrame.clear();$('map').hidden=true;$('place-map-status').hidden=false;$('place-map-status').textContent=mapsConfigMessage();}
}
function signIn(){if(appBase){location.reload();return;}location.assign('/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search));}
function clearUnavailableTrip(){
 const saved=persistDraft();ready=false;autoSync.stop();access={...access,canEdit:false,canShare:false};sharing.setSession(access);
 if(saved){
  // Keep the existing account/trip draft key for a later restoration, while
  // detaching this unavailable document so navigation cannot clear that draft.
  draftStore=null;recovery=null;editorDirty=transportDirty=false;editorScope=transportScope=null;editing=null;stayDraft=null;pending=null;conflict=false;
  if($('import-dialog').open)importer.close();for(const id of ['editor','transport-dialog','conflict-dialog'])if($(id).open)$(id).close();
  $('draft-recovery').hidden=true;
 }
 days=[];currentTrip=null;previous=null;placeFrame.clear();transportFrame.clear();renderTripMeta();refresh();
}
async function fetchJson(options){return readCloudJson(await fetch(tripApiPath('/api/trip'),{cache:'no-store',signal:AbortSignal.timeout(15000),...options}));}
function load(){
 if(loadRequest?.epoch===identityEpoch)return loadRequest.promise;
 const request={epoch:identityEpoch,promise:null};loadRequest=request;
 request.promise=loadSnapshot().finally(()=>{if(loadRequest===request)loadRequest=null;});return request.promise;
}
async function loadSnapshot(){
 const epoch=identityEpoch;let cached=false;
 autoSync.stop();ready=false;busy=true;$('save-status').textContent='正在確認登入…';lock();
 try{
  await loadVerifiedTripSnapshot({tripId,isCurrent:()=>epoch===identityEpoch,
   fetchSession:()=>fetch(tripApiPath('/api/session'),{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(readCloudJson),
   fetchSnapshot:()=>fetchJson(),
   onSession(session){bindAccount(session);showPage(currentPage,{record:false,focus:false});void tripManager.enter();return travelCache;},
   onCached(data){
    if(days.length)return;
    cached=true;days=data.days;currentTrip=data.trip;revision=data.revision;previous=null;restorePlaces();busy=false;
    renderTripMeta();refresh();$('save-status').textContent='已顯示上次的行程 · 背景更新中';
   },
   onFresh(data){
    applyTripRole(data.role);days=data.days;currentTrip=data.trip;revision=data.revision;previous=data.previous;ready=true;restorePlaces();renderTripMeta();
    authExpired=false;conflict=false;pending=null;syncInterrupted=false;if(!draftStore)bindDraftStore();
    $('sync-error').hidden=true;$('save-status').textContent='已與雲端同步 · 自動更新';refresh();
   }
  });
 }catch(error){
  if(epoch!==identityEpoch)return;
  authExpired=error.status===401;
  if(authExpired)forgetAccount();else if(error.status===403){travelCache?.deleteTrip(tripId);travelCache?.clearCatalogue();clearUnavailableTrip();void tripManager.refresh();}
  $('save-status').textContent=authExpired?'需要重新登入':cached?'顯示上次的行程 · 連線恢復後可編輯':'尚未連上雲端';
  $('sync-error-text').textContent=error.message;$('retry').textContent=authExpired?'重新登入':'重新連線';$('sync-error').hidden=false;
 }finally{if(epoch===identityEpoch){busy=false;lock();}}
}
async function commit(next,message,day=activeDay,stop=activeStop,retry=false,transport=false,scope=null,stayId=null){
 if(conflict){showConflicts();return false;}
 if(!tripId||!access.canEdit||!ready||busy)return false;
 if(scope?.tripId&&scope.tripId!==tripId||pending?.tripId&&pending.tripId!==tripId){notice('這份草稿屬於其他旅行，請回到原旅行儲存。');return false;}
 if(!retry)pending={tripId,base:clone(scope?.days||days),days:clearStaleTravel(next),revision:scope?.revision??revision,mutationId:crypto.randomUUID(),message,day,stop,transport,stayId};
 const task=pending;if(!task)return false;const epoch=identityEpoch;busy=true;$('save-status').textContent='正在儲存…';lock();
 persistDraft();
 try{
  let result;
  for(let attempt=0;attempt<4;attempt++){
   try{result=await fetchJson({method:'PUT',headers:{'Content-Type':'application/json','X-Trip-Client':'multi-1'},body:JSON.stringify({days:task.days,revision:task.revision,mutationId:task.mutationId})});break;}
     catch(error){
      if(epoch!==identityEpoch)return false;
      if(error.status!==409)throw error;
      const latest=await fetchJson(),merged=mergeTrip(task.base,task.days,latest.days);
      if(epoch!==identityEpoch)return false;
    if(merged.unresolved.length){task.merge={remote:latest,choices:{}};conflict=true;$('save-status').textContent='有欄位衝突，請選擇保留版本';$('sync-error-text').textContent='未儲存內容已保留，請處理衝突。';$('retry').textContent='處理衝突';$('sync-error').hidden=false;showConflicts();persistDraft();return false;}
    const checked=mergedSchedule(merged.days,latest.days);task.base=clone(latest.days);task.days=checked.days;task.revision=latest.revision;task.mutationId=crypto.randomUUID();task.message='已自動合併其他人的修改。'+checked.reason;persistDraft();
   }
  }
  if(epoch!==identityEpoch)return false;
  if(!result)throw Error('同行者仍在更新行程，內容已保留，請稍後重試儲存。');
  cacheConfirmed(result);days=result.days;currentTrip=result.trip||currentTrip;previous=result.previous;revision=result.revision;renderTripMeta();pending=null;editorDirty=false;editorScope=null;transportDirty=false;transportScope=null;recovery=null;$('draft-recovery').hidden=true;
  if(task.stayId&&stayDraft){delete stayDraft.values[task.stayId];if(!Object.keys(stayDraft.values).length)stayDraft=null;}
  if(stayDraft){recovery={stay:clone(stayDraft)};$('draft-recovery').hidden=false;}
  $('sync-error').hidden=true;$('save-status').textContent='已儲存至雲端';$('editor').close();if($('import-dialog').open)importer.close();editing=null;refresh(task.day,task.stop);persistDraft();notice(task.message);if($('transport-dialog').open){transportScope=scopeSnapshot();$('transport-minutes').value=savedTravelMinutes(days[activeDay].stops,transportIndex)??'';renderTransport();$('transport-feedback').textContent=task.message;}return true;
 }catch(e){
  if(epoch!==identityEpoch)return false;
  if(e.status===401){persistDraft();forgetAccount();authExpired=true;}
  if(e.status===403){
   try{
    const session=await readCloudJson(await fetch(tripApiPath('/api/session'),{cache:'no-store',signal:AbortSignal.timeout(15000)}));
    if(epoch!==identityEpoch)return false;
    if(session.email?.toLowerCase()!==access.email?.toLowerCase()){forgetAccount();location.reload();return false;}
    permissionEpoch++;applyTripRole(session.role);if(!session.canEdit)pending=null;
   }catch{if(epoch!==identityEpoch)return false;travelCache?.deleteTrip(tripId);travelCache?.clearCatalogue();clearUnavailableTrip();}
  }
  const invalid=[400,413,415,428].includes(e.status);$('save-status').textContent='尚未儲存';$('form-error').textContent=e.message;$('sync-error-text').textContent=e.message+(invalid?' 請修正欄位後重新儲存。':' 可按「重試儲存」，不必重新輸入。');$('retry').textContent=authExpired?'重新登入':e.status===403?'重新確認權限':invalid?'重新連線':'重試儲存';$('sync-error').hidden=false;if($('transport-dialog').open)$('transport-feedback').textContent=e.message;if(invalid)pending=null;persistDraft();return false;
 }
 finally{if(epoch===identityEpoch){busy=false;lock();}}
}
function openEditor(day,index=null,scope=null,view=false){
 if(!ready||busy||pending||conflict||(!view&&!canChange()))return;editorReadOnly=view;editorScope=scope||scopeSnapshot();editorDirty=false;newStopId=crypto.randomUUID();editing=index===null?null:{day,index,id:editorScope.days[day].stops[index].id};const s=index===null?{}:editorScope.days[day].stops[index];
 $('editor-form').reset();$('field-name').setCustomValidity('');$('editor-title').textContent=view?'行程詳情':index===null?'新增行程':'編輯行程';$('field-day').innerHTML=days.map((d,i)=>`<option value="${i}">${esc(d.isoDate||d.date)} ${esc(d.week)}</option>`).join('');$('field-day').value=day;
 $('field-tag').innerHTML=tagOptions(s.tag).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
 for(const key of ['name','time','desc','mapUrl'])$('field-'+key).value=s[key]??'';$('field-fixed').checked=s.live===true;$('field-q').value=s.routeQuery||s.q||routeLocation(s,days[day].stops,resolvedPlaces);$('field-tag').value=s.tag||'其他';updateTagPreview();$('field-duration').innerHTML=durationPicker(s.duration,'行程','field-duration');$('field-mode').value=s.mode||'walking';$('form-error').textContent='';updateSharePreview();updateEditorOrder(true);renderEditorSummary(day,index,s);$('editor-location').open=index===null;$('editor').showModal();lock();$(view?(access.canEdit?'editor-start-edit':'editor-close'):index===null?'field-q':'field-name').focus();
}
function renderEditorSummary(day,index,stop){
 const duration=formatDuration(stop.duration),destination=stop.routeQuery||stop.q||routeLocation(stop,days[day].stops,resolvedPlaces);
 $('editor-summary').innerHTML=index===null?'':`<h3>${esc(stop.name)}</h3><div class="detail-meta"><span>${esc(days[day].date)} ${esc(days[day].week)}</span><span class="tag category-${tagCategory(stop.tag)}">${esc(stop.tag||'其他')}</span></div><dl><div><dt>時間</dt><dd>${esc(stop.time||'待安排')}</dd></div><div><dt>停留時間</dt><dd>${duration}</dd></div><div><dt>當日順序</dt><dd>第 ${index+1} 站／共 ${days[day].stops.length} 站</dd></div>${destination?`<div class="detail-place"><dt>地點</dt><dd>${esc(destination)}</dd></div>`:''}${stop.live===true?`<div><dt>新增者</dt><dd>${esc(stopAvatarLabel(stop).startsWith('新增者：')?stopAvatarLabel(stop).slice(4):'尚未記錄')}</dd></div>`:''}</dl>${stop.desc?`<p class="detail-notes">${esc(stop.desc).replace(/\n/g,'<br>')}</p>`:''}${stop.source?`<a class="stop-link" href="${esc(stop.source)}" target="_blank" rel="noopener noreferrer">演出資訊</a>`:''}`;
 $('editor-map').hidden=index===null||!destination&&!stop.mapUrl;$('editor-map').dataset.viewMap=index;
 $('editor-transport').hidden=index===null||!(index>0||stop.from);$('editor-transport').dataset.transport=index;
 $('editor-transport').textContent=index!==null&&savedTravelMinutes(days[day].stops,index)!==null?`交通 ${savedTravelMinutes(days[day].stops,index)} 分鐘`:'查看交通時間';
}
function updateEditorOrder(reset=false){
 const day=Number($('field-day').value),count=editorScope.days[day].stops.length+(editing?.day===day?0:1),field=$('field-order');
 const desired=reset||!field.options.length?(editing?.day===day?editing.index:count-1):Number(field.value);
 const position=Math.max(0,Math.min(desired,count-1));
 field.innerHTML=Array.from({length:count},(_,i)=>`<option value="${i}" ${i===position?'selected':''}>第 ${i+1} 站／共 ${count} 站</option>`).join('');
 $('editor-up').disabled=editorReadOnly||!canChange()||position===0;
 $('editor-down').disabled=editorReadOnly||!canChange()||position===count-1;
}
function updateSharePreview(){
 const field=$('field-mapUrl');field.setCustomValidity('');$('share-preview').hidden=true;$('share-preview').removeAttribute('href');
 try{const link=parseMapsShare(field.value);$('maps-share-status').textContent=link?'已讀取分享連結，儲存前可開啟確認。':'';if(link){$('share-preview').href=link;$('share-preview').hidden=false;}}
 catch(error){$('maps-share-status').textContent=error.message;}
}
async function remove(day,index){const next=clone(days),name=next[day].stops[index].name;next[day].stops.splice(index,1);return commit(next,`已刪除「${name}」，可按復原上一步。`,day,Math.max(0,index-1));}
async function reorderStop(id,to,scope={...scopeSnapshot(),day:activeDay}){
 if(!canChange())return false;const next=clone(scope.days),items=next[scope.day].stops;
 const before=items.filter(s=>s.travelMinutes!==undefined).length;next[scope.day].stops=moveStop(items,id,to);clearStaleTravel(next);
 const cleared=before-next[scope.day].stops.filter(s=>s.travelMinutes!==undefined).length;
 const saved=await commit(next,'已調整行程順序'+(cleared?'；路線改變的交通時間已清除，請重新確認。':''),scope.day,to,false,false,scope);
 if(saved){
  const handle=$('timeline').querySelector(`[data-stop-id="${id}"]`);handle?.focus({preventScroll:true});
 }
 return saved;
}
async function move(index,step){const to=index+step;if(to<0||to>=days[activeDay].stops.length)return;await reorderStop(days[activeDay].stops[index].id,to);}
async function importRows(rows,scope){
 if(!canChange())return;
 // Complete place resolution before constructing the single cloud mutation.
 const unknown=rows.filter(row=>!row.q);let cursor=0,completed=0;
 const resolved=await Promise.allSettled(Array.from({length:Math.min(3,unknown.length)},async()=>{
  while(cursor<unknown.length){const row=unknown[cursor++];row.q=await ensureLocation(row,scope.days[row.day]?.stops||[],true);completed++;$('import-error').textContent=`已確認 ${completed}／${unknown.length} 個分享地點`;
   if(!row.q)throw Error('無法讀取「'+row.name+'」的分享地點，請確認連結後重試。');}
 }));
 const failed=resolved.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 const next=insertImported(scope.days,rows),last=rows.at(-1),index=next[last.day].stops.findIndex(s=>s.id===last.id);
 await commit(next,'已匯入 '+rows.length+' 個行程',last.day,index,false,false,scope);
}
document.addEventListener('click',e=>{
 const link=e.target.closest('[data-page-link]');if(link&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();showPage(link.dataset.pageLink);return;}
 const action=e.target.closest('button,[data-reorder-card]');if(!action)return;
 const menu=action.closest('.toolbar-more');if(menu)menu.open=false;
 if(action.disabled)return;
 if(action.hasAttribute('data-open-day')){setDay(Number(action.dataset.openDay));showPage('daily');return;}
 if(action.hasAttribute('data-view-map')){if($('editor').open&&editorReadOnly)$('editor').close();selectStop(Number(action.dataset.viewMap));showPage('map');return;}
 if(action.hasAttribute('data-transport')){openTransport(Number(action.dataset.transport));return;}
 if(action.hasAttribute('data-map-stop')){selectStop(Number(action.dataset.mapStop));return;}
 if(action.hasAttribute('data-close')){if(!pending&&!conflict){editing=null;editorDirty=false;editorScope=null;persistDraft();}$('editor').close();return;}
 if(action.hasAttribute('data-details')){const day=Number(action.dataset.owner),index=Number(action.dataset.details);setDay(day,index);openEditor(day,index,null,true);return;}
 if(action.hasAttribute('data-add')){openEditor(Number(action.dataset.add));return;}
 if(action.hasAttribute('data-edit')){openEditor(Number(action.dataset.owner),Number(action.dataset.edit));return;}
 if(action.hasAttribute('data-remove')){void remove(Number(action.dataset.owner),Number(action.dataset.remove));return;}
 if(action.hasAttribute('data-move')){void move(Number(action.dataset.move),Number(action.dataset.step));return;}
 if(action.hasAttribute('data-day')){setDay(Number(action.dataset.day),Number(action.dataset.stop));showPage('daily');return;}
 if(action.hasAttribute('data-tab')){const prefix=action.dataset.tabPrefix;setDay(Number(action.dataset.tab));$(`${prefix}-${activeDay}`).focus({preventScroll:true});return;}
 if(action.hasAttribute('data-select'))selectStop(Number(action.dataset.select));
});
$('timeline').addEventListener('keydown',e=>{
 const card=e.target.closest('[data-reorder-card]');
 if(card&&e.target===card&&['Enter',' '].includes(e.key)){e.preventDefault();card.click();}
});
for(const id of ['day-tabs','map-day-tabs'])$(id).addEventListener('keydown',e=>{
 const tab=e.target.closest('[data-tab]');
 if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?days.length-1:(Number(tab.dataset.tab)+(e.key==='ArrowLeft'?-1:1)+days.length)%days.length;
 setDay(index);$(`${tab.dataset.tabPrefix}-${index}`).focus({preventScroll:true});
});
$('editor-form').addEventListener('submit',async e=>{
 e.preventDefault();if(editorReadOnly||!access.canEdit||!ready||busy)return;if(conflict){showConflicts();return;}if(pending){await commit(null,null,null,null,true);return;}
 const epoch=identityEpoch;
 const next=clone(editorScope?.days||days),day=Number($('field-day').value),original=editing?next[editing.day].stops[editing.index]:{};const stop={...original,id:original.id||newStopId||crypto.randomUUID()};
 try{const link=parseMapsShare($('field-mapUrl').value);if(!editing&&!link)throw Error('請先到 Google Maps 確認地點，再貼上分享連結。');delete stop.mapUrl;delete stop.placeId;if(link)stop.mapUrl=link;}catch(error){$('field-mapUrl').setCustomValidity(error.message);$('field-mapUrl').reportValidity();return;}
 for(const key of ['name','time','tag','q','desc','mode'])stop[key]=$('field-'+key).value.trim();if(!stop.name){$('field-name').setCustomValidity('請填寫行程名稱');$('field-name').reportValidity();return;}
 if($('field-fixed').checked)stop.live=true;else delete stop.live;
 if(!stop.q&&stop.mapUrl){
  busy=true;$('save-status').textContent='正在讀取分享地點…';lock();
  const query=await ensureLocation(stop,next[day].stops,true);
  if(epoch!==identityEpoch)return;
  busy=false;lock();$('save-status').textContent='已與雲端同步';
  if(!query){$('form-error').textContent=placeErrors.get(stop.mapUrl)||'無法讀取分享地點，請填入店名或地址。';return;}
  stop.q=query;$('field-q').value=query;
 }
 delete stop.routeQuery;if(stop.q)stop.routeQuery=stop.q;else delete stop.placeId;
 delete stop.duration;const stay=readStay($('editor-form'));if(stay!==undefined)stop.duration=stay;stop.tag=stop.tag||'行程';stop.time=stop.time||'待安排';
 if(editing)next[editing.day].stops.splice(editing.index,1);
 const index=Math.max(0,Math.min(Number($('field-order').value),next[day].stops.length));
 next[day].stops.splice(index,0,stop);clearStaleTravel(next);
 const shifted=stay!==original.duration&&index+1<next[day].stops.length?pushSchedule(next[day].stops,index+1):{changed:0,reason:''};
 await commit(next,(editing?'行程已更新':'已新增行程')+(shifted.changed?'，已順延 '+shifted.changed+' 個行程':'')+(shifted.reason?'。'+shifted.reason:''),day,index,false,false,editorScope,stop.id);
});
function updateTagPreview(){const tag=$('field-tag').value,preview=$('tag-preview');preview.className='tag-preview category-'+tagCategory(tag);preview.querySelector('.tag').textContent=tag;}
$('field-tag').addEventListener('change',updateTagPreview);
$('field-day').addEventListener('change',()=>updateEditorOrder(true));
$('field-order').addEventListener('change',()=>updateEditorOrder());
for(const [id,step] of [['editor-up',-1],['editor-down',1]])$(id).addEventListener('click',()=>{
 if(!canChange()||editorReadOnly)return;
 $('field-order').value=Number($('field-order').value)+step;updateEditorOrder();editorDirty=true;persistDraft();
});
$('field-name').addEventListener('input',()=>$('field-name').setCustomValidity(''));
document.addEventListener('change',e=>{
 const picker=e.target.closest('[data-duration-picker]');if(!picker)return;
 const hours=picker.querySelector('[name="durationHours"]'),minutes=picker.querySelector('[name="durationMinutes"]');
 if(e.target===hours&&(hours.value===''||hours.value==='24'))minutes.value='0';
 if(e.target===minutes&&hours.value==='')hours.value='0';
 for(const option of minutes.options)option.disabled=hours.value==='24'&&option.value!=='0';
});
$('field-mapUrl').addEventListener('input',updateSharePreview);
$('field-q').addEventListener('input',()=>$('field-q').setCustomValidity(''));
$('search-maps').addEventListener('click',()=>{const field=$('field-q'),query=field.value.trim();if(!query){field.setCustomValidity('請先輸入想查詢的地點或地址');field.reportValidity();field.setCustomValidity('');return;}window.open(maps(query),'_blank','noopener,noreferrer');});
$('field-q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('search-maps').click();}});
$('editor').addEventListener('cancel',e=>{if(busy){e.preventDefault();return;}if(!pending&&!conflict){editorDirty=false;editorScope=null;editing=null;persistDraft();}});
$('undo').addEventListener('click',()=>{if(previous)void commit(clone(previous),'已復原上一步');});
$('retry').addEventListener('click',()=>{if(conflict){showConflicts();return;}if(authExpired){persistDraft();signIn();return;}void loadMapsConfig();pending&&ready&&access.canEdit?void commit(null,null,null,null,true):void boot();});
$('print').addEventListener('click',()=>window.print());
$('trip-rename-open').addEventListener('click',async()=>{if(!canChange()||!canSwitchTrip())return;showPage('trips');await tripManager.enter();tripManager.openRename(tripId);});
$('editor-start-edit').addEventListener('click',()=>{if(!canChange())return;editorReadOnly=false;$('editor-title').textContent='編輯行程';lock();$('field-name').focus();});
$('editor-delete').addEventListener('click',()=>{if(canChange()&&editing)void remove(editing.day,editing.index);});
window.addEventListener('popstate',()=>{
 if(busy||pending||conflict||dragging){history.replaceState(null,'',routeUrl(currentPage,activeDay,activeStop,appBase,tripId));notice('請先完成目前的儲存或衝突處理。');return;}
 if(draftStore&&!persistDraft()){history.replaceState(null,'',routeUrl(currentPage,activeDay,activeStop,appBase,tripId));return;}
 if((new URL(location.href).searchParams.get('trip')||'')!==tripId){autoSync.stop();location.reload();return;}
 if(editorDirty||transportDirty||stayDraft||importer.dirty){
  recovery=draftStore?.read()||null;editorDirty=transportDirty=false;editorScope=transportScope=null;editing=null;stayDraft=null;
  if($('import-dialog').open)importer.close();$('draft-recovery').hidden=!recovery;
 }
 for(const id of ['editor','transport-dialog','import-dialog'])if($(id).open)$(id).close();
 const route=readRoute(location.href);currentPage=route.page;setDay(route.day,route.stop);showPage(route.page,{record:false});if(route.page==='trips')void tripManager.enter();
});
window.addEventListener('beforeunload',e=>{if(tripManager.dirty||((pending||editorDirty||transportDirty||stayDraft||importer.dirty)&&!persistDraft())){e.preventDefault();e.returnValue='';}});
function renderTransport(forceReload=false){
 const leg=routeLeg(days[activeDay]?.stops||[],transportIndex,resolvedPlaces),frame=$('transport-map');
 if(leg?.samePlace&&$('transport-minutes').value==='')$('transport-minutes').value='0';
 $('transport-pair').textContent=leg?leg.fromName+' → '+leg.toName:'';
 $('transport-mode').value=transportMode;
 $('transport-location-note').hidden=!leg?.samePlace;$('transport-location-note').textContent=leg?.samePlace?'這兩個行程指向同一個地點，站間交通為 0 分鐘。若要安排不同地點，請更換其中一站的地點或分享連結。':'';
 const canEmbed=!!(leg?.complete&&embedKey);
 frame.hidden=!canEmbed;
 if(canEmbed)transportFrame.load(leg.samePlace?placeEmbedUrl(leg.destination,embedKey):directionsUrl(leg,transportMode,embedKey),leg.samePlace?'Google Maps：兩站的共同地點':'Google Maps 交通時間：'+leg.fromName+' 至 '+leg.toName,{force:forceReload});
 else{transportFrame.clear();$('transport-placeholder').hidden=false;$('transport-placeholder').textContent=transportLoading?'正在讀取兩站的分享地點…':!leg?.complete?'無法讀取「'+[!leg?.origin?leg?.fromName:'',!leg?.destination?leg?.toName:''].filter(Boolean).join('、')+'」的地點。請重試讀取分享連結，或在該行程填入店名／地址。':mapsConfigMessage();}
 $('retry-maps').hidden=transportLoading||(leg?.complete&&!canEmbed&&embedState==='loading');$('retry-maps').textContent=!leg?.complete?'重試讀取分享地點':embedState==='auth'?'重新登入載入地圖':'重新載入地圖';
 $('transport-external').hidden=!leg?.complete;if(leg?.complete)$('transport-external').href=leg.samePlace?maps(leg.destination):directionsUrl(leg,transportMode);
}
function lockTransport(){
 const locked=!access.canEdit||!ready||busy||!!pending||conflict;
 $('transport-form').hidden=!access.canEdit;
 for(const id of ['transport-minutes','save-transport'])$(id).disabled=locked;
 $('transport-mode').disabled=!ready||busy||!!pending||conflict;
 $('transport-edit').hidden=true;
 $('close-transport').disabled=busy;
 $('transport-retry').hidden=!pending&&!conflict;$('transport-retry').disabled=busy;
 $('transport-retry').textContent=conflict?'處理衝突':'重試儲存';
}
function openTransport(index){
 if(!ready||!days[activeDay]?.stops[index])return;
 transportScope=scopeSnapshot();transportDirty=false;
 transportIndex=index;transportMode=days[activeDay].stops[index]?.mode||'walking';
 transportLoading=false;const leg=routeLeg(days[activeDay].stops,index,resolvedPlaces);
 $('transport-minutes').value=savedTravelMinutes(days[activeDay].stops,index)??(leg?.samePlace?0:'');
 $('transport-feedback').textContent='';$('transport-dialog').showModal();renderTransport();lockTransport();if(!leg?.complete)void hydrateTransport(index);if(!embedKey)void loadMapsConfig();
}
function loadMapsConfig(){
 if(embedRequest)return embedRequest;
 const epoch=identityEpoch;
 embedState='loading';renderPlaceMap();if($('transport-dialog').open)renderTransport();
 embedRequest=(async()=>{
  try{const key=await fetchEmbedConfig();if(epoch===identityEpoch){embedKey=key;embedState=embedKey?'ready':'unconfigured';}}
  catch(e){if(epoch===identityEpoch){embedKey='';embedState=e.status===401?'auth':'error';}}
  finally{embedRequest=null;renderPlaceMap();if($('transport-dialog').open)renderTransport();}
 })();return embedRequest;
}
$('retry-maps').addEventListener('click',()=>{if(!routeLeg(days[activeDay]?.stops||[],transportIndex,resolvedPlaces)?.complete){void hydrateTransport(transportIndex,true);return;}if(embedState==='auth'){signIn();return;}if(embedKey)renderTransport(true);else void loadMapsConfig();});
$('reload-place-map').addEventListener('click',()=>{if(embedState==='auth'){signIn();return;}if(embedKey)renderPlaceMap(true);else void loadMapsConfig();});
function verifyIdentity(){
 if(sessionCheck?.epoch===identityEpoch)return sessionCheck.promise;
 if(bootRequest?.epoch===identityEpoch)return bootRequest.promise;
 if(loadRequest?.epoch===identityEpoch)return loadRequest.promise;
 if(!access.email)return boot();
 const epoch=identityEpoch,email=access.email;
 const request={epoch,promise:null};sessionCheck=request;
 request.promise=(async()=>{
  try{
   const session=await readCloudJson(await fetch(tripId?tripApiPath('/api/session'):apiPath('/api/session'),{cache:'no-store',signal:AbortSignal.timeout(15000)}));
   if(epoch!==identityEpoch)return;
   if(session.email?.toLowerCase()!==email.toLowerCase()){forgetAccount();location.reload();return;}
   if(tripId&&session.trip?.id!==tripId){const error=Error('無法確認旅行權限，請重新登入。');error.status=401;throw error;}
   permissionEpoch++;applyTripRole(session.role);access={...access,...session};sharing.setSession(access);tripManager.setSession(access);lock();
   if(tripId&&!ready)await boot();else if(tripId)await autoSync.tick();
   if(currentPage==='trips')void tripManager.enter();
  }catch(error){
   if(epoch!==identityEpoch)return;
   if(error.status===401)forgetAccount();
   else if(error.status===403){travelCache?.deleteTrip(tripId);travelCache?.clearCatalogue();clearUnavailableTrip();void tripManager.refresh();}
   else return;
   authExpired=error.status===401;$('save-status').textContent=authExpired?'需要重新登入':'旅行已刪除或無法存取';$('sync-error-text').textContent=error.message;$('retry').textContent=authExpired?'重新登入':'重新確認權限';$('sync-error').hidden=false;lock();
  }
 })().finally(()=>{if(sessionCheck===request)sessionCheck=null;});return request.promise;
}
$('trip-sign-out').addEventListener('click',()=>{const email=access.email;sessionChannel?.postMessage({type:'logout',email});forgetAccount();});
if(sessionChannel)sessionChannel.addEventListener('message',event=>{if(event.data?.type==='logout'&&event.data.email===access.email){forgetAccount();authExpired=true;$('save-status').textContent='已在其他分頁登出，請重新登入';}});
window.addEventListener('storage',event=>{if(event.key===null||travelCache?.ownsKey(event.key)&&event.newValue===null)void verifyIdentity();});
for(const event of ['online','offline'])window.addEventListener(event,()=>{placeFrame.connectionChanged();transportFrame.connectionChanged();if(event==='online'&&!embedKey)void loadMapsConfig();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void verifyIdentity();});
window.addEventListener('focus',()=>void verifyIdentity());
window.addEventListener('online',()=>void verifyIdentity());
window.addEventListener('offline',()=>{syncInterrupted=true;if(ready&&!busy&&!pending&&!conflict)$('save-status').textContent='目前離線，恢復網路後自動同步';});
for(const id of ['editor','transport-dialog'])$(id).addEventListener('close',()=>void autoSync.tick());
window.addEventListener('pageshow',event=>{if(event.persisted){identityEpoch++;clearUnavailableTrip();busy=false;tripManager.clear();for(const id of ['editor','transport-dialog','conflict-dialog','import-dialog'])if($(id).open)$(id).close();void boot();}});
$('transport-mode').addEventListener('change',()=>{if(!days[activeDay]?.stops[transportIndex])return;transportMode=$('transport-mode').value;const s=days[activeDay].stops[transportIndex];$('transport-minutes').value=transportMode===(s.mode||'walking')?(savedTravelMinutes(days[activeDay].stops,transportIndex)??''):'';$('transport-feedback').textContent='';renderTransport();});
$('transport-minutes').addEventListener('input',()=>{$('transport-feedback').textContent='';});
$('transport-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!ready||busy||pending||conflict)return;
 const scope=transportScope||scopeSnapshot(),next=clone(scope.days),stops=next[activeDay].stops,stop=stops[transportIndex];
 stop.mode=transportMode;stop.travelMinutes=Number($('transport-minutes').value);stop.travelSignature=legSignature(stops,transportIndex);
 const result=pushSchedule(stops,transportIndex);
 await commit(next,`已儲存交通 ${stop.travelMinutes} 分鐘${result.changed?`，已順延 ${result.changed} 個行程`:''}。${result.reason}`,activeDay,transportIndex,false,true,scope);
});
$('transport-retry').addEventListener('click',()=>{if(conflict)showConflicts();else if(pending)void commit(null,null,null,null,true);});
$('transport-dialog').addEventListener('cancel',e=>{if(busy){e.preventDefault();return;}if(!pending&&!conflict){transportDirty=false;transportScope=null;persistDraft();}});
$('close-transport').addEventListener('click',()=>{if(!pending&&!conflict){transportDirty=false;transportScope=null;persistDraft();}$('transport-dialog').close();});
$('transport-dialog').addEventListener('close',()=>{if(!$('transport-dialog').open)transportFrame.clear();});
let restoringDraft=false;
function captureDraft(event){
 if(restoringDraft||busy||!ready||!access.canEdit)return;
 if(event.target.closest('#import-dialog'))return;
 if(event.target.closest('#editor')){if(editorReadOnly)return;editorDirty=true;}
 else if(event.target.matches('#transport-minutes,#transport-mode'))transportDirty=true;
 else{
  const form=event.target.closest('[data-stay-form]');if(!form)return;
  stayDraft??={scope:scopeSnapshot(),values:{}};
  const id=days[activeDay].stops[Number(form.dataset.stayForm)].id;
  stayDraft.values[id]={hours:form.elements.durationHours.value,minutes:form.elements.durationMinutes.value};
 }
 persistDraft();
}
document.addEventListener('input',captureDraft);document.addEventListener('change',captureDraft);
$('draft-discard').addEventListener('click',()=>{recovery=null;stayDraft=null;draftStore?.clear();$('draft-recovery').hidden=true;lock();void autoSync.tick();notice('已捨棄這個裝置的未儲存草稿');});
$('draft-restore').addEventListener('click',()=>{
 if(!recovery||!access.canEdit||busy)return;
 const saved=recovery;restoringDraft=true;
 try{
  editorReadOnly=false;
  if(saved.stay){stayDraft=saved.stay;days=clone(stayDraft.scope.days);revision=stayDraft.scope.revision;refresh();}
  if(saved.editor){
   const draft=saved.editor;openEditor(draft.editing?.day??Number(draft.fields.day),draft.editing?.index??null,draft.scope);newStopId=draft.newStopId||crypto.randomUUID();
   for(const key of ['name','time','day','q','mode','mapUrl','desc'])$('field-'+key).value=draft.fields[key]??'';
   if(draft.fields.fixed!==undefined)$('field-fixed').checked=!!draft.fields.fixed;
   $('field-tag').innerHTML=tagOptions(draft.fields.tag).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');$('field-tag').value=draft.fields.tag;
   $('editor-form').elements.durationHours.value=draft.fields.hours;$('editor-form').elements.durationMinutes.value=draft.fields.minutes;editorDirty=true;updateEditorOrder(true);if(draft.fields.order!==undefined){$('field-order').value=draft.fields.order;updateEditorOrder();}updateTagPreview();updateSharePreview();
  }else if(saved.imported){importer.restore(saved.imported);
  }else if(saved.transport){
   const draft=saved.transport;days=clone(draft.scope.days);revision=draft.scope.revision;const index=days[draft.day].stops.findIndex(s=>s.id===draft.id);if(index<0)throw Error('找不到草稿中的行程。');refresh(draft.day,index);openTransport(index);transportMode=draft.mode;renderTransport();$('transport-minutes').value=draft.minutes;transportDirty=true;
  }
  if(stayDraft&&!saved.editor&&!saved.imported&&!saved.transport&&!saved.pending){
   const [id,value]=Object.entries(stayDraft.values)[0]||[];
   const day=stayDraft.scope.days.findIndex(d=>d.stops.some(s=>s.id===id));
   if(day>=0){const index=stayDraft.scope.days[day].stops.findIndex(s=>s.id===id);refresh(day,index);openEditor(day,index,stayDraft.scope);$('editor-form').elements.durationHours.value=value.hours;$('editor-form').elements.durationMinutes.value=value.minutes;editorDirty=true;}
  }
  pending=saved.pending||null;conflict=!!pending?.merge;recovery=null;$('draft-recovery').hidden=true;
  if(pending){$('sync-error').hidden=false;$('sync-error-text').textContent='已恢復未送出的修改，儲存前會與雲端最新版本合併。';$('retry').textContent=conflict?'處理衝突':'重試儲存';}
  lock();persistDraft();if(conflict)showConflicts();notice('已恢復草稿，尚未儲存至雲端');
 }catch(error){notice('無法恢復這份草稿：'+error.message);}finally{restoringDraft=false;}
});
if(demoMode)globalThis.__TRAVEL_NOTES_DEMO__.canManageDays=()=>ready&&canSwitchTrip()&&!tripManager.dirty&&!tripManager.pending;
refresh();showPage(currentPage,{record:false,focus:false});void boot();void loadMapsConfig();
