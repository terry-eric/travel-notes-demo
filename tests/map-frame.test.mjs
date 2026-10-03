import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapFrame,placeEmbedUrl} from '../public/map-frame.js';

function harness(){
 let active=true,connected=true,next=0,source='',resets=0;
 const jobs=new Map(),requests=[],reports=[],listeners={load:new Set(),error:new Set()};
 const status={hidden:true,textContent:'',dataset:{}};
 const frame={isConnected:true,contentDocument:null,get src(){return source;},set src(value){source=value;requests.push(value);},removeAttribute(){source='';resets++;},addEventListener(name,fn){listeners[name].add(fn);},removeEventListener(name,fn){listeners[name].delete(fn);},emit(name){for(const fn of [...listeners[name]])fn();}};
 const controller=createMapFrame({getFrame:()=>frame,status,isActive:()=>active,online:()=>connected,report:detail=>reports.push(detail),schedule:(fn,delay)=>{const id=++next;jobs.set(id,{fn,delay});return id;},cancel:id=>jobs.delete(id)});
 return {controller,status,frame,requests,reports,jobs,get resets(){return resets;},get loadListener(){return [...listeners.load][0];},set active(value){active=value;},set connected(value){connected=value;},tick(){const [id,job]=jobs.entries().next().value||[];assert.ok(job,'expected a scheduled operation');jobs.delete(id);job.fn();}};
}
test('rapid selections navigate only the final place and retain the connected iframe',()=>{
 const h=harness();h.controller.load('a','A');h.controller.load('b','B');h.tick();
 assert.deepEqual(h.requests,['b']);assert.equal(h.resets,0);
 const oldLoad=h.loadListener;h.controller.load('c','C');oldLoad();assert.equal(h.status.hidden,false);
 h.tick();oldLoad();assert.equal(h.status.hidden,false);
 h.frame.emit('load');assert.equal(h.status.hidden,true);assert.equal(h.jobs.size,0);
 h.controller.load('c','C');assert.equal(h.jobs.size,0);
 h.controller.load('c','C',{force:true});h.tick();assert.deepEqual(h.requests,['b','c','c']);assert.equal(h.resets,0);
});
test('about:blank load is not success and cannot cancel recovery of a Google navigation',()=>{
 const h=harness();h.controller.load('a','A');h.tick();h.frame.contentDocument={URL:'about:blank'};h.frame.emit('load');
 assert.equal(h.status.hidden,false);assert.equal(h.jobs.size,1);
 h.tick();assert.equal(h.status.dataset.state,'slow');assert.equal(h.requests.length,1);
 h.frame.emit('load');assert.equal(h.status.hidden,false);
 h.frame.contentDocument=null;h.frame.emit('load');assert.equal(h.status.hidden,true);assert.equal(h.jobs.size,0);assert.equal(h.resets,0);
});
test('slow loads keep the original request, repeated renders do not restart it, and late loads finish it',()=>{
 const h=harness();h.controller.load('a','A');h.tick();const first=h.loadListener;
 h.tick();assert.equal(h.status.dataset.state,'slow');assert.match(h.status.textContent,/繼續載入/);
 for(let i=0;i<10;i++)h.controller.load('a','A');
 assert.equal(h.requests.length,1);assert.equal(h.jobs.size,0);
 first();assert.equal(h.status.hidden,true);
 h.controller.load('a','A',{force:true});h.tick();assert.equal(h.requests.length,2);h.frame.emit('load');assert.equal(h.status.hidden,true);
});
test('offline maps resume on reconnection and closing cancels pending work',()=>{
 const h=harness();h.connected=false;h.controller.load('a','A');assert.equal(h.jobs.size,0);assert.match(h.status.textContent,/沒有網路/);
 h.connected=true;h.controller.connectionChanged();h.tick();assert.equal(h.frame.src,'a');
 h.controller.clear();h.frame.emit('load');assert.equal(h.jobs.size,0);assert.equal(h.frame.src,'a');assert.equal(h.resets,0);
 h.controller.load('b','B');h.active=false;h.tick();assert.equal(h.requests.length,1);
});
test('closing/reopening reuses a completed map without blanking it or making a new request',()=>{
 const h=harness();h.controller.load('a','A');h.tick();h.frame.emit('load');
 for(let i=0;i<10;i++){h.controller.clear();h.active=false;assert.equal(h.frame.src,'a');h.active=true;h.controller.load('a','A');assert.equal(h.status.hidden,true);assert.equal(h.jobs.size,0);}
 assert.deepEqual(h.requests,['a']);assert.equal(h.resets,0);
 h.controller.load('a','A',{force:true});h.tick();assert.deepEqual(h.requests,['a','a']);
});
test('reopening a slow map reuses its pending navigation and catches its late load',()=>{
 const h=harness();h.controller.load('a','A');h.tick();h.tick();
 assert.equal(h.status.dataset.state,'slow');h.controller.clear();
 h.controller.load('a','A');h.tick();assert.deepEqual(h.requests,['a']);
 h.frame.emit('load');assert.equal(h.status.hidden,true);assert.equal(h.jobs.size,0);
});
test('late Google loads clear the slow notice and diagnostics omit credentials',()=>{
 const h=harness(),url='https://www.google.com/maps/embed/v1/place?key=private-test-key&q=private-place';
 h.controller.load(url,'A');h.tick();h.tick();
 assert.equal(h.status.dataset.state,'slow');assert.equal(h.reports.length,1);
 assert.equal(JSON.stringify(h.reports).includes('private'),false);
 h.frame.emit('load');assert.equal(h.status.hidden,true);assert.equal(h.jobs.size,0);
});
test('actual frame errors retry only twice, without an unbounded reload loop',()=>{
 const h=harness();h.controller.load('a','A');h.tick();
 h.frame.emit('error');h.tick();h.frame.emit('error');h.tick();h.frame.emit('error');
 assert.equal(h.requests.length,3);assert.equal(h.jobs.size,0);assert.match(h.status.textContent,/暫時無法載入/);
 h.frame.emit('load');assert.equal(h.status.hidden,true);
});
test('iframe errors retry navigation and place URLs use the official Embed endpoint',()=>{
 const h=harness();h.controller.load('a','A');h.tick();h.frame.emit('error');assert.match(h.status.textContent,/1\/2/);h.tick();h.frame.emit('load');assert.equal(h.jobs.size,0);
 const url=new URL(placeEmbedUrl('北菓樓 札幌本館','test-key'));
 assert.equal(url.pathname,'/maps/embed/v1/place');assert.equal(url.searchParams.get('q'),'北菓樓 札幌本館');assert.equal(url.searchParams.get('key'),'test-key');assert.equal(placeEmbedUrl('place',''),'');
});
