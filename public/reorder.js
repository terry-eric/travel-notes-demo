// Reorder by stable identity; titles and remote renames never determine identity.
export function moveStop(stops,id,to){
 const from=stops.findIndex(s=>s.id===id);
 if(from<0||!Number.isInteger(to)||to<0||to>=stops.length)throw Error('找不到要移動的行程。');
 const result=stops.slice();result.splice(to,0,result.splice(from,1)[0]);return result;
}

// Touch scrolling wins until a stationary long press; mouse/pen use a movement threshold.
export function createReorderGesture({onActivate,onDrag,onDrop,onCancel,setTimer=setTimeout,clearTimer=clearTimeout}){
 let state=null;
 const matches=point=>state&&point.id===state.point.id&&point.type===state.point.type;
 function cancel(point){if(point&&!matches(point))return;const old=state;state=null;if(!old)return;clearTimer(old.timer);if(old.active)onCancel(old.payload);}
 function activate(){if(!state)return false;if(onActivate(state.origin,state.payload)===false){cancel();return false;}state.active=true;return true;}
 return {
  begin(point,payload){
   if(state)return false;
   state={point:{...point},origin:{...point},payload,active:false,timer:null};
   if(point.type==='touch')state.timer=setTimer(activate,350);return true;
  },
  move(point){
   if(!matches(point))return false;state.point={...point};
   if(!state.active){
    const distance=Math.hypot(point.x-state.origin.x,point.y-state.origin.y);
    if(state.origin.type==='touch'){if(distance>10)cancel();return false;}
    if(distance<6||!activate())return false;
   }
   onDrag(point,state.payload);return true;
  },
  end(point){
   if(!matches(point))return false;
   const old=state;state=null;clearTimer(old.timer);if(old.active)onDrop(point,old.payload);return old.active;
  },cancel,get active(){return !!state?.active;},get pending(){return !!state;}
 };
}

// Original rectangles keep animated neighbours from changing the insertion target.
export function reorderLayout(boxes,from,center){
 const source=boxes[from],others=boxes.filter((_,i)=>i!==from);
 const to=others.filter(box=>center>box.top+box.height/2).length;
 const gap=from<boxes.length-1?boxes[from+1].top-source.top-source.height:from>0?source.top-boxes[from-1].top-boxes[from-1].height:0;
 const extent=source.height+gap;
 const shifts=boxes.map((_,i)=>to<from&&i>=to&&i<from?extent:to>from&&i>from&&i<=to?-extent:0);
 const top=to===from?source.top:to<from?boxes[to].top:boxes[to].top+boxes[to].height-source.height;
 return {to,top,shifts};
}

export function initReorder(container,{canStart,onStart,onFinish,onMove}){
 let drag=null,frame=0,settling=false,suppressClickUntil=0;
 const cards=()=>[...container.querySelectorAll('[data-stop-id]')];
 const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 function eligible(target){
  if(settling||!canStart()||!(target instanceof Element))return null;
  const card=target.closest('[data-stop-id]');
  if(!card||!container.contains(card)||target.closest('input,select,textarea,a,form,[contenteditable="true"]'))return null;
  const button=target.closest('button');
  if((button&&!button.matches('.stop-name,[data-reorder-handle]'))||button?.disabled)return null;
  return card;
 }
 function updatePosition(){
  if(!drag)return;
  const center=drag.rect.top+drag.rect.height/2+drag.point.y-drag.start.y+window.scrollY;
  const layout=reorderLayout(drag.boxes,drag.from,center);drag.to=layout.to;
  drag.items.forEach((card,i)=>card.style.setProperty('--reorder-shift',`${layout.shifts[i]}px`));
  const bounds=container.getBoundingClientRect();
  drag.placeholder.style.top=`${layout.top-window.scrollY-bounds.top}px`;
 }
 function renderFrame(){
  if(!drag||settling)return;const d=drag;
  // A stationary long press near an edge must not start scrolling by itself.
  if(d.moved){
   const top=100,bottom=window.innerHeight-70;
   const speed=d.point.y<top?-Math.min(16,(top-d.point.y)/5):d.point.y>bottom?Math.min(16,(d.point.y-bottom)/5):0;
   if(speed)window.scrollBy(0,speed);
  }
  const x=d.point.x-d.start.x,y=d.point.y-d.start.y;
  d.visualX+=(x-d.visualX)*(reduced()?1:.45);d.visualY+=(y-d.visualY)*(reduced()?1:.45);
  d.ghost.style.transform=`translate3d(${d.visualX}px,${d.visualY}px,0) scale(${reduced()?1:1.025})`;
  updatePosition();frame=requestAnimationFrame(renderFrame);
 }
 function activate(point,card){
  if(!card.isConnected||settling||!canStart())return false;
  const items=cards(),from=items.indexOf(card),rect=card.getBoundingClientRect(),ghost=card.cloneNode(true);
  ghost.removeAttribute('id');ghost.removeAttribute('data-stop-id');
  ghost.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  ghost.classList.remove('selected');ghost.classList.add('reorder-ghost');ghost.setAttribute('aria-hidden','true');ghost.inert=true;
  Object.assign(ghost.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  const placeholder=document.createElement('div');placeholder.className='reorder-placeholder';placeholder.setAttribute('aria-hidden','true');
  Object.assign(placeholder.style,{left:`${rect.left-container.getBoundingClientRect().left}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  drag={id:card.dataset.stopId,from,to:from,card,items,rect,ghost,placeholder,point:{...point},start:{...point},visualX:0,visualY:0,moved:false,scope:onStart(),
   boxes:items.map(el=>{const box=el.getBoundingClientRect();return {top:box.top+window.scrollY,height:box.height};})};
  card.classList.add('reorder-source');container.classList.add('is-reordering');document.body.classList.add('reorder-active');
  container.append(placeholder);document.body.append(ghost);
  if(point.type!=='touch')card.setPointerCapture(point.id);
  updatePosition();frame=requestAnimationFrame(renderFrame);return true;
 }
 async function finish(save){
  if(!drag||settling)return;settling=true;cancelAnimationFrame(frame);
  const d=drag;suppressClickUntil=performance.now()+400;
  if(d.point.type!=='touch'&&d.card.hasPointerCapture(d.point.id))d.card.releasePointerCapture(d.point.id);
  try{
   if(save&&d.to!==d.from)await onMove(d.id,d.to,d.scope);
   d.items.forEach(el=>el.style.removeProperty('--reorder-shift'));d.placeholder.remove();container.classList.remove('is-reordering');
   const target=cards().find(el=>el.dataset.stopId===d.id);
   if(target){
    target.classList.add('reorder-source');const box=target.getBoundingClientRect();
    const animation=d.ghost.animate([{transform:d.ghost.style.transform},{transform:`translate3d(${box.left-d.rect.left}px,${box.top-d.rect.top}px,0) scale(1)`}],
     {duration:reduced()?0:200,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
    await animation.finished.catch(()=>{});target.classList.remove('reorder-source');
   }
  }finally{
   d.ghost.remove();d.placeholder.remove();d.card.classList.remove('reorder-source');d.items.forEach(el=>el.style.removeProperty('--reorder-shift'));
   container.classList.remove('is-reordering');document.body.classList.remove('reorder-active');drag=null;settling=false;onFinish();
  }
 }
 const gesture=createReorderGesture({onActivate:activate,onDrag:point=>{drag.point={...point};drag.moved=true;updatePosition();},
  onDrop:point=>{drag.point={...point};updatePosition();void finish(true);},onCancel:()=>void finish(false)});
 const pointer=event=>({id:event.pointerId,type:event.pointerType,x:event.clientX,y:event.clientY});
 const touch=item=>({id:item.identifier,type:'touch',x:item.clientX,y:item.clientY});
 container.addEventListener('pointerdown',event=>{
  if(event.pointerType==='touch'||event.button!==0||!event.isPrimary)return;
  const card=eligible(event.target);if(card)gesture.begin(pointer(event),card);
 });
 window.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'&&gesture.move(pointer(event)))event.preventDefault();});
 window.addEventListener('pointerup',event=>{if(event.pointerType!=='touch')gesture.end(pointer(event));});
 // A finger also emits Pointer Events. Its pointer stream may be cancelled by
 // native panning while our non-passive Touch Events still own the held drag.
 // Only touchcancel cancels that stream; unrelated pointer identities do not.
 window.addEventListener('pointercancel',event=>{if(event.pointerType!=='touch')gesture.cancel(pointer(event));});
 container.addEventListener('lostpointercapture',event=>{if(!settling&&event.pointerType!=='touch')gesture.cancel(pointer(event));});
 container.addEventListener('touchstart',event=>{
  if(event.touches.length!==1){gesture.cancel();return;}
  const card=eligible(event.target);if(card)gesture.begin(touch(event.touches[0]),card);
 },{passive:true});
 window.addEventListener('touchmove',event=>{
  if(event.touches.length!==1){gesture.cancel();return;}
  if(gesture.move(touch(event.touches[0]))&&event.cancelable)event.preventDefault();
 },{passive:false});
 window.addEventListener('touchend',event=>{for(const item of event.changedTouches)if(gesture.end(touch(item))&&event.cancelable)event.preventDefault();},{passive:false});
 window.addEventListener('touchcancel',()=>gesture.cancel());
 container.addEventListener('contextmenu',event=>{if(gesture.pending)event.preventDefault();});
 container.addEventListener('click',event=>{
  if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();suppressClickUntil=0;}
 },true);
 window.addEventListener('blur',()=>gesture.cancel());window.addEventListener('resize',()=>gesture.cancel());
 document.addEventListener('visibilitychange',()=>{if(document.hidden)gesture.cancel();});
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture.pending){event.preventDefault();gesture.cancel();}});
 container.addEventListener('keydown',async event=>{
  const handle=event.target.closest('[data-reorder-handle],[data-reorder-card]');
  if(!handle||handle.disabled||settling||gesture.pending||!['ArrowUp','ArrowDown','Home','End'].includes(event.key)||!canStart())return;
  event.preventDefault();const items=cards(),card=handle.closest('[data-stop-id]'),from=items.indexOf(card);
  const to=event.key==='Home'?0:event.key==='End'?items.length-1:from+(event.key==='ArrowUp'?-1:1);
  if(to<0||to>=items.length||to===from)return;settling=true;const scope=onStart();
  try{await onMove(card.dataset.stopId,to,scope);}finally{settling=false;onFinish();}
 });
 return {cancel:gesture.cancel};
}
