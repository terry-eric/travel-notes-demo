import {appBase,apiPath,tripApiPath,selectedTripId,demoMode,googleAuth} from './runtime.js';
import {initTripManager} from './trip-manager.js';
import {initSharing} from './sharing.js';
import {parseMapsShare} from './maps-link.js';
import {mountRouteMap} from './route-map.js';
import {getStopCoordinates,normalizeCoordinates} from './map-coordinates.js';
import {knownStopPoint,geocodeStopKey} from './auto-geolocation.js';
import {createGeolocationClient,geolocationStatusText} from './geolocation-client.js';
import {sanitizeFlight,flightTripSchedule,formatFlightSummary,flightFieldsHtml,flightDuration,flightLocalTimes,flightTimezoneChange,previousFlightArrivalTimezone} from './flights.js';
import {renderDayName,renameDay} from './day-names.js';
import {readRoute,routeUrl,boundedSelection} from './routes.js';
import {routeLocation,routeLeg,directionsUrl,savedTravelMinutes,clearStaleTravel,pushSchedule,clockMinutes} from './transport.js';
import {transportIcons,renderInlineTransportRow,applyManualTransport,applyTimelineTime} from './inline-transport.js';
import {readCloudJson,fetchEmbedConfig,fetchTripUpdate,loadVerifiedTripSnapshot} from './cloud.js';
import {createTravelCache} from './cache.js';
import {createAutoSync} from './sync.js';
import {mergeTrip} from './merge.js';
import {createDraftStore,withoutDeletedStops,sanitizePermanentDraft} from './drafts.js';
import {initConflicts} from './conflicts.js';
import {createMapFrame,placeEmbedUrl} from './map-frame.js';
import {durationParts,durationMinutes,formatDuration} from './duration.js';
import {tagCategory,tagOptions,renderCardTag,applyStopTag,isFixedStop,renderFixedStopBadge,itineraryTypeOptions,itineraryTypeValue,resolveItineraryType} from './tags.js';
import {renderStopAvatar,stopAvatarLabel} from './stop-avatar.js';
import {initReorder,initOverviewReorder,moveStop,moveStopBetweenDays} from './reorder.js';
import {initImport,insertImported} from './import.js';
import {reviewImport} from './import-review.js';
const resolvedPlaces=new Map(),placeRequests=new Map(),placeErrors=new Map();
let transportLoading=false;
let routeMap=null,overviewMap=null,dailyRouteMap=null,routeMapScope="day",dayNameDraft=null;
let embedKey='',embedState='loading',embedRequest=null,authExpired=false,transportIndex=0,transportMode='walking';
let days=[],currentTrip=null,previous=null,revision=0,ready=false,busy=false,editing=null,pending=null,conflict=false;
let access={canEdit:false,canShare:false};
let travelCache=null,cacheEmail='',identityEpoch=0,permissionEpoch=0,bootRequest=null,loadRequest=null,sessionCheck=null;
let renameSyncNeeded=false,signingOut=false;
const sessionChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('trip-session:'+appBase):null;
const tripId=selectedTripId;
let editorScope=null,editorDirty=false,newStopId='',transportScope=null,transportDirty=false,stayDraft=null,draftStore=null,recovery=null;
let transportDraft=null,transportEditorId='',timelineEditorId='';
let tagDraft=null;
const tagScopes=new WeakMap();
const initialRoute=readRoute(location.href);
let activeDay=initialRoute.day,activeStop=initialRoute.stop,currentPage=initialRoute.page;
let editorReadOnly=false,dragging=false;
const $=id=>document.getElementById(id);
let geolocationStorage;try{geolocationStorage=localStorage;}catch{}
const geolocation=createGeolocationClient({
 appBase,storage:geolocationStorage,
 getScope:()=>({email:access.email,tripId,epoch:identityEpoch,enabled:!!access.email&&currentTrip?.id===tripId,canLookup:ready&&!demoMode}),
 getDays:()=>days,
 async lookup(body,signal){
  const response=await fetch(apiPath('/api/geocode'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  let result;try{result=await response.json();}catch{result={status:'unavailable'};}
  if(!response.ok&&result?.status!=='unavailable')throw Error('定位暫時無法使用。');
  const header=response.headers.get('Retry-After');return {result,retryAfter:header?Number(header):result?.retryAfter};
 },
 onChange:renderGeolocationMaps,
});
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
 if(!access.canEdit){
  persistDraft();
  if(editorDirty||transportDirty||stayDraft||dayNameDraft||tagDraft||importer.dirty||pending||conflict){
   recovery=draftStore?.read()||recovery;
   editorDirty=transportDirty=false;editorScope=transportScope=null;transportDraft=null;stayDraft=null;dayNameDraft=null;tagDraft=null;editing=null;pending=null;conflict=false;
   if($('import-dialog').open)importer.close();
   for(const id of ['editor','transport-dialog','conflict-dialog'])if($(id).open)$(id).close();
   $('draft-recovery').hidden=!recovery;
  }
  transportEditorId='';timelineEditorId='';
 }
 showPage(currentPage,{record:false,focus:false});setDay(activeDay,activeStop);lock();
 notice(access.canEdit?'你的行程權限已更新，可以一起編輯。':'權限已改成只能查看，未儲存的草稿保留在這個裝置。');
}
function canSwitchTrip(){return !busy&&!pending&&!conflict&&!dragging&&!editorDirty&&!transportDirty&&!stayDraft&&!dayNameDraft&&!tagDraft&&!importer.dirty&&!recovery;}
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
 geolocation.reset({forget:true});
 identityEpoch++;renameSyncNeeded=false;travelCache?.clearAccount();clearUnavailableTrip();tripManager.clear();travelCache=null;
 draftStore=null;recovery=null;editorDirty=transportDirty=false;editorScope=transportScope=null;transportDraft=null;transportEditorId='';timelineEditorId='';editing=null;stayDraft=null;dayNameDraft=null;tagDraft=null;pending=null;conflict=false;
 if($('import-dialog').open)importer.close();for(const id of ['editor','transport-dialog','conflict-dialog'])if($(id).open)$(id).close();$('draft-recovery').hidden=true;
 access={canEdit:false,canShare:false};cacheEmail='';embedKey='';embedState='auth';resolvedPlaces.clear();placeErrors.clear();placeRequests.clear();busy=false;lock();
}
function catalogueAuthFailure(error){
 forgetAccount();authExpired=true;$('save-status').textContent='需要重新登入';$('sync-error-text').textContent=error.message;$('retry').textContent='重新登入';$('sync-error').hidden=false;
}
function renderTripMeta(){
 const legacy=currentTrip?.id==='legacy-hokkaido-2026';
 tripManager.setCurrent(currentTrip?{...currentTrip,revision}:null);
 $('trip-title').textContent=currentTrip?.title||'每一趟旅行，都從這裡開始。';
 $('trip-eyebrow').textContent='YOUR TRAVEL JOURNAL';
 $('trip-summary').textContent=currentTrip?'安排每日行程，邀請同行的人一起規劃。':'建立自己的旅行，或開啟同行者邀請的旅行。';
 $('trip-dates').textContent=currentTrip?`${currentTrip.startDate.replaceAll('-','/')} — ${currentTrip.endDate.replaceAll('-','/')}`:'選擇或建立一趟旅行';
 $('trip-duration').hidden=!currentTrip;$('trip-duration').textContent=currentTrip?`${days.length} 天 ${Math.max(0,days.length-1)} 夜`:'';
 $('trip-region').hidden=true;$('trip-photo').hidden=!legacy;$('trip-photo-credit').hidden=!legacy||currentPage==='trips';$('trip-footer-note').hidden=currentPage==='trips';
 if(legacy)$('trip-image').src='https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4f/Otaru_Canal_HDR1.jpg/1280px-Otaru_Canal_HDR1.jpg';
 $('trip-footer-note').textContent=legacy?'照片為小樽景點示意。營業時間與交通請依當日資訊確認。':'旅程資料與同行者權限分別管理；請在 Google Maps 確認地點、交通與營業資訊。';
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
 getState:()=>({ready,busy:busy||tripManager.pending,pending,conflict,revision,editing:dragging||!!dayNameDraft||!!tagDraft||document.activeElement?.matches('[name="dayName"],[data-card-tag]')||!!transportEditorId||!!timelineEditorId||$('editor').open||$('import-dialog').open||$('transport-dialog').open||transportDirty||!!stayDraft}),
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
async function freshImportScope(){
 const epoch=identityEpoch,data=await fetchJson();
 if(epoch!==identityEpoch||data.trip?.id!==tripId)throw Error('登入或旅行已變更，請重新開啟匯入。');
 applyTripRole(data.role);if(!canChange())throw Error('目前無法編輯這趟旅行。');
 cacheConfirmed(data);return {tripId,trip:data.trip||currentTrip,days:data.days,revision:data.revision};
}
const importer=initImport({canWrite:()=>canChange()&&!transportDirty&&!stayDraft,getScope:scopeSnapshot,getFreshScope:freshImportScope,onSave:importRows,onChange:persistDraft,onClose:()=>void autoSync.tick()});
initReorder($('timeline'),{canStart:()=>canChange()&&!transportDirty&&!stayDraft&&!timelineEditorId&&!transportEditorId,onStart:()=>{dragging=true;return {...scopeSnapshot(),day:activeDay};},onFinish:()=>{dragging=false;lock();void autoSync.tick();},onMove:reorderStop});
function canSortOverview(){return canChange()&&!dragging&&!editorDirty&&!$('editor').open&&!$('import-dialog').open&&!$('transport-dialog').open&&!importer.dirty&&!transportDirty&&!stayDraft&&!timelineEditorId&&!transportEditorId&&!dayNameDraft&&!document.activeElement?.matches('[name="dayName"]');}
initOverviewReorder($('board'),{canStart:canSortOverview,onStart:()=>{dragging=true;return scopeSnapshot();},onFinish:()=>{dragging=false;lock();void autoSync.tick();},onMove:moveOverviewStop});
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
 if(tagDraft&&!restoringDraft&&page!==currentPage){notice('標籤尚未儲存，請先重試儲存。');return;}
 if(dayNameDraft&&!restoringDraft&&page!==currentPage){notice('請先儲存或取消每日名稱。');return;}
 if(stayDraft&&!restoringDraft&&page!==currentPage){notice('請先完成或取消時間編輯。');return;}
 if(page!==currentPage&&!transportDirty){transportEditorId='';timelineEditorId='';}
 currentPage=Object.hasOwn(pageLabels,page)?page:'overview';
 document.body.dataset.page=currentPage;
 for(const [key,id] of Object.entries({trips:'trips-panel',overview:'overview',daily:'daily',map:'map-page',notes:'before'}))$(id).hidden=key!==currentPage;
 $('trip-heading').hidden=currentPage!=='overview';$('page-heading').hidden=currentPage==='overview'||currentPage==='trips';
 $('trips-title').tabIndex=-1;
 $('page-title').textContent=pageLabels[currentPage];$('page-title').tabIndex=-1;$('current-page-label').textContent=pageLabels[currentPage];
 document.title=`${pageLabels[currentPage]}｜旅手帖`;
 document.querySelectorAll('[data-page-link]').forEach(link=>{link.href=routeUrl(link.dataset.pageLink,activeDay,activeStop);const selected=link.dataset.pageLink===currentPage;link.classList.toggle('nav-active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
 const canEdit=access.canEdit&&['overview','daily','map'].includes(currentPage);
 for(const id of ['undo','toolbar-add','import-open','gpt-import-open','flight-add'])$(id).hidden=!canEdit;
 $('sharing-open').hidden=currentPage==='trips'||(demoMode?!access.canEdit:!access.canShare);
 $('trip-photo-credit').hidden=currentPage==='trips'||currentTrip?.id!=='legacy-hokkaido-2026';$('trip-footer-note').hidden=currentPage==='trips';
 const url=routeUrl(currentPage,activeDay,activeStop);
 if(record&&location.pathname+location.search+location.hash!==url)history.pushState(null,'',url);
 selectStop(activeStop);
 if(record&&currentPage==='trips')void tripManager.enter();
 if(focus){window.scrollTo({top:0,behavior:'instant'});(currentPage==='overview'?$('main'):currentPage==='trips'?$('trips-title'):$('page-title')).focus({preventScroll:true});}
}
function mapStops(all=false){return geolocation.overlay().flatMap((day,d)=>!all&&d!==activeDay?[]:day.stops.map((stop,index)=>({...stop,geocodeState:geolocation.status(days[d].stops[index])?.status,dayIndex:d,stopIndex:index,dayLabel:day.title||'第 '+(d+1)+' 天',date:day.isoDate||day.date})));}
function mapStopMeta(stop){return (routeMapScope==='trip'?stop.date+' · ':'')+(stop.time||'待安排')+(getStopCoordinates(stop)?'':' · '+geolocationStatusText(stop.geocodeState));}
function renderGeolocationMaps(){
 renderRouteMaps({locate:false});
 const items=mapStops(routeMapScope==='trip');
 for(const button of document.querySelectorAll('[data-map-stop]')){
  const stop=items.find(item=>item.dayIndex===Number(button.dataset.mapDay)&&item.stopIndex===Number(button.dataset.mapStop));
  if(stop&&button.querySelector('small'))button.querySelector('small').textContent=mapStopMeta(stop);
 }
 if($('editor').open)renderEditorGeolocation();
}
function renderRouteMaps({locate=true}={}){
 if(locate&&ready&&['overview','daily','map'].includes(currentPage))geolocation.scan();
 const selectionLocked=()=>!!dayNameDraft||!!tagDraft||transportDirty||!!stayDraft||editorDirty||importer.dirty||busy||!!pending||conflict;
 const select=stop=>{if(selectionLocked()){renderRouteMaps();return;}setDay(stop.dayIndex,stop.stopIndex);showPage('map',{focus:false});};
 if(currentPage==='overview'&&days.length){const options={stops:mapStops(true),selectedId:days[activeDay]?.stops[activeStop]?.id,onSelect:select};overviewMap?overviewMap.update(options):overviewMap=mountRouteMap($('overview-route-map'),options);overviewMap.setVisible(true);}else overviewMap?.setVisible(false);
 if(currentPage==='map'&&days.length){const options={stops:mapStops(routeMapScope==='trip'),selectedId:days[activeDay]?.stops[activeStop]?.id,onSelect:select};routeMap?routeMap.update(options):routeMap=mountRouteMap($('itinerary-route-map'),options);routeMap.setVisible(true);}else routeMap?.setVisible(false);
 if(currentPage==='daily'&&days.length&&$('daily-route-map')){const options={stops:mapStops(false),selectedId:days[activeDay]?.stops[activeStop]?.id,onSelect:stop=>{if(selectionLocked()){renderRouteMaps();return;}selectStop(stop.stopIndex);$('timeline').querySelector(`[data-stop-id="${stop.id}"]`)?.focus({preventScroll:true});}};dailyRouteMap?dailyRouteMap.update(options):dailyRouteMap=mountRouteMap($('daily-route-map'),options);dailyRouteMap.setVisible(true);}else dailyRouteMap?.setVisible(false);
}
function renderMapStops(){
 renderDateTabs('map-day-tabs','map-tab','map-day-panel');
 $('map-day-name').textContent=days[activeDay]?.title||'第 '+(activeDay+1)+' 天';
 const items=mapStops(routeMapScope==='trip');
 $('map-stops').innerHTML=items.map((s,i)=>'<button class="map-stop '+(isFixedStop(s)?'is-fixed-stop ':'')+'category-'+tagCategory(s.tag)+'" data-map-stop="'+s.stopIndex+'" data-map-day="'+s.dayIndex+'" aria-pressed="'+(s.dayIndex===activeDay&&s.stopIndex===activeStop)+'"><span class="map-stop-number">'+(i+1)+'</span><span>'+renderFixedStopBadge(s)+'<strong>'+esc(s.name)+'</strong><small>'+esc(mapStopMeta(s))+'</small><span class="tag">'+esc(s.tag||'其他')+'</span></span>'+renderStopAvatar(s)+'</button>').join('')||'<p class="empty">這一天還沒有地點，可到每日行程新增。</p>';
 renderRouteMaps();
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
function canChange(){return !!tripId&&access.canEdit&&ready&&!busy&&!tripManager.pending&&!pending&&!conflict&&(!recovery||restoringDraft)&&!dayNameDraft&&!tagDraft;}
function lock(){
 document.body.classList.toggle('read-only',!access.canEdit);
 document.querySelectorAll('[data-write]').forEach(el=>el.disabled=!canChange());
 $('undo').disabled=!canChange()||!previous;
 $('trip-rename-open').hidden=!currentTrip||!access.canEdit;$('trip-rename-open').disabled=!canChange();
 document.querySelectorAll('#editor input,#editor select,#editor textarea,#search-maps').forEach(el=>el.disabled=editorReadOnly||!canChange());
 document.querySelectorAll('[data-geocode-candidate]').forEach(el=>el.disabled=editorReadOnly||!canChange());
 $('editor-start-edit').hidden=!editorReadOnly||!access.canEdit;$('editor-start-edit').disabled=!canChange();
 $('save-stop').hidden=editorReadOnly||!access.canEdit;$('save-stop').disabled=busy||!access.canEdit||!ready;
 $('save-stop').textContent=conflict?'處理衝突':pending?.deleteStopId?'重試永久刪除':pending?'重試儲存':editing?'儲存編輯':'儲存行程';
 $('editor-delete').hidden=editorReadOnly||!editing||!access.canEdit;
 if(editorScope)updateEditorOrder();
 $('editor').classList.toggle('viewing',editorReadOnly);$('search-maps').hidden=editorReadOnly;
 document.querySelectorAll('[data-close]').forEach(el=>el.disabled=busy);
 $('retry').disabled=busy;$('conflict-submit').disabled=busy;$('conflict-later').disabled=busy;
 $('draft-restore').disabled=!access.canEdit||!ready||busy||!recovery;$('draft-discard').disabled=busy;
 importer.lock(busy||!!pending||conflict||!!recovery||!!stayDraft||!!tagDraft);lockTransport();lockTimeline();lockDayNames();lockCardTags();updateFlightEditor();
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
function editorFields(){return Object.fromEntries(['name','time','day','order','tag','q','mode','mapUrl','desc','kind','coordinates'].map(key=>[key,$('field-'+key).value]).concat([['placeTypeFields',editorPlaceTypeFields?{...editorPlaceTypeFields}:null],['flight',readFlightFields()],['fixed',$('field-fixed').checked],['hours',$('editor-form').elements.durationHours?.value??''],['minutes',$('editor-form').elements.durationMinutes?.value??'0']]));}
function currentDraft(){
 const editor=editorDirty&&editorScope?{scope:editorScope,editing,newStopId,fields:editorFields()}:null;
 const transport=transportDirty&&transportScope&&transportDraft?{scope:transportScope,...transportDraft}:null;
 const imported=importer.snapshot();
 return {tripId,editor,transport,stay:stayDraft,dayName:dayNameDraft,tag:tagDraft,pending,imported};
}
function persistDraft(){
 if(!draftStore)return false;
 const draft=currentDraft(),{editor,transport,imported}=draft;
 if(!editor&&!transport&&!stayDraft&&!dayNameDraft&&!tagDraft&&!pending&&!imported)return recovery?true:draftStore.clear();
 const saved=draftStore.write(draft);
 if(!saved){const warning='此瀏覽器無法保存草稿，請先儲存再離開';$('save-status').textContent=warning;if(transportDirty)inlineTransportFeedback(inlineTransportForm(),warning,true);if($('editor').open)$('form-error').textContent=warning;if($('transport-dialog').open)$('transport-feedback').textContent=warning;if($('conflict-dialog').open)conflictUI.message(warning);}
 return saved;
}
function restoreStayInputs(){
 if(!stayDraft)return;
 for(const [id,value] of Object.entries(stayDraft.values)){const index=days[activeDay].stops.findIndex(s=>s.id===id);if(index<0)continue;const form=$('timeline').querySelector(`[data-stay-form="${index}"]`);if(form){form.elements.durationHours.value=value.hours;form.elements.durationMinutes.value=value.minutes;if(value.time!==undefined)form.elements.time.value=value.time;}}
}
function showConflicts(){if(pending?.merge){const m=pending.merge;conflictUI.show(mergeTrip(pending.base,pending.days,m.remote.days,m.choices).conflicts,m.choices);}}
function mergedSchedule(candidate,remote){
 const before=JSON.stringify(candidate);clearStaleTravel(candidate);
 const notes=new Set();if(before!==JSON.stringify(candidate))notes.add('部分交通時間因路線變動已清除，請重新確認。');
 const prior=new Map(remote.flatMap(d=>d.stops.map(s=>[s.id,s])));
 for(const day of candidate){
  let start=day.stops.length;
  day.stops.forEach((s,i)=>{const old=prior.get(s.id);if(!old)return;if(s.duration!==old.duration||s.time!==old.time)start=Math.min(start,i+1);if(s.travelMinutes!==old.travelMinutes&&s.travelMinutes!==undefined)start=Math.min(start,i);});
  if(start<day.stops.length){const shifted=pushSchedule(day.stops,start,{exact:true});if(shifted.reason)notes.add(shifted.reason);}
 }
 return {days:candidate,reason:[...notes].join(' ')};
}
async function resolveConflicts(choices){
 if(!pending?.merge||busy)return;
 const latest=pending.merge.remote,result=mergeTrip(pending.base,pending.days,latest.days,choices);pending.merge.choices=choices;
 if(result.unresolved.length){conflictUI.show(result.conflicts,choices);conflictUI.message('請為每個衝突選擇保留的版本。');persistDraft();return;}
 const merged=mergedSchedule(result.days,latest.days);if(pending.importGuard)pending.importGuard.trip=latest.trip||currentTrip;pending.base=clone(latest.days);pending.days=merged.days;pending.revision=latest.revision;pending.mutationId=crypto.randomUUID();pending.merge=null;pending.message='已依你的選擇合併並儲存。'+merged.reason;conflict=false;conflictUI.close();persistDraft();await commit(null,null,null,null,true);
}

function cardTagValue(stop){return !isFixedStop(stop)&&tagDraft?.id===stop.id?tagDraft.value:stop.tag||'其他';}
function cardTag(stop,day){return renderCardTag(stop,day,{canEdit:access.canEdit,value:cardTagValue(stop)});}
function canEditCardTag(field){
 const stop=days[Number(field.dataset.tagDay)]?.stops.find(item=>item.id===field.dataset.tagId);
 if(!stop||isFixedStop(stop))return false;
 return !!tripId&&access.canEdit&&ready&&!busy&&!tripManager.pending&&!pending&&!conflict&&(!recovery||restoringDraft)&&!dayNameDraft&&!transportDirty&&!stayDraft&&!timelineEditorId&&!transportEditorId&&!editorDirty&&!importer.dirty&&!dragging&&!$('editor').open&&!$('import-dialog').open&&!$('transport-dialog').open&&(!tagDraft||tagDraft.id===field.dataset.tagId);
}
function previewCardTag(id,value,message=''){
 for(const field of document.querySelectorAll('[data-card-tag]'))if(field.dataset.tagId===id){
  field.value=value;
  const card=field.closest('[data-stop-id],[data-overview-stop-id]');
  if(card){for(const className of [...card.classList])if(className.startsWith('category-'))card.classList.remove(className);card.classList.add('category-'+tagCategory(value));}
  const status=field.closest('.card-tag-control').querySelector('.card-tag-status');status.textContent=message;
 }
}
function lockCardTags(){
 for(const field of document.querySelectorAll('[data-card-tag]')){
  field.disabled=!canEditCardTag(field);
  if(tagDraft?.id===field.dataset.tagId)previewCardTag(tagDraft.id,tagDraft.value,conflict?'待處理衝突':busy?'儲存中…':pending?'尚未儲存，請重試':'尚未儲存');
 }
}
async function saveCardTag(field){
 if(!field.isConnected||!canEditCardTag(field))return;
 const day=Number(field.dataset.tagDay),id=field.dataset.tagId,scope=tagDraft?.id===id?tagDraft.scope:tagScopes.get(field)||scopeSnapshot();let changed;
 try{changed=applyStopTag(scope.days,day,id,field.value);}catch(error){field.value=days[day]?.stops.find(stop=>stop.id===id)?.tag||'其他';notice(error.message);return;}
 if(!changed.changed){tagDraft=null;persistDraft();previewCardTag(id,field.value);lock();void autoSync.tick();return;}
 tagDraft={scope,day,id,value:changed.days[day].stops[changed.index].tag};persistDraft();previewCardTag(id,tagDraft.value,'儲存中…');
 await commit(changed.days,'已更新行程標籤',day,changed.index,false,false,scope,null,id);
}
function renderOverviewStop(s,i,j){
 return `<div class="overview-stop-row"><time class="overview-stop-time">${esc(s.time||'待安排')}</time><article class="mini-stop ${isFixedStop(s)?'is-fixed-stop ':''}${s.live===true?'has-stop-avatar ':''}category-${tagCategory(cardTagValue(s))}" data-overview-stop-id="${esc(s.id)}" data-details="${j}" data-owner="${i}" data-day="${i}" data-stop="${j}" role="button" tabindex="0" aria-label="${esc(s.name)}${isFixedStop(s)?'，固定行程':''}：查看行程詳情" ${access.canEdit?'title="長按或拖曳調整日期與順序；Alt＋方向鍵也可調整"':''} aria-pressed="${activeDay===i&&activeStop===j}">${renderFixedStopBadge(s)}<strong>${esc(s.name)}</strong>${cardTag(s,i)}${renderStopAvatar(s)}</article></div>`;
}
function renderBoard(){
 $('board').innerHTML=days.map((d,i)=>`<article class="day-card day-summary" data-overview-day="${i}" style="--day:${esc(d.color)};--tint:${esc(d.tint)}">${renderDayName(d,i,{canEdit:access.canEdit}).replaceAll("day-name-"+i,"overview-day-name-"+i)}<button class="day-choice" data-open-day="${i}" aria-label="查看第 ${i+1} 天 ${esc(d.date)} 行程"><span class="day-number">第 ${i+1} 天</span><span class="card-date">${esc(d.date)}</span></button><div class="day-items"><div class="card-stops">${d.stops.map((s,j)=>renderOverviewStop(s,i,j)).join('')||'<p class="empty">尚未安排行程</p>'}</div><button class="add-day" data-add="${i}" data-write>＋ 新增行程</button></div></article>`).join('');lock();
}
function renderTransportRow(stops,index){
 const draft=transportDirty&&transportDraft?.day===activeDay&&transportDraft.id===stops[index]?.id?transportDraft:null;
 return renderInlineTransportRow(stops,index,{canEdit:access.canEdit,draft,editing:transportEditorId===stops[index]?.id});
}
function inlineTransportForm(id=transportDraft?.id){return [...$('timeline').querySelectorAll('[data-transport-form]')].find(form=>form.dataset.transportId===id);}
function inlineTransportFeedback(form,message,error=false){
 const feedback=form?.querySelector('.inline-transfer-feedback');if(!feedback)return;
 feedback.textContent=message;feedback.classList.toggle('is-error',error);
}
function captureInlineTransport(form,target){
 if(!canChange())return false;
 const index=Number(form.dataset.transportForm),stop=days[activeDay]?.stops[index];if(!stop||stop.id!==form.dataset.transportId)return false;
 if(transportDirty&&transportDraft?.id!==stop.id){
  form.elements.mode.value=stop.mode||'walking';form.elements.minutes.value=savedTravelMinutes(days[activeDay].stops,index)??'';
  inlineTransportFeedback(form,'請先儲存或取消上一段交通時間。',true);return false;
 }
 if(editorDirty||importer.dirty||stayDraft){inlineTransportFeedback(form,'請先完成目前的行程編輯。',true);return false;}
 transportScope??=scopeSnapshot();
 const original=transportScope.days[activeDay].stops.find(item=>item.id===stop.id),mode=form.elements.mode.value;
 if(target===form.elements.mode)form.elements.minutes.value=mode===(original.mode||'walking')?(savedTravelMinutes(transportScope.days[activeDay].stops,index)??''):'';
 transportDraft={day:activeDay,id:stop.id,mode,minutes:form.elements.minutes.value};
 transportDirty=mode!==(original.mode||'walking')||transportDraft.minutes!==String(savedTravelMinutes(transportScope.days[activeDay].stops,index)??'');
 if(!transportDirty){transportScope=null;transportDraft=null;}
 const {shape}=transportIcons[mode]||transportIcons.walking;
 form.querySelector('.inline-mode-icon .transport-icon').innerHTML=shape;form.closest('.inline-transfer').classList.toggle('is-dirty',transportDirty);
 form.elements.minutes.setCustomValidity('');
 inlineTransportFeedback(form,transportDirty?'未儲存；完成後會重新計算後續時間。':'');
 if(transportDirty)$('save-status').textContent='交通時間尚未儲存';persistDraft();lockTransport();return true;
}
function discardInlineTransport(){
 if(busy||pending||conflict)return;transportDirty=false;transportScope=null;transportDraft=null;transportEditorId='';persistDraft();setDay(activeDay,activeStop);void autoSync.tick();
}
async function saveInlineTransport(form){
 if(!canChange())return;
 if(!captureInlineTransport(form,null))return;
 const scope=transportScope||scopeSnapshot(),day=activeDay,id=form.dataset.transportId;
 let result;
 try{result=applyManualTransport(scope.days,day,id,{mode:form.elements.mode.value,minutes:form.elements.minutes.value});}
 catch(error){form.elements.minutes.setCustomValidity(error.message);form.elements.minutes.reportValidity();inlineTransportFeedback(form,error.message,true);return;}
 if(!transportDirty){discardInlineTransport();return;}
 const message=`已更新交通 ${result.minutes} 分鐘${result.result.changed?`，已重新計算 ${result.result.changed} 個行程`:''}。${result.result.reason}`;
 const saved=await commit(result.days,message,day,result.index,false,true,scope);
 if(saved){transportEditorId='';setDay(day,result.index);$('timeline').querySelector(`[data-transport-edit="${result.index}"]`)?.focus({preventScroll:true});}
 else inlineTransportFeedback(form,$('sync-error-text').textContent||'尚未儲存，內容已保留。',true);
}
function renderTimelineRail(stop,index){
 const flight=stop.kind==='flight',active=timelineEditorId===stop.id,clock=stop.time||'待安排';
 const stay=(flight?'飛行 ':'停留 ')+formatDuration(stop.duration);
 const start=clockMinutes(stop.time),departure=start!==null&&Number.isInteger(stop.duration)?start+stop.duration:null;
 const end=departure===null?'':String(Math.floor(departure%1440/60)).padStart(2,'0')+':'+String(departure%60).padStart(2,'0');
 let display=`<time class="timeline-start">${esc(clock)}</time><span class="timeline-stay">${esc(stay)}</span>${end?`<span class="timeline-departure">${flight?'抵達':'離開'} ${end}${departure>=1440?' +1天':''}</span>`:''}${stop.live?'<span class="timeline-fixed">固定時間</span>':''}`;
 if(flight){
  try{
   const times=flightLocalTimes(stop.flight);
   const endpoint=(point,label,primary)=>`<time class="${primary?'timeline-start':'timeline-departure'} timeline-flight-endpoint" datetime="${esc(point.local)}" aria-label="${label} ${esc(point.time)}"><span class="timeline-flight-label">${label}</span><span class="timeline-flight-clock">${esc(point.time)}</span></time>`;
   display=endpoint(times.departure,'起飛',true)+endpoint(times.arrival,'抵達',false)+(stop.live?'<span class="timeline-fixed">固定時間</span>':'');
  }catch{display='<span class="timeline-stay">航班時間待確認</span>';}
 }
 if(!access.canEdit)return `<div class="timeline-rail"><div class="timeline-clock">${display}</div></div>`;
 const button=flight?`<button type="button" class="timeline-clock" data-details="${index}" data-owner="${activeDay}" aria-label="${esc(stop.name)}：修改機票時間">${display}</button>`:`<button type="button" class="timeline-clock" data-timeline-edit="${index}" data-write aria-expanded="${active}" aria-label="${esc(stop.name)}：點擊修改開始與停留時間">${display}</button>`;
 if(!active||flight)return `<div class="timeline-rail">${button}</div>`;
 const value=/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)?clock:'';
 return `<div class="timeline-rail is-editing">${button}<form class="timeline-time-form" data-stay-form="${index}" data-time-id="${esc(stop.id)}" aria-label="${esc(stop.name)}的時間"><label>開始時間<input type="time" name="time" value="${value}" data-write aria-label="${esc(stop.name)}的開始時間"></label><div class="timeline-stay-field"><span>停留時間</span>${durationPicker(stop.duration,stop.name,'timeline-duration-'+index)}</div>${!value?'<span class="timeline-original-time">保留原時間，或選擇新時間</span>':''}<div class="timeline-time-actions"><button type="submit" data-write>完成</button><button type="button" data-timeline-cancel>取消</button></div><p class="timeline-time-feedback" role="status" aria-live="polite"></p></form></div>`;
}
function openTimelineTime(index){
 if(!canChange()||transportDirty||editorDirty||importer.dirty||stayDraft&&timelineEditorId!==days[activeDay]?.stops[index]?.id){notice('請先完成目前的編輯。');return;}
 const stop=days[activeDay]?.stops[index];if(!stop||stop.kind==='flight')return;
 transportEditorId='';timelineEditorId=stop.id;setDay(activeDay,index);
 $('timeline').querySelector(`[data-stay-form="${index}"] input`)?.focus({preventScroll:true});
}
function discardTimelineTime(){
 if(busy||pending||conflict)return;stayDraft=null;timelineEditorId='';persistDraft();setDay(activeDay,activeStop);void autoSync.tick();
}
function captureTimelineTime(form){
 if(!canChange()||transportDirty||editorDirty||importer.dirty)return false;
 const index=Number(form.dataset.stayForm),stop=days[activeDay]?.stops[index];if(!stop||stop.id!==form.dataset.timeId)return false;
 if(stayDraft&&!Object.hasOwn(stayDraft.values,stop.id))return false;
 stayDraft??={scope:scopeSnapshot(),values:{}};
 stayDraft.values[stop.id]={hours:form.elements.durationHours.value,minutes:form.elements.durationMinutes.value,time:form.elements.time.value};
 form.querySelector('.timeline-time-feedback').textContent='完成後更新後續時間';persistDraft();lock();return true;
}
async function saveTimelineTime(form){
 if(!captureTimelineTime(form))return;
 const index=Number(form.dataset.stayForm),id=form.dataset.timeId,scope=stayDraft.scope,value=stayDraft.values[id];let changed;
 try{changed=applyTimelineTime(scope.days,activeDay,id,{...value,time:value.time||scope.days[activeDay].stops[index].time});}
 catch(error){form.querySelector('.timeline-time-feedback').textContent=error.message;return;}
 const message='已更新時間'+(changed.result.changed?'，已重新計算 '+changed.result.changed+' 個行程':'')+(changed.result.reason?'。'+changed.result.reason:'');
 const saved=await commit(changed.days,message,activeDay,changed.index,false,false,scope,id);
 if(saved)$('timeline').querySelector(`[data-timeline-edit="${changed.index}"]`)?.focus({preventScroll:true});
 else form.querySelector('.timeline-time-feedback').textContent=$('sync-error-text').textContent||'尚未儲存，內容已保留。';
}
function lockTimeline(){
 for(const button of $('timeline').querySelectorAll('[data-timeline-edit]'))button.disabled=!canChange()||transportDirty||editorDirty||importer.dirty||!!stayDraft&&button.closest('[data-stop-id]')?.dataset.stopId!==timelineEditorId;
 for(const form of $('timeline').querySelectorAll('[data-stay-form]')){for(const field of form.querySelectorAll('input,select,button'))field.disabled=!canChange()||transportDirty||editorDirty||importer.dirty;form.querySelector('[data-timeline-cancel]').disabled=busy||!!pending||conflict;}
}
function setDay(index,stop=0){
 if(tagDraft&&!restoringDraft){notice('標籤尚未儲存，請先重試儲存。');return;}
 if(dayNameDraft&&!restoringDraft){notice('請先儲存或取消每日名稱。');return;}
 if(stayDraft&&!restoringDraft&&index!==activeDay){notice('請先完成或取消時間編輯。');return;}
 if(index!==activeDay){transportEditorId='';timelineEditorId='';}
 const selected=boundedSelection(days,index,stop);activeDay=index=selected.day;activeStop=selected.stop;
 if(!days.length){$('day-tabs').innerHTML='';$('day-intro').innerHTML='<p>先從「我的旅行」建立或選擇一趟旅行。</p>';$('timeline').innerHTML='';renderMapStops();selectStop(activeStop);lock();return;}
 const d=days[index];
 renderDateTabs('day-tabs','tab','day-panel');
 $('day-intro').innerHTML=`<div class="day-edit-heading">${renderDayName(d,index,{canEdit:access.canEdit}).replaceAll("day-name-"+index,"daily-day-name-"+index)}<button class="primary" data-add="${index}" data-write>＋ 新增行程</button></div><p>${esc(d.intro||'')}</p><p class="timeline-zone-context">一般行程沿用旅行時區：${esc(currentTrip?.timezone||'未確認')}。航班顯示起飛／抵達地當地時間。</p>`;
 $('timeline').innerHTML=d.stops.map((s,j)=>`${renderTransportRow(d.stops,j)}<article class="stop timeline-stop ${isFixedStop(s)?'is-fixed-stop ':''}${s.live===true?'has-stop-avatar ':''}${s.kind==='flight'?'stop-flight ':''}category-${tagCategory(cardTagValue(s))} ${j===activeStop?'selected':''}" id="stop-${j}" data-stop-id="${esc(s.id)}" data-reorder-card data-details="${j}" data-owner="${index}" role="button" tabindex="0" aria-label="${esc([s.name,isFixedStop(s)?'固定行程':'',stopAvatarLabel(s)].filter(Boolean).join('，'))}" aria-describedby="reorder-hint">${renderTimelineRail(s,j)}<div class="stop-body"><div class="stop-card-head"><div class="stop-card-labels">${renderFixedStopBadge(s)}${cardTag(s,index)}</div>${renderStopAvatar(s)}</div><h3 class="stop-name">${esc(s.name)}</h3>${s.desc?`<p class="stop-description">${esc(s.desc).replace(/\n/g,'<br>')}</p>`:''}${s.kind==='flight'?flightCardSummary(s,renderFlightZoneNotices(s,j,index)):''}</div></article>`).join('')||'<div class="empty-day"><h3>把喜歡的地方，加進今天。</h3><p>這一天還沒有行程。</p><button class="primary" data-add="'+index+'" data-write>＋ 新增第一個行程</button></div>';
 $('reorder-hint').hidden=!access.canEdit;$('map-details').dataset.details=activeStop;$('map-details').dataset.owner=index;
 $('day-tip').textContent=d.tip;$('toolbar-add').dataset.add=index;renderMapStops();selectStop(activeStop);restoreStayInputs();lock();
}
function selectStop(index){
 const d=days[activeDay];activeStop=boundedSelection(days,activeDay,index).stop;index=activeStop;const s=d?.stops[index];
 document.querySelectorAll('.stop').forEach((el,j)=>{el.classList.toggle('selected',j===index);if(j===index)el.setAttribute('aria-current','true');else el.removeAttribute('aria-current');});
 document.querySelectorAll('.mini-stop').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.day)===activeDay&&Number(el.dataset.stop)===index)));
 document.querySelectorAll('[data-map-stop]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.mapDay)===activeDay&&Number(el.dataset.mapStop)===index)));
 let share='';try{share=parseMapsShare(s?.mapUrl);}catch{}
 const destination=routeLocation(s,d?.stops||[],resolvedPlaces),shareOnly=!!share&&!destination;
 if(!destination&&share)void ensureLocation(s,d.stops).then(query=>{if(query&&days[activeDay]===d&&activeStop===index)selectStop(index);});
 $('map-title').textContent=destination||share?s.name:(s?'尚未設定地點':'今天的地圖');const q=destination;
 $('map').hidden=shareOnly;$('shared-map-placeholder').hidden=!shareOnly;
 renderPlaceMap();renderRouteMaps();
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
 const visible=currentPage==='map'&&$('google-place-preview').open&&!shareOnly;
 $('place-map-wrap').hidden=shareOnly;$('reload-place-map').hidden=!visible;
 $('reload-place-map').textContent=embedState==='auth'?'重新登入載入地圖':'重新載入地圖';
 if(!visible){placeFrame.clear();return;}
 if(!destination){placeFrame.clear();$('map').hidden=true;$('place-map-status').hidden=false;$('place-map-status').textContent='新增或選擇地點後顯示地圖。';$('reload-place-map').hidden=true;return;}
 if(embedKey){$('map').hidden=false;placeFrame.load(placeEmbedUrl(destination,embedKey),'Google Maps：'+s.name,{force});}
 else{placeFrame.clear();$('map').hidden=true;$('place-map-status').hidden=false;$('place-map-status').textContent=mapsConfigMessage();}
}
function signIn(){if(demoMode){location.reload();return;}if(appBase||googleAuth){location.assign(appBase+'/login?return_to='+encodeURIComponent(location.pathname+location.search));return;}location.assign('/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search));}
function clearUnavailableTrip(){
 geolocation.reset({forget:true});
 routeMap?.destroy();overviewMap?.destroy();dailyRouteMap?.destroy();routeMap=overviewMap=dailyRouteMap=null;$('itinerary-route-map').replaceChildren();$('overview-route-map').replaceChildren();$('daily-route-map')?.replaceChildren();transportEditorId='';timelineEditorId='';
 const saved=persistDraft();ready=false;autoSync.stop();access={...access,canEdit:false,canShare:false};sharing.setSession(access);
 if(saved){
  // Keep the existing account/trip draft key for a later restoration, while
  // detaching this unavailable document so navigation cannot clear that draft.
  draftStore=null;recovery=null;editorDirty=transportDirty=false;editorScope=transportScope=null;transportDraft=null;transportEditorId='';timelineEditorId='';editing=null;stayDraft=null;dayNameDraft=null;tagDraft=null;pending=null;conflict=false;
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
function assertImportedSchedule(next,guard,trip){
 if(!guard)return;const ids=new Set(guard.rows.map(row=>row.id)),rows=next.flatMap((day,d)=>day.stops.filter(stop=>ids.has(stop.id)).map(stop=>({...stop,day:d})));
 const existing=next.map(day=>({...day,stops:day.stops.filter(stop=>!ids.has(stop.id))})),problems=reviewImport(rows,existing,trip||{});
 if(problems.length){const error=Error('匯入行程與最新安排有衝突：'+problems[0].message+' 請調整匯入項目後再儲存。');error.status=400;throw error;}
}
function stagePermanentRecovery(deletedIds,{dropDeletion=false}={}){
 const live=currentDraft(),source={...(recovery||{}),tripId};
 for(const key of ['editor','transport','stay','dayName','tag','pending','imported'])if(live[key])source[key]=live[key];
 if(dropDeletion&&source.pending?.deleteStopId)delete source.pending;
 recovery=sanitizePermanentDraft(source,deletedIds);
 // Requiring the user to restore/review the sanitized draft also prevents a
 // stale conflict choice or automatic retry from reviving the removed item.
 if(recovery?.pending){delete recovery.pending.merge;recovery.pending.mutationId=crypto.randomUUID();}
 days=withoutDeletedStops(days,deletedIds);previous=withoutDeletedStops(previous,deletedIds);
 editorDirty=transportDirty=false;editorScope=transportScope=null;transportDraft=null;stayDraft=null;dayNameDraft=null;tagDraft=null;editing=null;pending=null;conflict=false;transportEditorId='';timelineEditorId='';
 conflictUI.close();if($('editor').open)$('editor').close();if($('transport-dialog').open)$('transport-dialog').close();if($('import-dialog').open)importer.close();
 if(deletedIds.length)travelCache?.deleteTrip(tripId);
 const saved=recovery?draftStore?.write(recovery):draftStore?.clear();
 $('draft-recovery').hidden=!recovery;refresh();
 if(saved===false)notice('瀏覽器無法保存清理後的草稿，請保留此頁並檢查未儲存修改。');
 return recovery;
}
async function rejectPermanentWrite(task,error,epoch){
 const deleting=!!task.deleteStopId,ids=deleting||!Array.isArray(error.data?.deletedStopIds)?[]:error.data.deletedStopIds.filter(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id));
 stagePermanentRecovery(ids,{dropDeletion:deleting});
 $('save-status').textContent=deleting?'刪除需要重新確認':'部分行程已永久刪除';
 const latest=await fetchJson();if(epoch!==identityEpoch)return false;
 if(latest.trip?.id!==tripId||!Array.isArray(latest.days)||!Number.isSafeInteger(latest.revision))throw Error('最新行程回應不完整，請重新載入後再操作。');
 latest.days=withoutDeletedStops(latest.days,ids);latest.previous=withoutDeletedStops(latest.previous,ids);
 cacheConfirmed(latest);applyTripRole(latest.role);days=latest.days;previous=latest.previous;revision=latest.revision;currentTrip=latest.trip;renderTripMeta();refresh(task.day,Math.max(0,task.stop));
 const message=(deleting?'行程已在其他裝置更新，請重新查看最新內容，再確認永久刪除。':'已移除永久刪除的行程並載入最新版本，沒有自動合併或恢復已刪除項目。')+(recovery?draftStore?.failed?'其他修改仍留在目前頁面，瀏覽器無法保存草稿；請先保留此頁，避免重新整理或離開。':'其他未儲存修改保留在此裝置的草稿，請檢查後再儲存。':'');
 $('sync-error-text').textContent=message;$('sync-error').hidden=false;$('retry').textContent='重新載入';$('form-error').textContent='';notice(message);return false;
}
async function commit(next,message,day=activeDay,stop=activeStop,retry=false,transport=false,scope=null,stayId=null,tagId=null,importGuard=null){
 if(conflict){showConflicts();return false;}
 if(tagDraft&&!tagId&&!retry){notice('標籤尚未儲存，請先重試儲存。');return false;}
 if(transportDirty&&!transport&&!retry){notice('請先儲存或取消卡片之間的交通時間。');return false;}
 if(stayDraft&&!stayId&&!retry){notice('請先完成或取消時間編輯。');return false;}
 if(!tripId||!access.canEdit||!ready||busy)return false;
 if(scope?.tripId&&scope.tripId!==tripId||pending?.tripId&&pending.tripId!==tripId){notice('這份草稿屬於其他旅行，請回到原旅行儲存。');return false;}
 if(!retry)pending={tripId,base:clone(scope?.days||days),days:clearStaleTravel(next),revision:scope?.revision??revision,mutationId:crypto.randomUUID(),message,day,stop,transport,stayId,tagId,...(importGuard?{importGuard}: {})};
 const task=pending;if(!task)return false;const epoch=identityEpoch;busy=true;$('save-status').textContent=task.deleteStopId?'正在永久刪除…':'正在儲存…';lock();
 persistDraft();
 try{
  let result;
  for(let attempt=0;attempt<4;attempt++){
   try{
    if(!task.deleteStopId)assertImportedSchedule(task.days,task.importGuard,task.importGuard?.trip||currentTrip);
    const body=task.deleteStopId?{permanent:true,deleteStopId:task.deleteStopId,revision:task.revision,mutationId:task.mutationId}:{days:task.days,revision:task.revision,mutationId:task.mutationId};
    result=await fetchJson({method:'PUT',headers:{'Content-Type':'application/json','X-Trip-Client':'multi-2'},body:JSON.stringify(body)});
    if(task.deleteStopId){
     const valid=value=>Array.isArray(value)&&value.every(day=>Array.isArray(day?.stops));
     if(result.permanent!==true||result.deletedStopId!==task.deleteStopId||result.trip?.id!==tripId||!Number.isSafeInteger(result.revision)||result.revision<=task.revision||!valid(result.days)||result.previous!==null&&!valid(result.previous)||[result.days,result.previous].filter(Boolean).some(list=>list.some(day=>day.stops.some(stop=>stop.id===task.deleteStopId))))throw Error('永久刪除回應不完整，請重試確認結果。');
    }
    break;
   }
     catch(error){
      if(epoch!==identityEpoch)return false;
      if(error.status!==409)throw error;
      if(task.deleteStopId||error.data?.code==='PERMANENT_STOP_DELETED')return await rejectPermanentWrite(task,error,epoch);
      const latest=await fetchJson(),merged=mergeTrip(task.base,task.days,latest.days);
      if(epoch!==identityEpoch)return false;
    if(merged.unresolved.length){task.merge={remote:latest,choices:{}};conflict=true;$('save-status').textContent='有欄位衝突，請選擇保留版本';$('sync-error-text').textContent='未儲存內容已保留，請處理衝突。';$('retry').textContent='處理衝突';$('sync-error').hidden=false;showConflicts();persistDraft();return false;}
    assertImportedSchedule(merged.days,task.importGuard,latest.trip||currentTrip);
    const checked=mergedSchedule(merged.days,latest.days);assertImportedSchedule(checked.days,task.importGuard,latest.trip||currentTrip);if(task.importGuard)task.importGuard.trip=latest.trip||currentTrip;task.base=clone(latest.days);task.days=checked.days;task.revision=latest.revision;task.mutationId=crypto.randomUUID();task.message='已自動合併其他人的修改。'+checked.reason;persistDraft();
   }
  }
  if(epoch!==identityEpoch)return false;
  if(!result)throw Error('同行者仍在更新行程，內容已保留，請稍後重試儲存。');
  const deletionRecovery=task.deleteStopId?stagePermanentRecovery([task.deleteStopId]):null;
  cacheConfirmed(result);days=result.days;currentTrip=result.trip||currentTrip;previous=result.previous;revision=result.revision;renderTripMeta();pending=null;dayNameDraft=null;editorDirty=false;editorScope=null;transportDirty=false;transportScope=null;transportDraft=null;transportEditorId='';timelineEditorId='';recovery=deletionRecovery;$('draft-recovery').hidden=!recovery;
  if(task.tagId===tagDraft?.id)tagDraft=null;
  if(task.stayId&&stayDraft){delete stayDraft.values[task.stayId];if(!Object.keys(stayDraft.values).length)stayDraft=null;}
  if(stayDraft){recovery={stay:clone(stayDraft)};$('draft-recovery').hidden=false;}
  $('sync-error').hidden=true;$('save-status').textContent='已儲存至雲端';$('editor').close();if($('import-dialog').open)importer.close();editing=null;refresh(task.day,task.stop);persistDraft();notice(task.message);if($('transport-dialog').open){renderTransport();$('transport-feedback').textContent=task.message;}return true;
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
  const invalid=[400,413,415,428].includes(e.status);$('save-status').textContent='尚未儲存';$('form-error').textContent=e.message;$('sync-error-text').textContent=e.message+(invalid?' 請修正欄位後重新儲存。':!pending?' 請重新載入最新行程後再檢查保留的草稿。':task.deleteStopId?' 可按「重試刪除」確認原操作的結果。':' 可按「重試儲存」，不必重新輸入。');$('retry').textContent=authExpired?'重新登入':e.status===403?'重新確認權限':invalid?'重新連線':pending?.deleteStopId?'重試刪除':pending?'重試儲存':'重新載入';$('sync-error').hidden=false;if($('transport-dialog').open)$('transport-feedback').textContent=e.message;if(invalid)pending=null;persistDraft();return false;
 }
 finally{if(epoch===identityEpoch){busy=false;lock();}}
}
function restorePlaceTypeFields(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const limits={coordinates:100,mapUrl:2048,q:300};
 if(Object.entries(limits).some(([key,limit])=>typeof raw[key]!=='string'||raw[key].length>limit))return null;
 return Object.fromEntries(Object.keys(limits).map(key=>[key,raw[key]]));
}
let editorPlaceTypeFields=null;
function populateEditorType(stop={},selection=null){
 const options=itineraryTypeOptions([stop.tag,...days.flatMap(day=>day.stops.map(item=>item.tag))]);
 const field=$('field-kind');field.innerHTML=options.map(option=>`<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
 const value=selection||itineraryTypeValue(stop);field.value=options.some(option=>option.value===value)?value:'place';field.dataset.previousKind=field.value==='flight'?'flight':'place';
}
function syncEditorTypeTag(){
 const result=resolveItineraryType($('field-kind').value,$('field-tag').value);
 if(result.kind==='place'){$('field-tag').innerHTML=tagOptions(result.tag).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');$('field-tag').value=result.tag;updateTagPreview();}
}
function openEditor(day,index=null,scope=null,view=false){
 if(tagDraft&&!restoringDraft){notice('標籤尚未儲存，請先重試儲存。');return;}
 if(!view&&transportDirty){notice('請先儲存或取消卡片之間的交通時間。');return;}
 if(stayDraft&&!restoringDraft){notice('請先完成或取消時間編輯。');return;}
 if(!transportDirty){transportEditorId='';timelineEditorId='';}
 if(!ready||busy||pending||conflict||(!view&&!canChange()))return;editorReadOnly=view;editorScope=scope||scopeSnapshot();editorDirty=false;newStopId=crypto.randomUUID();editing=index===null?null:{day,index,id:editorScope.days[day].stops[index].id};const s=index===null?{}:editorScope.days[day].stops[index];
 $('editor-form').reset();editorPlaceTypeFields=null;populateEditorType(s);$('field-coordinates').value=pointText(knownStopPoint(s,geolocation.overlay().flatMap(item=>item.stops)));initFlightFields(s.flight,day);$('field-name').setCustomValidity('');$('editor-title').textContent=view?'行程詳情':index===null?'新增行程':'編輯行程';$('field-day').innerHTML=days.map((d,i)=>`<option value="${i}">${esc(d.isoDate||d.date)} ${esc(d.week)}</option>`).join('');$('field-day').value=day;
 $('field-tag').innerHTML=tagOptions(s.tag).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
 for(const key of ['name','time','desc','mapUrl'])$('field-'+key).value=s[key]??'';$('field-fixed').checked=s.live===true;$('field-q').value=s.routeQuery||s.q||routeLocation(s,days[day].stops,resolvedPlaces);$('field-tag').value=s.tag||'其他';updateTagPreview();$('field-duration').innerHTML=durationPicker(s.duration,'行程','field-duration');$('field-mode').value=s.mode||'walking';$('form-error').textContent='';updateSharePreview();updateEditorOrder(true);renderEditorSummary(day,index,s);$('editor-location').open=index===null;$('editor').showModal();lock();$(view?(access.canEdit?'editor-start-edit':'editor-close'):index===null?'field-q':'field-name').focus();
 renderEditorGeolocation();
}
function renderEditorGeolocation(){
 let panel=$('editor-geocode-results');
 if(!panel){panel=document.createElement('div');panel.id='editor-geocode-results';panel.className='map-note';panel.setAttribute('aria-live','polite');$('field-coordinates').closest('label').after(panel);}
 panel.replaceChildren();panel.hidden=$('field-kind').value==='flight';if(panel.hidden)return;
 const original=editing?editorScope?.days[editing.day]?.stops[editing.index]:null;
 let mapUrl='';try{mapUrl=parseMapsShare($('field-mapUrl').value);}catch{}
 const query=$('field-q').value.trim(),draft={id:original?.id||newStopId,q:query,routeQuery:query,mapUrl};
 const same=original&&geocodeStopKey(tripId,original)===geocodeStopKey(tripId,draft),result=same?geolocation.status(original):null;
 const parts=$('field-coordinates').value.trim().split(','),point=parts.length===2?normalizeCoordinates({lat:parts[0],lng:parts[1]}):null;
 const message=document.createElement('p');message.textContent=point?'已填入地圖座標。儲存後套用。':result?geolocationStatusText(result):'儲存後會自動定位；也可貼上完整 Google Maps 地點連結或座標。';panel.append(message);
 if(point||result?.status!=='ambiguous')return;
 for(const candidate of result.candidates||[]){
  const item=document.createElement('div'),name=document.createElement('p');name.textContent=[candidate.label,candidate.address].filter(Boolean).join(' · ');item.append(name);
  if(candidate.kind==='area'){const help=document.createElement('small');help.textContent='這是區域位置，請補上實際地點或地址。';item.append(help);}
  else{
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='使用這個位置';button.dataset.geocodeCandidate='';button.disabled=editorReadOnly||!canChange();
   button.addEventListener('click',()=>{if(editorReadOnly||!canChange())return;$('field-coordinates').value=pointText(candidate.coordinates);editorDirty=true;persistDraft();renderEditorGeolocation();});item.append(button);
  }
  panel.append(item);
 }
 const attribution=document.createElement('small');attribution.textContent='候選資料：Photon / © OpenStreetMap contributors。請確認地址後選擇。';panel.append(attribution);
}
function renderEditorSummary(day,index,stop){
 const duration=formatDuration(stop.duration),destination=stop.routeQuery||stop.q||routeLocation(stop,days[day].stops,resolvedPlaces);
 $('editor-summary').innerHTML=index===null?'':`<h3>${esc(stop.name)}</h3><div class="detail-meta">${renderFixedStopBadge(stop)}<span>${esc(days[day].date)} ${esc(days[day].week)}</span><span class="tag category-${tagCategory(stop.tag)}">${esc(stop.tag||'其他')}</span></div><dl><div><dt>停留時間</dt><dd>${duration}</dd></div>${destination?`<div class="detail-place"><dt>地點</dt><dd>${esc(destination)}</dd></div>`:''}${stop.live===true?`<div><dt>新增者</dt><dd>${esc(stopAvatarLabel(stop).startsWith('新增者：')?stopAvatarLabel(stop).slice(4):'尚未記錄')}</dd></div>`:''}</dl>${stop.desc?`<p class="detail-notes">${esc(stop.desc).replace(/\n/g,'<br>')}</p>`:''}${stop.source?`<a class="stop-link" href="${esc(stop.source)}" target="_blank" rel="noopener noreferrer">演出資訊</a>`:''}`;
 if(index!==null&&stop.kind==='flight')$('editor-summary').insertAdjacentHTML('beforeend',flightCardSummary(stop)+(stop.flight.terminal?'<p>航廈：'+esc(stop.flight.terminal)+'</p>':'')+(stop.flight.bookingReference?'<p>訂位代號：'+esc(stop.flight.bookingReference)+'</p>':'')+(stop.flight.notes?'<p>'+esc(stop.flight.notes).replace(/\n/g,'<br>')+'</p>':''));
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
async function remove(day,index){
 if(!canChange()||editorReadOnly&&$('editor').open||transportDirty||stayDraft||importer.dirty)return false;
 const scope=$('editor').open&&editing?editorScope:scopeSnapshot();
 if(scope?.tripId!==tripId)return false;
 const id=$('editor').open&&editing?editing.id:scope.days[day]?.stops[index]?.id;
 const selected=scope.days.flatMap(item=>item.stops).find(stop=>stop.id===id);if(!selected)return false;
 if(!window.confirm(`永久刪除「${selected.name}」？此行程及復原資料都會刪除，無法復原。`))return false;
 if(!canChange())return false;
 pending={tripId,deleteStopId:id,revision:scope.revision,mutationId:crypto.randomUUID(),message:`已永久刪除「${selected.name}」，無法復原。`,day,stop:Math.max(0,index-1)};
 return commit(null,null,null,null,true);
}
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
async function moveOverviewStop(id,day,to,scope=scopeSnapshot()){
 if(!canChange()||editorDirty||transportDirty||stayDraft||dayNameDraft||importer.dirty)return false;
 let moved;try{moved=moveStopBetweenDays(scope.days,id,day,to);}catch(error){notice(error.message);return false;}
 const message=(moved.fromDay===day?'已調整行程順序':'已移至 '+(moved.days[day].isoDate||moved.days[day].date))+(moved.cleared?'；路線改變的交通時間已清除，請重新確認。':'')+(moved.changed?' 已重新計算 '+moved.changed+' 個行程時間。':'')+(moved.reason?' '+moved.reason:'');
 const saved=await commit(moved.days,message,day,to,false,false,scope);
 if(saved){const card=[...$('board').querySelectorAll('[data-overview-stop-id]')].find(item=>item.dataset.overviewStopId===id);card?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});card?.focus({preventScroll:true});}return saved;
}
async function move(index,step){const to=index+step;if(to<0||to>=days[activeDay].stops.length)return;await reorderStop(days[activeDay].stops[index].id,to);}
async function importRows(rows,scope,kind='maps'){
 if(!canChange())return;
 const epoch=identityEpoch,permissions=permissionEpoch;
 // Save first. A lookup failure must not discard the user's imported places.
 const peers=geolocation.overlay().flatMap(day=>day.stops);
 for(const row of rows){const point=knownStopPoint(row,peers);if(point)row.coordinates=point;}
 if(epoch!==identityEpoch||permissions!==permissionEpoch||scope.tripId!==tripId||!canChange())throw Error('登入或旅行權限已變更，請重新開啟匯入。');
 const next=insertImported(scope.days,rows),last=rows.at(-1),index=next[last.day].stops.findIndex(s=>s.id===last.id);
 const saved=await commit(next,'已匯入 '+rows.length+' 個行程',last.day,index,false,false,scope,null,null,kind==='gpt'?{rows,trip:scope.trip}:null);
 if(!saved&&!pending&&!conflict)throw Error($('form-error').textContent||'行程尚未儲存，請確認目前的登入及編輯權限。');
}
document.addEventListener('click',e=>{
 if(e.target.closest('.card-tag-control'))return;
 const link=e.target.closest('[data-page-link]');if(link&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();showPage(link.dataset.pageLink);return;}
 const action=e.target.closest('button,[data-reorder-card],[data-overview-stop-id]');if(!action)return;
 const menu=action.closest('.toolbar-more');if(menu)menu.open=false;
 if(action.disabled)return;
 if(action.hasAttribute('data-day-name-cancel')){cancelDayName(action.closest('[data-day-name-form]'));return;}
 if(action.hasAttribute('data-transport-cancel')){discardInlineTransport();return;}
 if(action.hasAttribute('data-timeline-cancel')){discardTimelineTime();return;}
 if(action.hasAttribute('data-timeline-edit')){openTimelineTime(Number(action.dataset.timelineEdit));return;}
 if(action.hasAttribute('data-transport-edit')){if(!canChange()||stayDraft||editorDirty||importer.dirty||transportDirty&&transportDraft?.id!==action.dataset.transportId){notice('請先完成目前的編輯。');return;}timelineEditorId='';transportEditorId=action.dataset.transportId;setDay(activeDay,activeStop);inlineTransportForm(transportEditorId)?.elements.minutes.focus({preventScroll:true});return;}
 // Inline fields belong to their form; the surrounding card must not claim their clicks.
 if(e.target.closest('[data-stay-form],[data-transport-form]')&&!action.hasAttribute('data-transport'))return;
 if(e.target.closest('.timeline-rail')&&!action.hasAttribute('data-details')&&!action.hasAttribute('data-transport'))return;
 if(action.hasAttribute('data-open-day')){setDay(Number(action.dataset.openDay));showPage('daily');return;}
 if(action.hasAttribute('data-view-map')){if($('editor').open&&editorReadOnly)$('editor').close();selectStop(Number(action.dataset.viewMap));showPage('map');return;}
 if(action.hasAttribute('data-transport')){openTransport(Number(action.dataset.transport));return;}
 if(action.hasAttribute('data-map-stop')){if(dayNameDraft||transportDirty)return;setDay(Number(action.dataset.mapDay),Number(action.dataset.mapStop));return;}
 if(action.hasAttribute('data-close')){if(!pending&&!conflict){editing=null;editorDirty=false;editorScope=null;persistDraft();}$('editor').close();return;}
 if(action.hasAttribute('data-details')){const day=Number(action.dataset.owner),index=Number(action.dataset.details);setDay(day,index);openEditor(day,index,null,true);return;}
 if(action.id==='flight-add'){if(!canChange()||$('editor').open)return;openEditor(activeDay);if($('editor').open){$('field-kind').value='flight';$('field-kind').dataset.previousKind='flight';updateFlightEditor();$('field-name').value='航班';$('editor-title').textContent='新增班機';$('editor-flight-fields').querySelector('input').focus();}return;}
 if(action.hasAttribute('data-add')){openEditor(Number(action.dataset.add));return;}
 if(action.hasAttribute('data-edit')){openEditor(Number(action.dataset.owner),Number(action.dataset.edit));return;}
 if(action.hasAttribute('data-remove')){void remove(Number(action.dataset.owner),Number(action.dataset.remove));return;}
 if(action.hasAttribute('data-move')){void move(Number(action.dataset.move),Number(action.dataset.step));return;}
 if(action.hasAttribute('data-day')){setDay(Number(action.dataset.day),Number(action.dataset.stop));showPage('daily');return;}
 if(action.hasAttribute('data-tab')){const prefix=action.dataset.tabPrefix;setDay(Number(action.dataset.tab));$(`${prefix}-${activeDay}`).focus({preventScroll:true});return;}
 if(action.hasAttribute('data-select'))selectStop(Number(action.dataset.select));
});
$('timeline').addEventListener('submit',event=>{
 const timeForm=event.target.closest('[data-stay-form]');if(timeForm){event.preventDefault();event.stopPropagation();void saveTimelineTime(timeForm);return;}
 const form=event.target.closest('[data-transport-form]');if(!form)return;
 event.preventDefault();event.stopPropagation();void saveInlineTransport(form);
});
$('timeline').addEventListener('keydown',e=>{
 if(e.key==='Escape'&&e.target.closest('[data-transport-form]')){e.preventDefault();discardInlineTransport();return;}
 if(e.key==='Escape'&&e.target.closest('[data-stay-form]')){e.preventDefault();discardTimelineTime();return;}
 const card=e.target.closest('[data-reorder-card]');
 if(card&&e.target===card&&['Enter',' '].includes(e.key)){e.preventDefault();card.click();}
});
$('board').addEventListener('keydown',event=>{
 const card=event.target.closest('[data-overview-stop-id]');
 if(card&&event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();card.click();}
});
document.addEventListener('focusin',event=>{
 const field=event.target.closest('[data-card-tag]');if(field&&canEditCardTag(field))tagScopes.set(field,tagDraft?.id===field.dataset.tagId?tagDraft.scope:scopeSnapshot());
});
document.addEventListener('focusout',event=>{if(event.target.matches('[data-card-tag]'))queueMicrotask(()=>void autoSync.tick());});
document.addEventListener('change',event=>{const field=event.target.closest('[data-card-tag]');if(field)void saveCardTag(field);});
for(const id of ['day-tabs','map-day-tabs'])$(id).addEventListener('keydown',e=>{
 const tab=e.target.closest('[data-tab]');
 if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?days.length-1:(Number(tab.dataset.tab)+(e.key==='ArrowLeft'?-1:1)+days.length)%days.length;
 setDay(index);$(`${tab.dataset.tabPrefix}-${index}`).focus({preventScroll:true});
});
$('editor-form').addEventListener('submit',async e=>{
 e.preventDefault();if(editorReadOnly||!access.canEdit||!ready||busy)return;if(conflict){showConflicts();return;}if(pending){await commit(null,null,null,null,true);return;}
 const next=clone(editorScope?.days||days),day=Number($('field-day').value),original=editing?next[editing.day].stops[editing.index]:{};const stop={...original,id:original.id||newStopId||crypto.randomUUID()};
 const coordinateText=$('field-coordinates').value.trim(),coordinateParts=coordinateText.split(',');
 const requestedCoordinates=coordinateParts.length===2?normalizeCoordinates({lat:coordinateParts[0],lng:coordinateParts[1]}):null;
 if(coordinateText&&!requestedCoordinates){$('form-error').textContent='座標請使用有效的「緯度, 經度」。';return;}
 try{const link=parseMapsShare($('field-mapUrl').value);if(!editing&&!link&&!$('field-q').value.trim()&&!requestedCoordinates&&$('field-kind').value!=='flight')throw Error('請填寫實際要去的地點／地址、地點座標，或 Google Maps 分享連結。');delete stop.mapUrl;delete stop.placeId;if(link)stop.mapUrl=link;}catch(error){$('field-mapUrl').setCustomValidity(error.message);$('field-mapUrl').reportValidity();return;}
 syncEditorTypeTag();for(const key of ['name','time','tag','q','desc','mode'])stop[key]=$('field-'+key).value.trim();if(!stop.name){$('field-name').setCustomValidity('請填寫行程名稱');$('field-name').reportValidity();return;}
 if($('field-fixed').checked)stop.live=true;else delete stop.live;
 delete stop.coordinates;
 if(requestedCoordinates)stop.coordinates=requestedCoordinates;
 delete stop.routeQuery;if(stop.q)stop.routeQuery=stop.q;else delete stop.placeId;
 if(!stop.coordinates){const point=knownStopPoint(stop,geolocation.overlay().flatMap(item=>item.stops));if(point)stop.coordinates=point;}
 delete stop.duration;let stay=readStay($('editor-form'));
 if($('field-kind').value==='flight'){
  try{stop.kind='flight';stop.flight=sanitizeFlight(readFlightFields());const schedule=flightTripSchedule(stop.flight,currentTrip.timezone);if(schedule.date!==next[day].isoDate)throw Error('出發時間換算為旅行時區後是 '+schedule.date+'，請選擇相同的安排日期。');stop.time=schedule.time;stay=schedule.duration;stop.live=true;stop.tag=original.kind==='flight'?(original.tag||'機票'):'機票';stop.q=stop.flight.departureAirport;stop.routeQuery=stop.q;}catch(error){$('form-error').textContent=error.message;return;}
 }else{delete stop.kind;delete stop.flight;}
 if(stay!==undefined)stop.duration=stay;stop.tag=stop.tag||'行程';stop.time=stop.time||'待安排';
 if(editing)next[editing.day].stops.splice(editing.index,1);
 const index=Math.max(0,Math.min(Number($('field-order').value),next[day].stops.length));
 next[day].stops.splice(index,0,stop);if(editing&&editing.day!==day){delete stop.travelMinutes;delete stop.travelSignature;}clearStaleTravel(next);
 const placementChanged=editing&&(editing.day!==day||editing.index!==index),shifted={changed:0,reason:''};
 const starts=placementChanged?(editing.day===day?[[day,Math.max(1,Math.min(editing.index,index))]]:[[editing.day,Math.max(1,editing.index)],[day,Math.max(1,index)]]):(stay!==original.duration||stop.time!==original.time?[[day,index+1]]:[]);
 const reasons=new Set();for(const [affected,start] of starts){if(start>=next[affected].stops.length)continue;const result=pushSchedule(next[affected].stops,start,{exact:true});shifted.changed+=result.changed;if(result.reason)reasons.add(result.reason);}shifted.reason=[...reasons].join(' ');
 await commit(next,(editing?'行程已更新':'已新增行程')+(shifted.changed?'，已重新計算 '+shifted.changed+' 個行程':'')+(shifted.reason?'。'+shifted.reason:''),day,index,false,false,editorScope,stop.id);
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
$('retry').addEventListener('click',()=>{if(conflict){showConflicts();return;}if(authExpired){persistDraft();signIn();return;}void loadMapsConfig();if(pending&&ready&&access.canEdit){void commit(null,null,null,null,true);return;}if(tagDraft){const field=[...document.querySelectorAll('[data-card-tag]')].find(item=>item.dataset.tagId===tagDraft.id);if(field)void saveCardTag(field);return;}void boot();});
$('print').addEventListener('click',()=>window.print());
$('trip-rename-open').addEventListener('click',async()=>{if(!canChange()||!canSwitchTrip())return;showPage('trips');await tripManager.enter();tripManager.openRename(tripId);});
$('editor-start-edit').addEventListener('click',()=>{if(!canChange())return;if(transportDirty){notice('請先儲存或取消卡片之間的交通時間。');return;}editorReadOnly=false;$('editor-title').textContent='編輯行程';lock();$('field-name').focus();});
$('editor-delete').addEventListener('click',()=>{if(canChange()&&editing)void remove(editing.day,editing.index);});
window.addEventListener('popstate',()=>{
 if(tagDraft){persistDraft();history.replaceState(null,'',routeUrl(currentPage,activeDay,activeStop,appBase,tripId));notice('標籤尚未儲存，請先重試儲存。');return;}
 if(dayNameDraft){persistDraft();history.replaceState(null,'',routeUrl(currentPage,activeDay,activeStop,appBase,tripId));notice('名稱編輯尚未完成，請離開欄位自動儲存，或按 Esc 取消。');return;}
 if(busy||pending||conflict||dragging){history.replaceState(null,'',routeUrl(currentPage,activeDay,activeStop,appBase,tripId));notice('請先完成目前的儲存或衝突處理。');return;}
 if(draftStore&&!persistDraft()){history.replaceState(null,'',routeUrl(currentPage,activeDay,activeStop,appBase,tripId));return;}
 if((new URL(location.href).searchParams.get('trip')||'')!==tripId){autoSync.stop();location.reload();return;}
 if(editorDirty||transportDirty||stayDraft||importer.dirty){
  recovery=draftStore?.read()||null;editorDirty=transportDirty=false;editorScope=transportScope=null;transportDraft=null;transportEditorId='';timelineEditorId='';editing=null;stayDraft=null;
  if($('import-dialog').open)importer.close();$('draft-recovery').hidden=!recovery;
 }
 for(const id of ['editor','transport-dialog','import-dialog'])if($(id).open)$(id).close();
 const route=readRoute(location.href);currentPage=route.page;setDay(route.day,route.stop);showPage(route.page,{record:false});if(route.page==='trips')void tripManager.enter();
});
window.addEventListener('beforeunload',e=>{if(tripManager.dirty||((pending||editorDirty||transportDirty||stayDraft||dayNameDraft||tagDraft||importer.dirty)&&!persistDraft())){e.preventDefault();e.returnValue='';}});
function renderTransport(forceReload=false){
 const leg=routeLeg(days[activeDay]?.stops||[],transportIndex,resolvedPlaces),frame=$('transport-map');
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
 $('transport-form').hidden=true;
 for(const id of ['transport-minutes','save-transport'])$(id).disabled=true;
 for(const form of $('timeline').querySelectorAll('[data-transport-form]')){
  const locked=!canChange()||editorDirty||!!stayDraft||importer.dirty||transportDirty&&transportDraft?.id!==form.dataset.transportId;
  for(const element of form.querySelectorAll('input,select,[type="submit"],[data-transport-cancel]'))element.disabled=locked;
  form.querySelector('[data-transport-cancel]').disabled=busy||!!pending||conflict;
 }
 for(const button of $('timeline').querySelectorAll('[data-transport-edit]'))button.disabled=!canChange()||editorDirty||!!stayDraft||importer.dirty||transportDirty&&transportDraft?.id!==button.dataset.transportId;
 $('transport-mode').disabled=!ready||busy||!!pending||conflict;
 $('transport-edit').hidden=true;
 $('close-transport').disabled=busy;
 $('transport-retry').hidden=!pending&&!conflict;$('transport-retry').disabled=busy;
 $('transport-retry').textContent=conflict?'處理衝突':'重試儲存';
}
function openTransport(index){
 if(!ready||!days[activeDay]?.stops[index])return;
 const stop=days[activeDay].stops[index];
 transportIndex=index;transportMode=transportDirty&&transportDraft?.id===stop.id?transportDraft.mode:stop.mode||'walking';
 transportLoading=false;const leg=routeLeg(days[activeDay].stops,index,resolvedPlaces);
 const help=$('transport-dialog').querySelector('.transport-help p');if(help)help.textContent='在 Google Maps 確認路線與所需時間，再回到兩張行程卡片之間填寫分鐘數。大眾運輸班次請依出發日期確認。';
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
$('trip-sign-out').addEventListener('click',async event=>{
 if(signingOut){event.preventDefault();return;}
 if(!canSwitchTrip()||tripManager.dirty||tripManager.pending){event.preventDefault();notice('請先完成儲存或取消編輯，再登出。');return;}
 const email=access.email,logout=new URL(access.logoutUrl||'',location.href);
 const directGoogle=!demoMode&&logout.origin===location.origin&&logout.pathname===appBase+'/logout';
 if(!directGoogle){sessionChannel?.postMessage({type:'logout',email});forgetAccount();return;}
 event.preventDefault();
 const epoch=identityEpoch;
 signingOut=true;busy=true;autoSync.stop();lock();$('trip-sign-out').setAttribute('aria-busy','true');
 try{
  const response=await fetch(apiPath('/api/auth/logout'),{method:'POST',cache:'no-store',redirect:'error',headers:{'X-Trip-Client':'multi-2'},signal:AbortSignal.timeout(15000)});
  if(response.status!==401&&response.status!==204)await readCloudJson(response);
  if(epoch!==identityEpoch)return;
  sessionChannel?.postMessage({type:'logout',email});forgetAccount();authExpired=true;
  location.assign(appBase+'/login');
 }catch(error){
  if(epoch!==identityEpoch)return;
  busy=false;lock();if(ready)autoSync.start();notice('登出未完成，請重試。'+(error.status&&error.message?' '+error.message:''));
 }finally{signingOut=false;$('trip-sign-out').removeAttribute('aria-busy');}
});
if(sessionChannel)sessionChannel.addEventListener('message',event=>{if(event.data?.type==='logout'&&event.data.email===access.email){forgetAccount();authExpired=true;$('save-status').textContent='已在其他分頁登出，請重新登入';}});
window.addEventListener('storage',event=>{if(event.key===null||travelCache?.ownsKey(event.key)&&event.newValue===null)void verifyIdentity();});
for(const event of ['online','offline'])window.addEventListener(event,()=>{placeFrame.connectionChanged();transportFrame.connectionChanged();if(event==='online'&&!embedKey)void loadMapsConfig();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void verifyIdentity();});
window.addEventListener('focus',()=>void verifyIdentity());
window.addEventListener('online',()=>void verifyIdentity());
window.addEventListener('offline',()=>{syncInterrupted=true;if(ready&&!busy&&!pending&&!conflict)$('save-status').textContent='目前離線，恢復網路後自動同步';});
for(const id of ['editor','transport-dialog'])$(id).addEventListener('close',()=>void autoSync.tick());
window.addEventListener('pageshow',event=>{if(event.persisted){identityEpoch++;clearUnavailableTrip();busy=false;tripManager.clear();for(const id of ['editor','transport-dialog','conflict-dialog','import-dialog'])if($(id).open)$(id).close();void boot();}});
$('transport-mode').addEventListener('change',()=>{if(!days[activeDay]?.stops[transportIndex])return;transportMode=$('transport-mode').value;$('transport-feedback').textContent='此處只預覽路線；儲存交通方式與時間請使用卡片之間的欄位。';renderTransport();});
$('transport-form').addEventListener('submit',e=>e.preventDefault());
$('transport-retry').addEventListener('click',()=>{if(conflict)showConflicts();else if(pending)void commit(null,null,null,null,true);});
$('transport-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('close-transport').addEventListener('click',()=>$('transport-dialog').close());
$('transport-dialog').addEventListener('close',()=>{if(!$('transport-dialog').open)transportFrame.clear();});
let restoringDraft=false;
function captureDraft(event){
 if(restoringDraft||busy||!ready||!access.canEdit)return;
 if(event.target.matches('[data-card-tag]'))return;
 const nameForm=event.target.closest('[data-day-name-form]');if(nameForm){captureDayName(nameForm);return;}
 if(event.target.closest('#import-dialog'))return;
 if(event.target.closest('#editor')){if(editorReadOnly)return;editorDirty=true;}
 else if(event.target.closest('[data-transport-form]')){captureInlineTransport(event.target.closest('[data-transport-form]'),event.target);return;}
 else if(event.target.matches('#transport-mode'))return;
 else{const form=event.target.closest('[data-stay-form]');if(!form)return;captureTimelineTime(form);return;}
 persistDraft();
}
document.addEventListener('input',captureDraft);document.addEventListener('change',captureDraft);
$('draft-discard').addEventListener('click',()=>{recovery=null;stayDraft=null;dayNameDraft=null;tagDraft=null;transportDirty=false;transportScope=null;transportDraft=null;transportEditorId='';timelineEditorId='';draftStore?.clear();$('draft-recovery').hidden=true;setDay(activeDay,activeStop);lock();void autoSync.tick();notice('已捨棄這個裝置的未儲存草稿');});
$('draft-restore').addEventListener('click',()=>{
 if(!recovery||!access.canEdit||busy)return;
 const saved=recovery;restoringDraft=true;
 try{
  editorReadOnly=false;
  if(saved.dayName){dayNameDraft=saved.dayName;days=clone(dayNameDraft.scope.days);revision=dayNameDraft.scope.revision;days[dayNameDraft.day].title=dayNameDraft.value;refresh(dayNameDraft.day);showPage('overview');}
  if(saved.tag){tagDraft=saved.tag;days=clone(tagDraft.scope.days);revision=tagDraft.scope.revision;const index=days[tagDraft.day]?.stops.findIndex(stop=>stop.id===tagDraft.id);if(index<0||index===undefined)throw Error('找不到標籤草稿中的行程。');refresh(tagDraft.day,index);}
  if(saved.stay){stayDraft=saved.stay;days=clone(stayDraft.scope.days);revision=stayDraft.scope.revision;refresh();}
  if(saved.editor){
   const draft=saved.editor;openEditor(draft.editing?.day??Number(draft.fields.day),draft.editing?.index??null,draft.scope);newStopId=draft.newStopId||crypto.randomUUID();
   for(const key of ['name','time','day','q','mode','mapUrl','desc'])$('field-'+key).value=draft.fields[key]??'';
   if(draft.fields.fixed!==undefined)$('field-fixed').checked=!!draft.fields.fixed;
   $('field-tag').innerHTML=tagOptions(draft.fields.tag).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');$('field-tag').value=draft.fields.tag;
   $('editor-form').elements.durationHours.value=draft.fields.hours;$('editor-form').elements.durationMinutes.value=draft.fields.minutes;editorDirty=true;updateEditorOrder(true);if(draft.fields.order!==undefined){$('field-order').value=draft.fields.order;updateEditorOrder();}updateTagPreview();updateSharePreview();populateEditorType({kind:draft.fields.kind==='flight'?'flight':'place',tag:draft.fields.tag},draft.fields.kind||'place');editorPlaceTypeFields=restorePlaceTypeFields(draft.fields.placeTypeFields);$('field-coordinates').value=draft.fields.coordinates||'';initFlightFields(draft.fields.flight||{},Number(draft.fields.day));updateFlightEditor();
  }else if(saved.imported){importer.restore(saved.imported);
  }else if(saved.transport){
   const draft=saved.transport;days=clone(draft.scope.days);revision=draft.scope.revision;const index=days[draft.day].stops.findIndex(s=>s.id===draft.id);if(index<0)throw Error('找不到草稿中的行程。');transportScope=draft.scope;transportDraft={day:draft.day,id:draft.id,mode:draft.mode,minutes:String(draft.minutes??'')};transportDirty=true;refresh(draft.day,index);showPage('daily');inlineTransportForm()?.elements.minutes.focus({preventScroll:true});
  }
  if(stayDraft&&!saved.editor&&!saved.imported&&!saved.transport&&!saved.pending){
   const [id,value]=Object.entries(stayDraft.values)[0]||[];
   const day=stayDraft.scope.days.findIndex(d=>d.stops.some(s=>s.id===id));
   if(day>=0){const index=stayDraft.scope.days[day].stops.findIndex(s=>s.id===id);timelineEditorId=id;refresh(day,index);showPage('daily');restoreStayInputs();$('timeline').querySelector(`[data-stay-form="${index}"] input`)?.focus({preventScroll:true});}
  }
  pending=saved.pending||null;conflict=!!pending?.merge;recovery=null;$('draft-recovery').hidden=true;
  if(pending){
   if(!pending.deleteStopId&&Array.isArray(pending.days)){days=clone(pending.days);revision=pending.revision;refresh(pending.day??activeDay,pending.stop??activeStop);}
   $('sync-error').hidden=false;$('sync-error-text').textContent=pending.deleteStopId?'已恢復先前確認的永久刪除，無法復原；可重試確認原操作結果。':'已恢復未送出的修改，請檢查畫面後再重試儲存，儲存時會與雲端最新版本合併。';$('retry').textContent=conflict?'處理衝突':pending.deleteStopId?'重試刪除':'重試儲存';
  }
  lock();persistDraft();if(conflict)showConflicts();notice('已恢復草稿，尚未儲存至雲端');
 }catch(error){notice('無法恢復這份草稿：'+error.message);}finally{restoringDraft=false;}
});

function pointText(point){return point?point.lat+', '+point.lng:'';}
function readFlightFields(){return Object.fromEntries([...$('editor-flight-fields').querySelectorAll('[name^="flight."]')].map(field=>[field.name.slice(7),field.value]));}
function initFlightFields(value={},day=activeDay){const date=days[day]?.isoDate||currentTrip?.startDate||'';const zone=currentTrip?.timezone||'Asia/Taipei';$('editor-flight-fields').innerHTML=flightFieldsHtml({departureDateTime:date+'T09:00',arrivalDateTime:date+'T12:00',departureTimezone:zone,arrivalTimezone:zone,...value});}
function updateFlightEditor(){
 const flight=$('field-kind').value==='flight',locked=editorReadOnly||!canChange();$('editor-flight-fields').hidden=!flight;
 for(const field of $('editor-flight-fields').querySelectorAll('input,select,textarea'))field.disabled=!flight||locked;
 for(const id of ['field-time','field-fixed','field-q'])$(id).disabled=locked||flight;
 for(const field of $('field-duration').querySelectorAll('select'))field.disabled=locked||flight;
 $('field-time').closest('label').hidden=flight;$('field-duration').closest('.duration-field').hidden=flight;$('field-fixed').closest('label').hidden=flight;$('field-tag').closest('.tag-field').hidden=true;if(!flight)syncEditorTypeTag();
 if(flight)$('field-fixed').checked=true;
}
function renderFlightZoneNotices(stop,index,day=activeDay){
 if(stop.kind!=='flight')return '';
 try{
  const times=flightLocalTimes(stop.flight),previous=previousFlightArrivalTimezone(days,day,index);
  const endpoints=[[times.departure,previous,'起飛前'],[times.arrival,times.departure.timezone,'抵達後']];
  const notes=endpoints.map(([point,zone,label])=>{const change=flightTimezoneChange(point,zone);return change?`<p class="flight-zone-notice" data-flight-zone-${change.kind} role="note">${change.kind==='initial'?'':label+' · '}${esc(change.message)}</p>`:'';}).filter(Boolean).join('');
  return notes?`<div class="flight-zone-notices" aria-label="航班時區提示">${notes}</div>`:'';
 }catch{return '';}
}
function flightCardSummary(stop,notices=''){
 const f=stop.flight;if(!f)return '';let duration='';try{duration=formatDuration(flightDuration(f));}catch{}
 const endpoint=(date,zone,airport)=>`<div class="flight-ticket-end"><span class="flight-ticket-date">${esc(date.slice(0,10).replaceAll('-','/'))}</span><time class="flight-ticket-time">${esc(date.slice(11))}</time><span class="flight-ticket-airport">${esc(airport)}</span><span class="flight-ticket-zone">${esc(zone)} 當地時間</span></div>`;
 return `<div class="flight-ticket">${notices}<div class="flight-ticket-heading">✈ ${esc([f.airline,f.number].filter(Boolean).join(' · ')||'機票')}</div><div class="flight-ticket-route">${endpoint(f.departureDateTime,f.departureTimezone,f.departureAirport)}<div class="flight-ticket-duration"><span>${esc(duration)}</span><span class="flight-ticket-arrow" aria-hidden="true"></span></div>${endpoint(f.arrivalDateTime,f.arrivalTimezone,f.arrivalAirport)}</div></div>`;
}
function lockDayNames(){
 for(const form of document.querySelectorAll('[data-day-name-form]')){const blocked=!access.canEdit||!ready||busy||!!pending||conflict||!!recovery||!!tagDraft||transportDirty||editorDirty||!!stayDraft||importer.dirty||dayNameDraft&&Number(form.dataset.dayIndex)!==dayNameDraft.day;for(const field of form.querySelectorAll('input,button'))field.disabled=!!blocked;form.querySelector('[data-day-name-cancel]').hidden=!(dayNameDraft&&Number(form.dataset.dayIndex)===dayNameDraft.day);}
}
function captureDayName(form){const day=Number(form.dataset.dayIndex);if(dayNameDraft&&dayNameDraft.day!==day)return;form.elements.dayName.setCustomValidity('');dayNameDraft??={scope:scopeSnapshot(),day,value:''};dayNameDraft.value=form.elements.dayName.value;persistDraft();lock();}
const cancelledDayNameForms=new WeakSet();
function cancelDayName(form){if(busy||pending||conflict)return;if(form)cancelledDayNameForms.add(form);dayNameDraft=null;persistDraft();refresh();void autoSync.tick();}
async function saveDayName(form){
 if(cancelledDayNameForms.has(form)||!form.isConnected||!access.canEdit||!ready||busy||pending||conflict||!dayNameDraft)return;
 const day=Number(form.dataset.dayIndex),scope=dayNameDraft?.scope||scopeSnapshot();let next;
 try{next=renameDay(scope.days,day,form.elements.dayName.value);}catch(error){form.elements.dayName.setCustomValidity(error.message);form.elements.dayName.reportValidity();return;}
 if(next[day].title===scope.days[day].title){cancelDayName(form);return;}
 await commit(next,'已更新每日名稱',day,activeStop,false,false,scope);
}
document.addEventListener('submit',event=>{
 const form=event.target.closest('[data-day-name-form]');if(!form)return;event.preventDefault();void saveDayName(form);
});
document.addEventListener('focusout',event=>{if(event.target.name!=='dayName')return;const form=event.target.closest('[data-day-name-form]');if(!form||form.contains(event.relatedTarget))return;void saveDayName(form);});
document.addEventListener('pointerdown',event=>{const field=document.activeElement;if(!dayNameDraft||field?.name!=='dayName')return;const form=field.closest('[data-day-name-form]');if(form&&!form.contains(event.target))void saveDayName(form);},true);
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.target.name!=='dayName')return;event.preventDefault();cancelDayName(event.target.closest('[data-day-name-form]'));});
$('field-fixed').addEventListener('change',updateFlightEditor);
$('field-kind').addEventListener('change',()=>{
 const field=$('field-kind'),flight=field.value==='flight',wasFlight=field.dataset.previousKind==='flight';
 if(flight&&!wasFlight){editorPlaceTypeFields=Object.fromEntries(['coordinates','mapUrl','q'].map(key=>[key,$('field-'+key).value]));$('field-coordinates').value='';$('field-mapUrl').value='';$('field-q').value=readFlightFields().departureAirport||'';if(!$('field-name').value)$('field-name').value='航班';}
 if(!flight&&wasFlight&&editorPlaceTypeFields){for(const [key,value] of Object.entries(editorPlaceTypeFields))$('field-'+key).value=value;editorPlaceTypeFields=null;}
 field.dataset.previousKind=flight?'flight':'place';updateFlightEditor();editorDirty=true;persistDraft();renderEditorGeolocation();
});
$('editor-flight-fields').addEventListener('input',event=>{if(event.target.name==='flight.departureAirport'){$('field-q').value=event.target.value;$('field-coordinates').value='';$('field-mapUrl').value='';persistDraft();}});
$('field-q').addEventListener('input',()=>{$('field-coordinates').value='';if(editing&&$('field-mapUrl').value===editorScope.days[editing.day].stops[editing.index].mapUrl)$('field-mapUrl').value='';persistDraft();renderEditorGeolocation();});
$('field-mapUrl').addEventListener('input',()=>{let mapUrl='';try{mapUrl=parseMapsShare($('field-mapUrl').value);}catch{}$('field-coordinates').value=pointText(knownStopPoint({mapUrl},geolocation.overlay().flatMap(day=>day.stops)));persistDraft();renderEditorGeolocation();});
$('field-coordinates').addEventListener('input',()=>{$('field-coordinates').setCustomValidity('');renderEditorGeolocation();});
$('route-map-scope').addEventListener('change',()=>{routeMapScope=$('route-map-scope').value==='trip'?'trip':'day';renderMapStops();});
$('google-place-preview').addEventListener('toggle',()=>renderPlaceMap());

if(demoMode)globalThis.__TRAVEL_NOTES_DEMO__.canManageDays=()=>ready&&canSwitchTrip()&&!tripManager.dirty&&!tripManager.pending;
refresh();showPage(currentPage,{record:false,focus:false});void boot();void loadMapsConfig();
