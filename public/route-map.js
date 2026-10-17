import {buildRouteMapModel,duplicatePinOffsets} from './map-coordinates.js';

const TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const geometryKey=model=>JSON.stringify(model.entries.map(entry=>[entry.id,entry.coordinates]));
const presentationKey=model=>JSON.stringify(model.entries.map(entry=>[entry.id,entry.number,entry.coordinates,entry.stop.name,entry.stop.dayLabel,entry.stop.date]));
const label=entry=>`第 ${entry.number} 站，${String(entry.stop.name||'未命名行程')}`;

/**
 * Requires the locally vendored Leaflet script and stylesheet to be loaded.
 * update({stops,selectedId,onSelect}) preserves the view when only selection changes.
 * onSelect receives the original stop plus {id,number}.
 */
export function mountRouteMap(container,options={}){
 if(!container||typeof container.replaceChildren!=='function')throw new TypeError('Route map needs a container element.');
 let config={stops:[],selectedId:null,onSelect:()=>{},...options};
 let model=buildRouteMapModel(config.stops),map=null,tileLayer=null,markerLayer=null,lineLayer=null,destroyed=false,pendingFit=true,frame=0,slowTimer=0,lastGeometry='',lastPresentation='',tilesLoading=false;
 let failedTiles=new Set(),markers=new Map();
 const shell=el('div','route-map-shell'),toolbar=el('div','route-map-toolbar'),heading=el('div','route-map-heading');
 heading.append(el('strong','', '行程路線'),el('span','route-map-caption','依行程順序連線'));
 const fitButton=el('button','route-map-fit','顯示全部');fitButton.type='button';
 toolbar.append(heading,fitButton);
 const canvas=el('div','route-map-canvas');canvas.setAttribute('role','region');canvas.setAttribute('aria-label','行程地圖，可使用方向鍵移動、加減鍵縮放');
 const footer=el('div','route-map-footer'),status=el('p','route-map-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const retryButton=el('button','route-map-retry','重新載入底圖');retryButton.type='button';retryButton.hidden=true;
 footer.append(status,retryButton);
 const note=el('p','route-map-note','粉紅線是景點間的行程連線；實際道路、交通時間請在 Google Maps 確認。');
 shell.append(toolbar,canvas,footer,note);container.replaceChildren(shell);

 function report(){
  if(destroyed)return;
  const located=model.located.length,missing=model.missing.length;
  const details=located?`已標示 ${located} 站${missing?` · ${missing} 站尚未定位`:''}`:model.entries.length?`${missing} 站尚未定位，貼上完整 Google Maps 地點連結或填寫座標即可定位。`:'新增行程後，景點會出現在這裡。';
  const problem=failedTiles.size?' · 部分底圖未能載入，行程標記仍可查看。':tilesLoading?' · 正在載入底圖…':'';
  status.textContent=details+problem;retryButton.hidden=!failedTiles.size;fitButton.disabled=!map||!located;
 }
 function visible(){const bounds=canvas.getBoundingClientRect();return config.visible!==false&&bounds.width>0&&bounds.height>0;}
 function fit(){
  if(!map||!model.located.length)return;
  pendingFit=true;
  if(!visible())return;
  map.invalidateSize({pan:false});
  const bounds=globalThis.L.latLngBounds(model.located.map(entry=>[entry.coordinates.lat,entry.coordinates.lng]));
  map.fitBounds(bounds,{padding:[58,72],maxZoom:15,animate:false});pendingFit=false;
 }
 function resized(){
  if(destroyed)return;
  if(!map){if(visible())init();return;}
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{if(!destroyed&&visible()){map.invalidateSize({pan:false});if(pendingFit)fit();}});
 }
 function applySelection(){
  for(const [id,marker] of markers){
   const selected=id===String(config.selectedId??'');
   marker.button.setAttribute('aria-pressed',String(selected));marker.host.classList.toggle('is-selected',selected);marker.leaflet.setZIndexOffset(selected?1000:0);
  }
 }
 function select(entry){
  entry=model.entries.find(current=>current.id===entry.id)||entry;
  config.selectedId=entry.id;applySelection();
  config.onSelect?.(entry.stop,{id:entry.id,number:entry.number});
 }
 function render(){
  if(!map||destroyed)return;
  const focused=document.activeElement?.closest?.('[data-route-stop-id]')?.dataset.routeStopId;
  markerLayer.clearLayers();lineLayer.clearLayers();markers.clear();
  for(const segment of model.segments){
   const points=segment.map(entry=>[entry.coordinates.lat,entry.coordinates.lng]);
   globalThis.L.polyline(points,{color:'#ffffff',weight:8,opacity:.76,interactive:false}).addTo(lineLayer);
   globalThis.L.polyline(points,{color:'#ee4b88',weight:4,opacity:.86,interactive:false}).addTo(lineLayer);
  }
  const offsets=duplicatePinOffsets(model.located);
  for(const entry of model.located){
   const {x,y}=offsets.get(entry.id)||{x:0,y:0};
   const host=el('div','route-map-marker');host.dataset.routeStopId=entry.id;
   const pinWrap=el('div','route-map-pin-wrap');pinWrap.style.transform=`translate(${x}px,${y}px)`;
   const button=el('button','route-map-pin');button.type='button';button.setAttribute('aria-label',label(entry));button.setAttribute('title',label(entry));
   button.append(el('span','route-map-pin-number',String(entry.number)));
   const name=el('span','route-map-pin-label',String(entry.stop.name||'未命名行程'));pinWrap.append(button,name);
   if(x||y){
    const leader=el('span','route-map-pin-leader');leader.style.width=`${Math.hypot(x,y)}px`;leader.style.transform=`rotate(${Math.atan2(y,x)}rad)`;host.append(leader);
    host.append(el('span','route-map-pin-origin'));
   }
   host.append(pinWrap);
   const icon=globalThis.L.divIcon({className:'route-map-marker-host',html:host,iconSize:[40,44],iconAnchor:[20,44]});
   const marker=globalThis.L.marker([entry.coordinates.lat,entry.coordinates.lng],{icon,keyboard:false,riseOnHover:true});
   button.addEventListener('click',event=>{event.stopPropagation();select(entry);});
   const popup=el('div','route-map-popup');popup.append(el('small','',`第 ${entry.number} 站`),el('strong','',String(entry.stop.name||'未命名行程')));
   if(entry.stop.dayLabel||entry.stop.date)popup.append(el('span','',String(entry.stop.dayLabel||entry.stop.date)));
   marker.bindPopup(popup,{autoPan:false,closeButton:true});
   button.addEventListener('click',()=>marker.openPopup());
   marker.addTo(markerLayer);markers.set(entry.id,{leaflet:marker,button,host});
  }
  applySelection();
  if(focused&&markers.has(focused))markers.get(focused).button.focus({preventScroll:true});
  report();
 }
 function init(){
  if(destroyed||map||!visible())return;
  if(!globalThis.L?.map){
   status.textContent='地圖工具尚未載入，請重新載入頁面。';fitButton.disabled=true;return;
  }
  try{
   map=globalThis.L.map(canvas,{scrollWheelZoom:false,zoomControl:true,keyboard:true,attributionControl:true}).setView([23.7,121],7);
   for(const [selector,text] of [['.leaflet-control-zoom-in','放大地圖'],['.leaflet-control-zoom-out','縮小地圖']]){
    const button=canvas.querySelector(selector);if(button){button.setAttribute('aria-label',text);button.setAttribute('title',text);}
   }
   markerLayer=globalThis.L.layerGroup().addTo(map);lineLayer=globalThis.L.layerGroup().addTo(map);
   tileLayer=globalThis.L.tileLayer(TILE_URL,{maxZoom:19,minZoom:2,attribution:ATTRIBUTION,keepBuffer:2,updateWhenIdle:true});
   tileLayer.on('loading',()=>{
    tilesLoading=true;clearTimeout(slowTimer);report();
    slowTimer=setTimeout(()=>{if(!destroyed&&tilesLoading){status.textContent+=' 底圖載入較慢，可先查看行程標記。';retryButton.hidden=false;}},10000);
   });
   tileLayer.on('tileerror',event=>{failedTiles.add(event.tile?.src||'tile');report();});
   tileLayer.on('tileload',event=>{failedTiles.delete(event.tile?.src||'tile');report();});
   tileLayer.on('load',()=>{tilesLoading=false;clearTimeout(slowTimer);report();});
   tileLayer.addTo(map);lastGeometry=geometryKey(model);lastPresentation=presentationKey(model);render();fit();resized();
  }catch{
   if(map){map.remove();map=null;}
   status.textContent='地圖暫時無法開啟，請重試。';retryButton.textContent='重新開啟地圖';retryButton.hidden=false;fitButton.disabled=true;
  }
 }
 fitButton.addEventListener('click',fit);
 retryButton.addEventListener('click',()=>{
  if(map&&tileLayer){failedTiles.clear();retryButton.hidden=true;tileLayer.redraw();report();}
  else init();
 });
 const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(resized):null;
 resizeObserver?.observe(canvas);
 const intersectionObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))resized();}):null;
 intersectionObserver?.observe(canvas);globalThis.addEventListener?.('resize',resized);init();

 return {
  update(next={}){
   if(destroyed)return;
   config={...config,...next};model=buildRouteMapModel(config.stops);
   const key=geometryKey(model),geometryChanged=key!==lastGeometry;
   const presentation=presentationKey(model);
   if(presentation!==lastPresentation)render();else{applySelection();report();}
   lastGeometry=key;lastPresentation=presentation;if(geometryChanged)fit();else resized();
  },
  setVisible(value){config.visible=value!==false;if(config.visible){if(!map)init();resized();}},
  fit,
  destroy(){
   if(destroyed)return;destroyed=true;clearTimeout(slowTimer);cancelAnimationFrame(frame);resizeObserver?.disconnect();intersectionObserver?.disconnect();globalThis.removeEventListener?.('resize',resized);
   map?.remove();map=null;markers.clear();container.replaceChildren();
  },
 };
}
