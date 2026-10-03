import test from 'node:test';
import assert from 'node:assert/strict';
import {initTripManager} from '../public/trip-manager.js';

const decode=value=>String(value).replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
class Element {
 constructor(tag='div',attrs={}){
  this.tag=tag;this.attrs=attrs;this.dataset={};this.disabled=false;this.hidden=false;this.value=decode(attrs.value||'');this.textContent='';this.children=[];this.listeners=new Map();this.classes=new Set();this.selectionStart=0;this.selectionEnd=0;
  for(const [name,value] of Object.entries(attrs))if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;
  this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),contains:name=>this.classes.has(name)};
 }
 set innerHTML(value){
  this.html=value;this.children=[];
  for(const [,tag,source] of value.matchAll(/<(button|input|form)\b([^>]*)>/g)){
   const attrs={};for(const [,name,value] of source.matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[name]=value??'';
   this.children.push(new Element(tag,attrs));
  }
 }
 get innerHTML(){return this.html||'';}
 matches(selector){return selector==='button,input,select'?['button','input','select'].includes(this.tag):selector.split(',').some(part=>this.hasAttribute(part.match(/^\[([^\]]+)\]$/)?.[1]));}
 querySelectorAll(selector){return this.children.filter(child=>child.matches(selector));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 hasAttribute(name){return Object.hasOwn(this.attrs,name);}
 closest(selector){return selector===this.tag||this.matches(selector)?this:null;}
 focus(){document.activeElement=this;}
 select(){this.setSelectionRange(0,this.value.length);}
 setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
 addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
 async emit(type,event={}){for(const handler of this.listeners.get(type)||[])await handler({preventDefault(){},...event});}
 reset(){}
}

const trip=(id='owner-trip',role='owner',revision=5,title=`旅行 ${id}`)=>({id,title,role,revision,startDate:'2028-01-03',endDate:'2028-01-04',timezone:'Asia/Taipei',canEdit:role!=='viewer',canShare:role==='owner'});
const catalogue=(trips,email='owner@example.test')=>({email,trips,deletedTrips:[]});
const result=(title,revision=6,id='owner-trip',role='owner')=>({ok:true,trip:{id,title,startDate:'2028-01-03',endDate:'2028-01-04',timezone:'Asia/Taipei'},revision,role});
const settle=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};

function harness(t,{saved=null,snapshot=null}={}){
 const original=globalThis.document,nodes=new Map(),ids=['trips-panel','trips-status','trips-open','trip-library','trip-library-empty','trip-list-count','trip-deleted-count','trip-deleted-library','trip-deleted','trip-current-title','trip-account-email','trip-sign-out','trip-create-panel','trip-create-name','trip-create-form','trip-create-error','trip-create-start','trip-create-end','trip-create-timezone','trip-create-cancel','trip-create-open','trip-create-save','trip-empty-create','trips-reload'];
 for(const id of ids)nodes.set(id,new Element(id==='trip-create-timezone'?'select':['trip-create-name','trip-create-start','trip-create-end'].includes(id)?'input':['trips-open','trip-create-cancel','trip-create-open','trip-create-save','trip-empty-create','trips-reload'].includes(id)?'button':'div',{id}));
 const $=id=>nodes.get(id);$('trip-create-panel').hidden=true;
 $('trips-panel').querySelectorAll=selector=>[...nodes.values(),...$('trip-library').children,...$('trip-deleted-library').children].filter(node=>node.matches(selector));
 globalThis.document={getElementById:$,activeElement:null};t.after(()=>{globalThis.document=original;});
 const requests=[],renamed=[],selected=[],authFailures=[],cache={saved:structuredClone(saved),snapshot:structuredClone(snapshot),writes:[],tripWrites:[],invalidated:0,cleared:0,readCatalogue(){return structuredClone(this.saved);},writeCatalogue(value){this.saved=structuredClone(value);this.writes.push(structuredClone(value));return true;},clearCatalogue(){this.saved=null;this.invalidated++;},clearAccount(){this.saved=null;this.snapshot=null;this.cleared++;},readTrip(id){return this.snapshot?.trip.id===id?structuredClone(this.snapshot):null;},writeTrip(id,value){this.snapshot=structuredClone(value);this.tripWrites.push({id,value:structuredClone(value)});return true;},deleteTrip(){}};
 let clock=1000;
 const manager=initTripManager({apiPath:path=>`/trip${path}`,readJson:value=>value,fetcher:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),now:()=>clock,onSelect:id=>selected.push(id),onRenamed:value=>renamed.push(structuredClone(value)),onAuthFailure:error=>authFailures.push(error)});
 manager.setSession({email:'owner@example.test'});manager.setCache(cache);
 const find=(name,value)=>$('trip-library').children.find(node=>node.hasAttribute(name)&&(value===undefined||node.attrs[name]===value));
 const click=async(name,value)=>{const node=find(name,value);assert.ok(node,`${name} exists`);if(!node.disabled)await $('trip-library').emit('click',{target:node});await settle();};
 const input=()=>find('data-rename-input');
 const type=async(title,start=title.length,end=start)=>{input().value=title;input().focus();input().setSelectionRange(start,end);await $('trip-library').emit('input',{target:input()});};
 const submit=async()=>{await $('trip-library').emit('submit',{target:find('data-trip-rename-form')});await settle();};
 const load=async(trips=[trip()])=>{const pending=manager.enter();requests.at(-1).resolve(catalogue(trips));await pending;};
 return {$,manager,cache,requests,renamed,selected,authFailures,find,click,input,type,submit,load,advance:()=>{clock+=60001;}};
}

test('only live-authorized owners and editors can open inline rename; cached roles do not authorize it',async t=>{
 const rows=[trip(),trip('edit-trip','editor'),trip('view-trip','viewer')],h=harness(t,{saved:catalogue(rows)});
 assert.equal(h.find('data-trip-rename','owner-trip').disabled,true);assert.equal(h.find('data-trip-rename','edit-trip').disabled,true);assert.equal(h.find('data-trip-rename','view-trip'),undefined);
 assert.equal(h.manager.openRename('owner-trip'),false);assert.equal(h.input(),undefined);
 await h.load(rows);assert.equal(h.manager.openRename('edit-trip'),true);assert.equal(h.input().value,'旅行 edit-trip');assert.equal(h.input().attrs.maxlength,'120');assert.equal(h.input().hasAttribute('required'),true);
 await h.click('data-rename-cancel');assert.equal(h.manager.openRename('view-trip'),false);assert.equal(h.input(),undefined);
});

test('typing survives background catalogue and selected-trip renders with cursor and navigation guards intact',async t=>{
 const h=harness(t);await h.load([trip(),trip('other')]);h.manager.openRename('owner-trip');await h.type('春天 <東京> & "私旅"',3,5);
 assert.equal(h.manager.dirty,true);h.advance();const update=h.manager.enter();h.requests[1].resolve(catalogue([trip('owner-trip','owner',6,'遠端名稱'),trip('other')]));await update;
 assert.equal(h.input().value,'春天 <東京> & "私旅"');assert.equal(document.activeElement,h.input());assert.equal(h.input().selectionStart,3);assert.equal(h.input().selectionEnd,5);
 h.manager.setCurrent(trip('owner-trip','owner',7,'雲端新名稱'));assert.equal(h.input().value,'春天 <東京> & "私旅"');assert.equal(h.manager.dirty,true);
 await h.click('data-trip-id','other');assert.deepEqual(h.selected,[]);
 await h.$('trip-create-open').emit('click');assert.equal(h.$('trip-create-panel').hidden,true);
 await h.click('data-trip-delete','owner-trip');assert.equal(h.find('data-delete-confirm'),undefined);
 await h.click('data-rename-cancel');assert.equal(h.manager.dirty,false);assert.equal(h.input(),undefined);
 assert.match(h.$('trip-library').innerHTML,/雲端新名稱/);
});

test('rename success updates only the selected metadata and never elevates other trip roles or snapshot revision',async t=>{
 const days=[{stops:[{id:'keep-stop',name:'保留行程'}]}],snapshot={trip:trip(),revision:4,days,previous:{undo:'keep'}};
 const h=harness(t,{snapshot});await h.load([trip(),trip('viewer','viewer',1),trip('editor','editor',2)]);h.manager.setCurrent(trip());h.manager.openRename('owner-trip');await h.type('新的旅行名稱');await h.submit();
 const request=h.requests[1];assert.equal(request.options.method,'PATCH');assert.equal(request.options.headers['X-Trip-Client'],'multi-1');
 const body=JSON.parse(request.options.body);assert.equal(body.baseTitle,'旅行 owner-trip');assert.equal(body.revision,5);assert.equal(body.title,'新的旅行名稱');assert.ok(body.mutationId);
 request.resolve(result('新的旅行名稱',8));await settle();
 assert.equal(h.input(),undefined);assert.equal(h.manager.pending,false);assert.equal(h.manager.dirty,false);assert.equal(h.$('trip-current-title').textContent,'新的旅行名稱');
 assert.deepEqual(h.cache.snapshot.days,days);assert.deepEqual(h.cache.snapshot.previous,{undo:'keep'});assert.equal(h.cache.snapshot.revision,4);assert.equal(h.cache.snapshot.trip.title,'新的旅行名稱');
 assert.equal(h.cache.saved.trips.find(value=>value.id==='viewer').role,'viewer');assert.equal(h.cache.saved.trips.find(value=>value.id==='editor').role,'editor');assert.equal(h.find('data-trip-rename','viewer'),undefined);assert.equal(h.find('data-trip-delete','editor'),undefined);
 assert.deepEqual(h.renamed,[{trip:result('新的旅行名稱',8).trip,revision:8,role:'owner'}]);assert.equal(h.renamed[0].days,undefined);
});

test('title conflicts preserve the draft and require an explicit choice with a fresh reviewed revision',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');await h.type('我的名稱');await h.submit();
 const original=JSON.parse(h.requests[1].options.body),error=Error('conflict');error.status=409;error.data=result('目前名稱',6);h.requests[1].reject(error);await settle();
 assert.equal(h.input().value,'我的名稱');assert.match(h.$('trip-library').innerHTML,/目前名稱/);assert.ok(h.find('data-rename-remote'));assert.ok(h.find('data-rename-mine'));assert.equal(h.manager.dirty,true);
 await h.submit();assert.equal(h.requests.length,2);assert.deepEqual(h.renamed,[]);
 await h.click('data-rename-mine');const overwrite=JSON.parse(h.requests[2].options.body);
 assert.equal(overwrite.baseTitle,'目前名稱');assert.equal(overwrite.revision,6);assert.equal(overwrite.title,'我的名稱');assert.notEqual(overwrite.mutationId,original.mutationId);
 h.requests[2].resolve(result('我的名稱',7));await settle();assert.equal(h.input(),undefined);assert.equal(h.renamed.length,1);assert.equal(h.renamed[0].trip.title,'我的名稱');
});

test('accepting the cloud name updates metadata without another PATCH and clears the unsaved rename',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');await h.type('我的名稱');await h.submit();
 const error=Error('conflict');error.status=409;error.data=result('雲端名稱',6);h.requests[1].reject(error);await settle();
 await h.click('data-rename-remote');assert.equal(h.requests.length,2);assert.equal(h.input(),undefined);assert.equal(h.manager.dirty,false);assert.equal(h.renamed[0].trip.title,'雲端名稱');assert.equal(h.cache.saved.trips[0].title,'雲端名稱');
});

test('a conflict without role cannot undo a later viewer downgrade when accepting the cloud name',async t=>{
 const h=harness(t);await h.load([trip('owner-trip','editor')]);h.manager.openRename('owner-trip');await h.type('我的名稱');await h.submit();
 const error=Error('conflict');error.status=409;error.data={trip:result('雲端名稱',6).trip,revision:6};h.requests[1].reject(error);await settle();
 h.advance();const update=h.manager.enter();h.requests[2].resolve(catalogue([trip('owner-trip','viewer',6,'雲端名稱')]));await update;
 await h.click('data-rename-remote');assert.equal(h.cache.saved.trips[0].role,'viewer');assert.equal(h.cache.saved.trips[0].canEdit,false);assert.equal(h.find('data-trip-rename','owner-trip'),undefined);
 assert.equal(Object.hasOwn(h.renamed[0],'role'),false);assert.equal(h.renamed[0].trip.title,'雲端名稱');
});

test('an unresolved cloud conflict remains dirty when typing the original base name again',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');await h.type('我的新名稱');await h.submit();
 const error=Error('conflict');error.status=409;error.data={trip:result('雲端名稱',6).trip,revision:6};h.requests[1].reject(error);await settle();
 await h.type('旅行 owner-trip');assert.equal(h.manager.dirty,true);assert.ok(h.find('data-rename-mine'));
 await h.click('data-rename-cancel');assert.equal(h.manager.dirty,false);
});

test('a lost rename reply retains the input and retries the identical mutation rather than generating a new attempt',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');await h.type('重新嘗試的名稱');await h.submit();
 const original=h.requests[1].options.body;h.requests[1].reject(Error('offline'));await settle();
 assert.equal(h.input().value,'重新嘗試的名稱');assert.equal(h.manager.dirty,true);assert.equal(h.cache.invalidated,1);assert.equal(h.input().disabled,false);
 await h.submit();assert.equal(h.requests[2].options.body,original);h.requests[2].resolve(result('重新嘗試的名稱',6));await settle();
 assert.equal(h.manager.dirty,false);assert.equal(h.renamed.length,1);
});

test('a newer selected-trip record and cached snapshot cannot be overwritten by an older rename acknowledgement',async t=>{
 const snapshot={trip:trip('owner-trip','owner',9,'更新的名稱'),revision:9,days:[{stops:[]}]},h=harness(t,{snapshot});await h.load();h.manager.openRename('owner-trip');await h.type('較舊的修改');await h.submit();
 h.manager.setCurrent(trip('owner-trip','owner',9,'更新的名稱'));h.requests[1].resolve(result('較舊的修改',6));await settle();
 assert.match(h.$('trip-library').innerHTML,/更新的名稱/);assert.equal(h.$('trip-current-title').textContent,'更新的名稱');assert.equal(h.cache.saved.trips[0].revision,9);assert.deepEqual(h.cache.snapshot,snapshot);assert.deepEqual(h.cache.tripWrites,[]);
});

test('a removed trip keeps its typed name visible until cancel, without allowing a write to the missing trip',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');await h.type('需要保留的文字');h.advance();const update=h.manager.enter();h.requests[1].resolve(catalogue([]));await update;
 assert.equal(h.input().value,'需要保留的文字');assert.equal(h.manager.dirty,true);assert.match(h.$('trip-library').innerHTML,/不在最新清單/);assert.equal(h.$('trip-library-empty').hidden,true);
 await h.submit();assert.equal(h.requests.length,2);await h.click('data-rename-cancel');assert.equal(h.input(),undefined);assert.equal(h.manager.dirty,false);assert.equal(h.$('trip-library-empty').hidden,false);
});

test('logout or authorization loss clears rename drafts and ignores an older in-flight acknowledgement',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');await h.type('私人的新名稱');await h.submit();
 h.manager.clear();h.requests[1].resolve(result('私人的新名稱',6));await settle();
 assert.equal(h.input(),undefined);assert.equal(h.manager.dirty,false);assert.equal(h.$('trip-library').innerHTML,'');assert.deepEqual(h.renamed,[]);
 h.manager.setSession({email:'owner@example.test'});h.manager.setCache(h.cache);await h.load();h.manager.openRename('owner-trip');await h.type('再改一次');await h.submit();
 const denied=Error('denied');denied.status=403;h.requests.at(-1).reject(denied);await settle();
 assert.equal(h.input(),undefined);assert.equal(h.manager.dirty,false);assert.equal(h.cache.cleared,1);assert.equal(h.authFailures.length,1);assert.deepEqual(h.renamed,[]);
});

test('empty or oversized names stay in the form and never send a PATCH',async t=>{
 const h=harness(t);await h.load();h.manager.openRename('owner-trip');
 for(const name of ['  ','旅'.repeat(121)]){await h.type(name);await h.submit();assert.equal(h.requests.length,1);assert.equal(h.input().value,name);assert.match(h.$('trip-library').innerHTML,/1–120 字/);}
});
