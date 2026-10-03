import test from 'node:test';
import assert from 'node:assert/strict';
import {createReorderGesture,reorderLayout} from '../public/reorder.js';

function setup(allowed=()=>true){
 let now=0,serial=0;const timers=new Map(),events=[];
 const gesture=createReorderGesture({
  setTimer(fn,delay){const id=++serial;timers.set(id,{fn,due:now+delay});return id;},
  clearTimer(id){timers.delete(id);},
  onActivate(point,payload){if(!allowed())return false;events.push(['lift',point,payload]);},
  onDrag(point,payload){events.push(['move',point,payload]);},
  onDrop(point,payload){events.push(['drop',point,payload]);},
  onCancel(payload){events.push(['cancel',payload]);}
 });
 return {gesture,events,advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.due<=now){timers.delete(id);timer.fn();}}};
}
const point=(type='touch',x=80,y=100,id=1)=>({type,x,y,id});

test('quick tap never lifts or saves, including a timer that would fire later',()=>{
 const {gesture,events,advance}=setup();gesture.begin(point(),'a');advance(150);
 assert.equal(gesture.end(point()),false);advance(400);assert.deepEqual(events,[]);
});
test('touch scroll before long press cancels dragging and remains unconsumed',()=>{
 const {gesture,events,advance}=setup();gesture.begin(point(),'a');advance(100);
 assert.equal(gesture.move(point('touch',82,125)),false);advance(400);
 assert.equal(gesture.pending,false);assert.deepEqual(events,[]);
});
test('stationary long press lifts; subsequent touch coordinates follow and drop once',()=>{
 const {gesture,events,advance}=setup();gesture.begin(point(),'a');advance(349);assert.equal(gesture.active,false);
 advance(1);assert.equal(gesture.active,true);assert.equal(gesture.move(point('touch',95,240)),true);
 assert.equal(gesture.end(point('touch',95,240)),true);assert.equal(gesture.end(point()),false);
 assert.deepEqual(events.map(e=>e[0]),['lift','move','drop']);assert.equal(events[1][1].y,240);
});
test('mouse threshold preserves clicks; moving the whole card lifts without a timer',()=>{
 const {gesture,events}=setup();gesture.begin(point('mouse'),'a');assert.equal(gesture.move(point('mouse',82,103)),false);
 assert.equal(gesture.move(point('mouse',90,120)),true);gesture.end(point('mouse',90,120));
 assert.deepEqual(events.map(e=>e[0]),['lift','move','drop']);assert.equal(events[0][1].y,100);
});
test('another pointer cannot move or finish the active card',()=>{
 const {gesture,events,advance}=setup();gesture.begin(point(),'a');advance(350);
 assert.equal(gesture.move(point('touch',80,200,2)),false);assert.equal(gesture.end(point('touch',80,200,2)),false);
 assert.equal(gesture.active,true);gesture.cancel();assert.deepEqual(events.map(e=>e[0]),['lift','cancel']);
});
test('cancelled long press and lost permission cannot lift or submit',()=>{
 let allowed=true;const {gesture,events,advance}=setup(()=>allowed);
 gesture.begin(point(),'a');gesture.cancel();advance(350);assert.deepEqual(events,[]);
 gesture.begin(point(),'a');allowed=false;advance(350);assert.equal(gesture.pending,false);assert.deepEqual(events,[]);
});
test('unequal card heights give a stable upward slot and move neighbours aside',()=>{
 const boxes=[{top:100,height:120},{top:230,height:200},{top:440,height:160}];
 assert.deepEqual(reorderLayout(boxes,2,160),{to:0,top:100,shifts:[170,170,0]});
 assert.deepEqual(reorderLayout(boxes,2,520),{to:2,top:440,shifts:[0,0,0]});
});
test('downward insertion and single-card drops retain the correct gap',()=>{
 const boxes=[{top:100,height:120},{top:230,height:200},{top:440,height:160}];
 assert.deepEqual(reorderLayout(boxes,0,550),{to:2,top:480,shifts:[0,-130,-130]});
 assert.deepEqual(reorderLayout([{top:100,height:120}],0,800),{to:0,top:100,shifts:[0]});
});
