import test from 'node:test';
import assert from 'node:assert/strict';
import {initOverviewReorder} from '../public/reorder.js';

class Surface {
 listeners=new Map();
 addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
 emit(type,props={}){const event={cancelable:true,prevented:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){},...props};for(const fn of this.listeners.get(type)||[])fn(event);return event;}
}
class Node extends Surface {
 constructor(dataset={},box={left:20,top:100,width:200,height:350}){super();this.dataset=dataset;this.box=box;this.isConnected=true;this.children=[];this.disabled=false;this.captured=null;const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};this.style={};}
 closest(selector){if(selector==='[data-overview-stop-id]')return this.dataset.overviewStopId?this:this.parent?.closest(selector)||null;return null;}
 querySelectorAll(selector){const attr=selector==='[data-overview-stop-id]'?'overviewStopId':selector==='[data-overview-day]'?'overviewDay':null;return this.children.flatMap(node=>[...(attr&&node.dataset[attr]!==undefined?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(){return this;}
 getBoundingClientRect(){return {...this.box,right:this.box.left+this.box.width,bottom:this.box.top+this.box.height};}
 cloneNode(){return new Node({...this.dataset},this.box);}
 removeAttribute(name){if(name==='data-overview-stop-id')delete this.dataset.overviewStopId;}
 setAttribute(){}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 setPointerCapture(id){this.captured=id;}
 hasPointerCapture(id){return this.captured===id;}
 releasePointerCapture(){this.captured=null;}
 animate(){return {finished:Promise.resolve()};}
}
function setup(t,{allowed=true}={}){
 let now=0,serial=0,started=0,finished=0;const timers=new Map(),moves=[];
 const window=new Surface(),document=new Surface(),body=new Node(),board=new Node({}, {left:20,top:100,width:650,height:350});
 Object.assign(window,{innerHeight:900,innerWidth:1000,matchMedia:()=>({matches:false}),scrollBy(){}});Object.assign(document,{body,hidden:false,createElement:()=>new Node()});
 const globals={window,document,Element:Node,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 for(const [key,value] of Object.entries(globals)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
 const firstDay=new Node({overviewDay:'0'}),secondDay=new Node({overviewDay:'1'},{left:240,top:100,width:200,height:350});
 const first=new Node({overviewStopId:'first',owner:'0',stop:'0'},{left:28,top:180,width:184,height:80});firstDay.append(first);board.append(firstDay,secondDay);
 initOverviewReorder(board,{canStart:()=>allowed,onStart:()=>{started++;return 'scope';},onFinish:()=>finished++,onMove:(...args)=>moves.push(args)});
 return {board,window,first,body,moves,get started(){return started;},get finished(){return finished;},advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.due<=now){timers.delete(id);timer.fn();}}};
}
const finger=(x=80,y=220)=>({identifier:1,clientX:x,clientY:y});
const pointer=(x=80,y=220,type='mouse')=>({pointerId:1,pointerType:type,clientX:x,clientY:y,button:0,isPrimary:true});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('overview long press floats a card, survives synthetic pointer cancellation and drops into an empty date once',async t=>{
 const s=setup(t);s.board.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(350);assert.equal(s.started,1);assert.equal(s.body.children.length,2);
 s.window.emit('pointercancel',pointer(80,220,'touch'));assert.equal(s.window.emit('touchmove',{touches:[finger(300,250)]}).prevented,true);
 s.window.emit('touchend',{changedTouches:[finger(300,250)]});await flush();assert.deepEqual(s.moves,[['first',1,0,'scope']]);assert.equal(s.finished,1);assert.equal(s.body.children.length,0);
});
test('overview quick tap and normal swipe keep native details-click and scroll behavior',t=>{
 const s=setup(t);s.board.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(100);assert.equal(s.window.emit('touchmove',{touches:[finger(82,245)]}).prevented,false);s.advance(350);assert.equal(s.started,0);
 s.board.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(100);assert.equal(s.window.emit('touchend',{changedTouches:[finger()]}).prevented,false);assert.equal(s.board.emit('click').prevented,false);
});
test('overview drop outside a date and cancelling the active touch never submit',async t=>{
 const s=setup(t);s.board.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(350);s.window.emit('touchend',{changedTouches:[finger(230,220)]});await flush();assert.deepEqual(s.moves,[]);
 s.board.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(350);s.window.emit('touchcancel');await flush();assert.deepEqual(s.moves,[]);assert.equal(s.finished,2);
});
test('overview mouse dragging suppresses its generated details click',async t=>{
 const s=setup(t);s.board.emit('pointerdown',{target:s.first,...pointer()});s.window.emit('pointermove',pointer(300,250));s.window.emit('pointerup',pointer(300,250));await flush();assert.deepEqual(s.moves,[['first',1,0,'scope']]);assert.equal(s.board.emit('click').prevented,true);
});
test('overview write guards prevent lifting while read-only or another editor is active',t=>{
 const s=setup(t,{allowed:false});s.board.emit('touchstart',{target:s.first,touches:[finger()]});s.advance(350);s.board.emit('pointerdown',{target:s.first,...pointer()});s.window.emit('pointermove',pointer(300,250));assert.equal(s.started,0);assert.deepEqual(s.moves,[]);
});
