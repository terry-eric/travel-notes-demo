import test from 'node:test';
import assert from 'node:assert/strict';
import {initTripManager} from '../public/trip-manager.js';

class Element {
 constructor(tag='div',attrs={}){
  this.tag=tag;this.attrs=attrs;this.dataset={};this.disabled=false;this.hidden=false;this.value='';this.textContent='';this.children=[];this.listeners=new Map();this.classes=new Set();
  for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),contains:name=>this.classes.has(name)};
 }
 set innerHTML(value){
  this.html=value;this.children=[];
  for(const [,source] of value.matchAll(/<button\b([^>]*)>/g)){
   const attrs={};for(const [,name,value] of source.matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[name]=value??'';
   this.children.push(new Element('button',attrs));
  }
 }
 get innerHTML(){return this.html||'';}
 matches(selector){return selector==='button,input,select'?['button','input','select'].includes(this.tag):selector.split(',').some(part=>{const name=part.match(/^\[([^\]]+)\]$/)?.[1];return name&&this.hasAttribute(name);});}
 querySelectorAll(selector){return this.children.filter(child=>child.matches(selector));}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 hasAttribute(name){return Object.hasOwn(this.attrs,name);}
 closest(selector){return selector===this.tag?this:null;}
 focus(){document.activeElement=this;}
 addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
 async emit(type,event={}){for(const handler of this.listeners.get(type)||[])await handler({preventDefault(){},...event});}
 reset(){}
}

const trip=(id='trip-a',revision=5)=>({id,title:`旅行 ${id}`,startDate:'2028-01-03',endDate:'2028-01-04',timezone:'Asia/Taipei',role:'owner',revision,canEdit:true,canShare:true});
const catalogue=(trips=[trip()],deletedTrips=[],email='owner@example.test')=>({email,trips,deletedTrips});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

function harness(t,{saved=null,email='owner@example.test'}={}){
 const original=globalThis.document,nodes=new Map();
 const ids=['trips-panel','trips-status','trips-open','trip-library','trip-library-empty','trip-list-count','trip-deleted-count','trip-deleted-library','trip-deleted','trip-current-title','trip-account-email','trip-sign-out','trip-create-panel','trip-create-name','trip-create-form','trip-create-error','trip-create-start','trip-create-end','trip-create-timezone','trip-create-cancel','trip-create-open','trip-empty-create','trips-reload'];
 for(const id of ids){const tag=id==='trip-create-timezone'?'select':['trip-create-name','trip-create-start','trip-create-end'].includes(id)?'input':['trips-open','trip-create-cancel','trip-create-open','trip-empty-create','trips-reload'].includes(id)?'button':'div';nodes.set(id,new Element(tag,{id}));}
 const $=id=>nodes.get(id),panel=$('trips-panel');
 $('trip-create-panel').hidden=true;
 panel.querySelectorAll=selector=>[...nodes.values(),...$('trip-library').children,...$('trip-deleted-library').children].filter(node=>node.matches(selector));
 globalThis.document={getElementById:$,activeElement:null};t.after(()=>{globalThis.document=original;});
 const requests=[],pendingChanges=[],authFailures=[],selected=[],cache={saved:structuredClone(saved),writes:[],cleared:0,invalidated:0,purged:[],readCatalogue(){return structuredClone(this.saved);},writeCatalogue(value){this.saved=structuredClone(value);this.writes.push(structuredClone(value));},clearCatalogue(){this.saved=null;this.invalidated++;},clearAccount(){this.saved=null;this.cleared++;},deleteTrip(id){this.purged.push(id);}};
 let time=1000;
 const fetcher=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
 const manager=initTripManager({apiPath:path=>`/trip${path}`,readJson:value=>value,onSelect:id=>selected.push(id),onPendingChange:value=>pendingChanges.push(value),onAuthFailure:error=>{authFailures.push(error);manager.clear();},fetcher,now:()=>time});
 manager.setSession({email,logoutUrl:'/logout'});manager.setCache(cache);
 const button=(attribute,id)=>$('trip-library').children.find(node=>node.hasAttribute(attribute)&&(id===undefined||node.attrs[attribute]===id));
 const click=async(attribute,id)=>{const target=button(attribute,id);assert.ok(target,attribute);if(!target.disabled)await $('trip-library').emit('click',{target});await settle();return target;};
 return {$,manager,cache,requests,pendingChanges,authFailures,selected,button,click,advance:value=>{time+=value;}};
}

test('cached catalogue appears immediately but only a live catalogue enables destructive management',async t=>{
 const h=harness(t,{saved:catalogue([trip()],[trip('deleted')])});
 assert.match(h.$('trip-library').innerHTML,/旅行 trip-a/);
 assert.match(h.$('trips-status').textContent,/上次.*背景更新/);
 assert.equal(h.button('data-trip-delete').disabled,true);
 assert.equal(h.$('trip-deleted-library').children[0].disabled,true);
 const first=h.manager.enter(),second=h.manager.enter();
 assert.equal(h.requests.length,1);assert.equal(h.manager.pending,false);assert.deepEqual(h.pendingChanges,[]);
 assert.equal(h.button('data-trip-id').disabled,false);assert.equal(h.$('trip-create-open').disabled,false);
 h.requests[0].resolve(catalogue([trip()],[trip('deleted')]));await Promise.all([first,second]);
 assert.equal(h.button('data-trip-delete').disabled,false);assert.equal(h.$('trip-deleted-library').children[0].disabled,false);
 assert.equal(h.$('trips-status').textContent,'');assert.equal(h.cache.writes.length,1);
 h.advance(59999);await h.manager.enter();assert.equal(h.requests.length,1);
 h.manager.setCache(h.cache);assert.equal(h.button('data-trip-delete').disabled,false);assert.equal(h.cache.writes.length,1);
 const forced=h.manager.refresh({force:true});assert.equal(h.requests.length,2);h.requests[1].resolve(catalogue());await forced;
});

test('an expired background refresh preserves a creation draft and keeps cards usable after a network failure',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 await h.$('trip-create-open').emit('click');h.$('trip-create-name').value='未完成的春天旅行';await h.$('trip-create-form').emit('input');
 h.advance(60001);const update=h.manager.enter();
 assert.equal(h.requests.length,2);assert.equal(h.manager.pending,false);assert.equal(h.manager.dirty,true);
 assert.equal(h.$('trip-create-panel').hidden,false);assert.equal(h.$('trip-create-name').value,'未完成的春天旅行');
 assert.equal(h.button('data-trip-id').disabled,false);assert.match(h.$('trip-library').innerHTML,/trip-a/);
 h.requests[1].reject(Error('offline'));await update;
 assert.equal(h.$('trip-create-name').value,'未完成的春天旅行');assert.equal(h.manager.dirty,true);
 assert.equal(h.button('data-trip-id').disabled,false);assert.equal(h.button('data-trip-delete').disabled,true);
 assert.match(h.$('trips-status').textContent,/上次.*連線失敗/);assert.equal(h.cache.saved.trips.length,1);
 assert.deepEqual(h.authFailures,[]);
});

test('background revisions preserve the explicit deletion review and submit the originally reviewed CAS revision',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 await h.click('data-trip-delete');assert.ok(h.button('data-delete-confirm'));
 h.advance(60001);const update=h.manager.enter();h.requests[1].resolve(catalogue([trip('trip-a',6)]));await update;
 assert.ok(h.button('data-delete-confirm'));
 await h.click('data-delete-confirm');assert.equal(h.requests[2].options.method,'DELETE');
 assert.deepEqual(JSON.parse(h.requests[2].options.body),{id:'trip-a',revision:5});
 const conflict=Error('conflict');conflict.status=409;h.requests[2].reject(conflict);await settle();
 assert.equal(h.cache.invalidated,1);assert.equal(h.requests.length,4);
 h.requests[3].resolve(catalogue([trip('trip-a',7)]));await settle();
 assert.equal(h.manager.pending,false);assert.equal(h.button('data-delete-confirm'),undefined);
 assert.equal(h.button('data-trip-delete').disabled,false);assert.match(h.$('trips-status').textContent,/確認內容後再操作/);
 assert.equal(h.cache.saved.trips[0].revision,7);
});

test('a delayed pre-delete GET cannot resurrect a successfully deleted trip or its cache',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 await h.click('data-trip-delete');h.advance(60001);const oldRead=h.manager.enter();
 await h.click('data-delete-confirm');assert.equal(h.requests[2].options.method,'DELETE');
 h.requests[2].resolve({ok:true,id:'trip-a',deleted:true});await settle();
 assert.deepEqual(h.cache.purged,['trip-a']);assert.equal(h.requests.length,4);
 h.requests[3].resolve(catalogue([],[trip('trip-a',6)]));await settle();
 h.requests[1].resolve(catalogue([trip('trip-a',5)]));await oldRead;
 assert.equal(h.manager.pending,false);assert.equal(h.button('data-trip-id'),undefined);
 assert.deepEqual(h.cache.saved.trips,[]);assert.equal(h.cache.saved.deletedTrips[0].id,'trip-a');
});

test('failed persistence and post-delete refresh remove an older cached catalogue rather than resurrecting the deleted trip',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 h.cache.writeCatalogue=()=>false;
 await h.click('data-trip-delete');await h.click('data-delete-confirm');
 h.requests[1].resolve({ok:true,id:'trip-a',deleted:true});await settle();
 assert.equal(h.cache.saved,null);assert.deepEqual(h.cache.purged,['trip-a']);
 h.requests[2].reject(Error('offline'));await settle();
 assert.equal(h.manager.pending,false);assert.equal(h.button('data-trip-id'),undefined);assert.equal(h.cache.saved,null);
 assert.match(h.$('trips-status').textContent,/已刪除.*更新失敗/);
 h.manager.setCache(h.cache);assert.equal(h.button('data-trip-id'),undefined);
});

test('uncertain creation invalidates only catalogue cache and retries with the same idempotency key',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 await h.$('trip-create-open').emit('click');h.$('trip-create-name').value='新旅行';h.$('trip-create-start').value='2028-02-29';h.$('trip-create-end').value='2028-03-01';
 await h.$('trip-create-form').emit('input');const attempt=h.$('trip-create-form').emit('submit');await settle();
 const body=JSON.parse(h.requests[1].options.body);h.requests[1].reject(Error('connection lost'));await attempt;
 assert.equal(h.cache.invalidated,1);assert.equal(h.cache.cleared,0);assert.equal(h.cache.saved,null);assert.equal(h.manager.dirty,true);
 const retry=h.$('trip-create-form').emit('submit');await settle();assert.deepEqual(JSON.parse(h.requests[2].options.body),body);
 h.requests[2].resolve({trip:trip('created',0),revision:0});await retry;
 assert.deepEqual(h.selected,['created']);assert.ok(h.cache.saved.trips.some(value=>value.id==='created'));assert.equal(h.manager.dirty,false);
});

for(const code of [401,403])test(`${code} catalogue failures clear all visible private metadata and account caches`,async t=>{
  const h=harness(t,{saved:catalogue([trip('private')],[trip('private-deleted')])});h.manager.setCurrent(trip('private'));
  const update=h.manager.enter(),error=Error('denied');error.status=code;h.requests[0].reject(error);await update;
  assert.equal(h.cache.cleared,1);assert.equal(h.cache.saved,null);assert.equal(h.$('trip-library').innerHTML,'');
  assert.doesNotMatch(h.$('trip-deleted-library').innerHTML,/private/);assert.doesNotMatch(h.$('trip-current-title').textContent,/private/);
  assert.equal(h.$('trip-account-email').textContent,'尚未登入');assert.match(h.$('trips-status').textContent,/重新登入/);
  assert.deepEqual(h.authFailures,[error]);h.manager.clear();assert.equal(h.authFailures.length,1);
});

test('destructive and creation auth failures notify the app once without recursive clear callbacks',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 await h.click('data-trip-delete');await h.click('data-delete-confirm');
 const denied=Error('denied');denied.status=401;h.requests[1].reject(denied);await settle();
 assert.deepEqual(h.authFailures,[denied]);assert.equal(h.cache.cleared,1);assert.equal(h.manager.pending,false);
 h.manager.setSession({email:'owner@example.test'});h.manager.setCache(h.cache);
 await h.$('trip-create-open').emit('click');h.$('trip-create-name').value='需登入的新旅行';h.$('trip-create-start').value='2028-01-01';h.$('trip-create-end').value='2028-01-01';
 const attempt=h.$('trip-create-form').emit('submit');await settle();
 const forbidden=Error('forbidden');forbidden.status=403;h.requests[2].reject(forbidden);await attempt;
 assert.deepEqual(h.authFailures,[denied,forbidden]);assert.equal(h.cache.cleared,2);assert.equal(h.manager.pending,false);
});

test('a malformed catalogue lacking live account identity cannot enable cached management',async t=>{
 const h=harness(t,{saved:catalogue()});const update=h.manager.enter();
 h.requests[0].resolve({trips:[trip()],deletedTrips:[]});await update;
 assert.equal(h.button('data-trip-delete').disabled,true);assert.equal(h.cache.writes.length,0);assert.deepEqual(h.authFailures,[]);
});

test('old-account responses cannot overwrite a new account and mismatched live identity removes cached metadata',async t=>{
 const h=harness(t,{saved:catalogue([trip('old-private')])});const old=h.manager.enter();
 h.manager.clear();h.manager.setSession({email:'other@example.test'});
 const otherCache={...h.cache,saved:{trips:[trip('other-trip')],deletedTrips:[]},writes:[],purged:[],cleared:0};h.manager.setCache(otherCache);
 const fresh=h.manager.enter();h.requests[1].resolve(catalogue([trip('other-trip')],[],'other@example.test'));await fresh;
 h.requests[0].resolve(catalogue([trip('old-private')]));await old;
 assert.doesNotMatch(h.$('trip-library').innerHTML,/old-private/);assert.match(h.$('trip-library').innerHTML,/other-trip/);assert.equal(otherCache.writes.length,1);
 const mismatch=h.manager.refresh();h.requests[2].resolve(catalogue([trip('wrong-account')],[],'owner@example.test'));await mismatch;
 assert.equal(otherCache.cleared,1);assert.equal(h.$('trip-library').innerHTML,'');assert.match(h.$('trips-status').textContent,/重新登入/);
});

test('selected-trip updates do not extend catalogue freshness or downgrade a newer confirmed revision',async t=>{
 const h=harness(t);const first=h.manager.enter();h.requests[0].resolve(catalogue());await first;
 h.advance(60001);h.manager.setCurrent({...trip('trip-a',9),title:'已儲存的新名稱'});
 assert.equal(h.cache.writes.length,1);
 const update=h.manager.enter();assert.equal(h.requests.length,2);h.requests[1].resolve(catalogue([trip('trip-a',8)]));await update;
 assert.match(h.$('trip-library').innerHTML,/已儲存的新名稱/);assert.equal(h.cache.saved.trips[0].revision,9);
});
