import test from 'node:test';
import assert from 'node:assert/strict';
import {initReorder} from '../public/reorder.js';

// Exercise the real event handlers, including the two event streams browsers
// emit for a single finger. Layout/animation are a small in-memory DOM fixture.
class Surface {
 listeners=new Map();
 addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
 emit(type,props={}){
  const event={cancelable:true,prevented:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){},...props};
  for(const listener of this.listeners.get(type)||[])listener(event);
  return event;
 }
}
class Card extends Surface {
 constructor(id,top=0){
  super();this.dataset=id?{stopId:id}:{};this.top=top;this.isConnected=true;
  const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n)};
  this.style={setProperty(){},removeProperty(){}};this.children=[];this.captured=null;
 }
 closest(selector){return selector==='[data-stop-id]'&&this.dataset.stopId?this:null;}
 querySelectorAll(selector){return selector==='[data-stop-id]'?this.children.filter(c=>c.dataset.stopId):[];}
 contains(card){return this.children.includes(card);}
 getBoundingClientRect(){return {left:20,top:this.top,width:320,height:100};}
 cloneNode(){return new Card(this.dataset.stopId,this.top);}
 removeAttribute(name){if(name==='data-stop-id')delete this.dataset.stopId;}
 setAttribute(){}
 append(child){child.parent=this;this.children.push(child);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
 setPointerCapture(id){this.captured=id;}
 hasPointerCapture(id){return this.captured===id;}
 releasePointerCapture(){this.captured=null;}
 animate(){return {finished:Promise.resolve()};}
}
function setup(t,{allowed=true}={}){
 let now=0,serial=0;const timers=new Map(),moves=[];
 const window=new Surface(),body=new Card(),document=new Surface(),container=new Card();
 Object.assign(window,{scrollY:0,innerHeight:900,matchMedia:()=>({matches:false}),scrollBy(){}});
 Object.assign(document,{body,hidden:false,createElement:()=>new Card()});
 const globals={window,document,Element:Card,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
  setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 for(const [key,value] of Object.entries(globals)){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
 }
 const first=new Card('first',120),second=new Card('second',230);container.append(first);container.append(second);
 let started=0,finished=0;
 initReorder(container,{canStart:()=>allowed,onStart:()=>{started++;return 'scope';},onFinish:()=>{finished++;},onMove:(...args)=>moves.push(args)});
 return {window,body,container,first,moves,get started(){return started;},get finished(){return finished;},
  advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.due<=now){timers.delete(id);timer.fn();}}};
}
const finger=(y=150)=>({identifier:1,clientX:80,clientY:y});
const pointer=(type='touch',y=150,id=1)=>({pointerType:type,pointerId:id,clientX:80,clientY:y,button:0,isPrimary:true});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function hold(s){s.container.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(350);assert.equal(s.started,1);}

test('touch pointer cancellation and lost capture do not abort the TouchEvent drag',async t=>{
 const s=setup(t);hold(s);assert.equal(s.body.children.length,1);
 s.window.emit('pointercancel',pointer());s.container.emit('lostpointercapture',pointer());
 assert.equal(s.body.classList.contains('reorder-active'),true);
 assert.equal(s.window.emit('touchmove',{touches:[finger(300)]}).prevented,true);
 s.window.emit('touchend',{changedTouches:[finger(300)]});await flush();
 assert.deepEqual(s.moves,[['first',1,'scope']]);assert.equal(s.finished,1);assert.equal(s.body.children.length,0);
});

test('unrelated mouse cancellation cannot abort a held finger with a matching numeric id',async t=>{
 const s=setup(t);hold(s);s.window.emit('pointercancel',pointer('mouse'));s.container.emit('lostpointercapture',pointer('mouse'));
 assert.equal(s.window.emit('pointermove',pointer('mouse',300)).prevented,false);
 s.window.emit('pointerup',pointer('mouse',300));
 assert.equal(s.window.emit('touchmove',{touches:[finger(300)]}).prevented,true);
 s.window.emit('touchend',{changedTouches:[finger(300)]});await flush();assert.equal(s.moves.length,1);
});

test('real touch cancellation removes the lifted card and never saves',async t=>{
 const s=setup(t);hold(s);s.window.emit('touchmove',{touches:[finger(300)]});s.window.emit('touchcancel');await flush();
 assert.deepEqual(s.moves,[]);assert.equal(s.finished,1);assert.equal(s.body.children.length,0);
 assert.equal(s.body.classList.contains('reorder-active'),false);
});

test('a second finger cancels a held drag without submitting',async t=>{
 const s=setup(t);hold(s);s.window.emit('touchmove',{touches:[finger(),{...finger(),identifier:2}]});await flush();
 assert.deepEqual(s.moves,[]);assert.equal(s.finished,1);assert.equal(s.body.children.length,0);
});

test('a normal swipe and a quick tap keep native scrolling and details-click behavior',t=>{
 const s=setup(t);s.container.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(100);
 assert.equal(s.window.emit('touchmove',{touches:[finger(180)]}).prevented,false);s.advance(350);assert.equal(s.started,0);
 s.container.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(100);
 assert.equal(s.window.emit('touchend',{changedTouches:[finger()]}).prevented,false);s.advance(350);
 assert.equal(s.container.emit('click').prevented,false);assert.equal(s.started,0);
});

test('mouse body drag saves once and suppresses its generated details click',async t=>{
 const s=setup(t);s.container.emit('pointerdown',{target:s.first,...pointer('mouse')});
 assert.equal(s.window.emit('pointermove',pointer('mouse',300)).prevented,true);
 s.window.emit('pointerup',pointer('mouse',300));await flush();
 assert.deepEqual(s.moves,[['first',1,'scope']]);assert.equal(s.finished,1);
 assert.equal(s.container.emit('click').prevented,true);
});

test('matching mouse cancellation cleans up but an unrelated pointer id does not',async t=>{
 const s=setup(t);s.container.emit('pointerdown',{target:s.first,...pointer('mouse')});s.window.emit('pointermove',pointer('mouse',300));
 s.window.emit('pointercancel',pointer('mouse',300,2));await flush();assert.equal(s.finished,0);
 s.window.emit('pointercancel',pointer('mouse',300));await flush();assert.equal(s.finished,1);assert.deepEqual(s.moves,[]);
});

test('viewers cannot start touch or mouse sorting',t=>{
 const s=setup(t,{allowed:false});s.container.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(350);
 s.container.emit('pointerdown',{target:s.first,...pointer('mouse')});s.window.emit('pointermove',pointer('mouse',300));
 assert.equal(s.started,0);assert.equal(s.body.children.length,0);assert.deepEqual(s.moves,[]);
});
