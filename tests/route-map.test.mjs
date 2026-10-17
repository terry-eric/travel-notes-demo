import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRouteMap} from '../public/route-map.js';

function environment(t){
 const previous=new Map(),cleanups=[],install=(key,value)=>{previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.parentElement=null;this.attributes=new Map();this.dataset={};this.style={setProperty(name,value){this[name]=String(value);}};this.className='';this.textContent='';this.hidden=false;this.disabled=false;
   this.classList={toggle:(name,enabled)=>{const names=new Set(this.className.split(' ').filter(Boolean));if(enabled)names.add(name);else names.delete(name);this.className=[...names].join(' ');}};
  }
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key);}
  getBoundingClientRect(){let node=this;while(node){if(node.hidden)return {width:0,height:0};node=node.parentElement;}return {width:640,height:400};}
  querySelector(){return null;}
  closest(){let node=this;while(node){if(node.dataset.routeStopId)return node;node=node.parentElement;}return null;}
  focus(){document.activeElement=this;}
 }
 const maps=[],tileLayers=[],groups=[],observers=[];
 const L={
  map(canvas){const map={canvas,fitCount:0,invalidations:0,removed:false,setView(){return this;},invalidateSize(){this.invalidations++;},fitBounds(bounds){this.fitCount++;this.bounds=bounds;},remove(){this.removed=true;}};maps.push(map);return map;},
  latLngBounds:points=>points,
  layerGroup(){const group={items:[],clears:0,addTo(map){this.map=map;return this;},clearLayers(){this.items=[];this.clears++;}};groups.push(group);return group;},
  tileLayer(url,options){const tile={url,options,events:{},redraws:0,on(name,handler){this.events[name]=handler;return this;},addTo(){return this;},redraw(){this.redraws++;}};tileLayers.push(tile);return tile;},
  polyline(points,options){return {points,options,addTo(group){group.items.push(this);return this;}};},
  divIcon:options=>options,
  marker(point,options){return {point,options,z:0,bindPopup(content,popupOptions){this.popup=content;this.popupOptions=popupOptions;return this;},setZIndexOffset(value){this.z=value;return this;},openPopup(){this.opened=true;return this;},addTo(group){group.items.push(this);group.map.canvas.append(options.icon.html);return this;}};},
 };
 class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
 install('document',{activeElement:null,createElement:tag=>new Element(tag)});install('L',L);
 install('ResizeObserver',Observer);install('IntersectionObserver',Observer);install('requestAnimationFrame',callback=>{callback();return 1;});install('cancelAnimationFrame',()=>{});
 install('addEventListener',()=>{});install('removeEventListener',()=>{});
 t.after(()=>{for(const cleanup of cleanups)cleanup();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 return {container:new Element('section'),maps,tileLayers,groups,observers,cleanup:callback=>cleanups.push(callback)};
}

test('selecting a stop keeps the camera and existing pins while callbacks receive current data',t=>{
 const env=environment(t),stops=[{id:'a',name:'A',q:'25,121'},{id:'b',name:'<img onerror=alert(1)>',q:'26,122'}];
 let chosen;
 const controller=mountRouteMap(env.container,{stops,selectedId:'a',onSelect:stop=>chosen=stop});env.cleanup(()=>controller.destroy());
 const map=env.maps[0],layer=env.groups[0],firstMarkers=[...layer.items],fitCount=map.fitCount;
 assert.equal(fitCount,1);assert.equal(firstMarkers[1].popup.children[1].textContent,stops[1].name);
 const changed=stops.map(stop=>({...stop,desc:'latest note'}));
 controller.update({stops:changed,selectedId:'b'});
 assert.equal(map.fitCount,fitCount);assert.deepEqual(layer.items,firstMarkers);
 const button=firstMarkers[1].options.icon.html.children.at(-1).children[0];
 assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(firstMarkers[1].z,1000);
 button.dispatchEvent(new Event('click'));assert.equal(chosen,changed[1]);assert.equal(firstMarkers[1].opened,true);
 assert.equal(firstMarkers[1].popupOptions.autoPan,false);
 controller.update({stops:[changed[1],changed[0]]});assert.equal(map.fitCount,fitCount+1);
 assert.deepEqual(map.bounds,[[26,122],[25,121]]);
});

test('a hidden map initializes on reveal, then tears down observers and map state',t=>{
 const env=environment(t);env.container.hidden=true;
 const controller=mountRouteMap(env.container,{stops:[{id:'a',name:'A',q:'25,121'}]});
 assert.equal(env.maps.length,0);
 env.container.hidden=false;controller.setVisible(true);
 assert.equal(env.maps.length,1);assert.equal(env.maps[0].fitCount,1);
 controller.update({selectedId:'a'});assert.equal(env.maps[0].fitCount,1);
 controller.destroy();assert.equal(env.maps[0].removed,true);assert.equal(env.container.children.length,0);assert.ok(env.observers.every(observer=>observer.disconnected));
 controller.update({stops:[]});controller.destroy();assert.equal(env.maps.length,1);
});

test('tile failures expose a manual retry without hiding or deleting itinerary markers',t=>{
 const env=environment(t),controller=mountRouteMap(env.container,{stops:[{id:'a',name:'A',q:'25,121'}]});env.cleanup(()=>controller.destroy());
 const shell=env.container.children[0],footer=shell.children[2],status=footer.children[0],retry=footer.children[1],tile=env.tileLayers[0];
 assert.equal(tile.url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');assert.match(tile.options.attribution,/OpenStreetMap/);
 tile.events.tileerror({tile:{src:'failed-tile'}});assert.equal(retry.hidden,false);assert.match(status.textContent,/行程標記仍可查看/);assert.equal(env.groups[0].items.length,1);
 retry.dispatchEvent(new Event('click'));assert.equal(tile.redraws,1);assert.equal(env.groups[0].items.length,1);
 tile.events.tileload({tile:{src:'failed-tile'}});tile.events.load();assert.equal(retry.hidden,true);assert.match(status.textContent,/已標示 1 站/);
});

test('date legend, numbered pins, and separate lines all use the same safe day palette',t=>{
 const env=environment(t),stops=[
  {id:'a',name:'A',q:'25,121',dayIndex:0,date:'2027-01-01'},
  {id:'b',name:'B',q:'26,122',dayIndex:0,date:'2027-01-01'},
  {id:'c',name:'C',q:'26,122',dayIndex:1,date:'2027-01-02',dayColor:'url(javascript:bad)'},
  {id:'d',name:'D',q:'27,123',dayIndex:1,date:'2027-01-02'},
 ];
 const controller=mountRouteMap(env.container,{stops});env.cleanup(()=>controller.destroy());
 const legend=env.container.children[0].children[3],markers=env.groups[0].items,lines=env.groups[1].items;
 assert.equal(legend.getAttribute('aria-label'),'日期顏色圖例');assert.equal(legend.children.length,2);
 assert.deepEqual(legend.children.map(item=>item.children[1].textContent),['2027-01-01','2027-01-02']);
 const colors=legend.children.map(item=>item.style['--route-day-color']);
 assert.notEqual(colors[0],colors[1]);
 assert.deepEqual(lines.map(line=>line.options.color),['#ffffff',colors[0],'#ffffff',colors[1]]);
 assert.deepEqual(lines[1].points,[[25,121],[26,122]]);assert.deepEqual(lines[3].points,[[26,122],[27,123]]);
 assert.deepEqual(markers.map(marker=>marker.options.icon.html.style['--route-day-color']),[colors[0],colors[0],colors[1],colors[1]]);
 assert.deepEqual(markers[1].point,markers[2].point);
 assert.notEqual(markers[1].options.icon.html.children.at(-1).style.transform,markers[2].options.icon.html.children.at(-1).style.transform);
 const fitCount=env.maps[0].fitCount;
 controller.update({stops:stops.map(stop=>({...stop,dayIndex:stop.dayIndex+1}))});
 assert.equal(env.maps[0].fitCount,fitCount,'day presentation changes do not reset the map camera');
 assert.notEqual(legend.children[0].style['--route-day-color'],colors[0]);
 controller.update({stops:[]});assert.equal(legend.hidden,true);
});
