import test from 'node:test';
import assert from 'node:assert/strict';
import {tags,tagCategory,tagOptions,isFixedStop,renderFixedStopBadge,renderCardTag,applyStopTag} from '../public/tags.js';
import {mergeTrip} from '../public/merge.js';
import {validateDays} from '../server/api.js';
import {seedDays} from '../public/seed.js';

test('new and earlier labels select stable categories, arbitrary labels remain neutral',()=>{
 for(const {label,id} of tags)assert.equal(tagCategory(label),id);
 assert.equal(tagCategory('固定演唱會'),'concert');
 assert.equal(tagCategory('甜點'),'cafe');
 assert.equal(tagCategory('<script>'),'other');
 assert.equal(tagOptions('我的收藏')[0],'我的收藏');
 assert.equal(tagOptions('演唱會').filter(value=>value==='演唱會').length,1);
});
test('saving tag changes preserves fixed concerts, times and stay durations',()=>{
 const days=structuredClone(seedDays);
 days[2].stops.at(-1).tag='演唱會';
 days[2].stops.at(-1).duration=120;
 const saved=validateDays(days)[2].stops.at(-1);
 assert.equal(saved.tag,'演唱會');
 assert.equal(saved.live,true);
 assert.equal(saved.time,seedDays[2].stops.at(-1).time);
 assert.equal(saved.duration,120);
});
test('inline changes affect only ordinary tags and preserve custom labels, private fields and identity',()=>{
 const days=structuredClone(seedDays),stop={id:'ordinary-tags',name:'測試行程',tag:'景點',kind:'place',time:'08:00',duration:120,createdBy:'owner@example.test',q:'台北車站',routeQuery:'台北車站',mode:'transit',coordinates:{lat:25.08,lng:121.23},booking:{reference:'TESTONLY'},desc:'保留的私密筆記'};
 days[0].stops.unshift(stop);const before=structuredClone(days),result=applyStopTag(days,0,stop.id,'交通');
 assert.deepEqual(result.days[0].stops[0],{...stop,tag:'交通'});assert.deepEqual(days,before);assert.deepEqual(result.days.slice(1),days.slice(1));
 assert.equal(tagCategory(result.days[0].stops[0].tag),'transport');assert.equal(tagCategory(applyStopTag(days,0,stop.id,'咖啡').days[0].stops[0].tag),'cafe');
 const saved=validateDays(result.days)[0].stops[0];assert.equal(saved.tag,'交通');assert.equal(saved.time,'08:00');assert.equal(saved.duration,120);assert.equal(saved.desc,'保留的私密筆記');
 days[0].stops[0].tag='我的收藏';assert.equal(applyStopTag(days,0,stop.id,'我的收藏').changed,false);assert.equal(applyStopTag(days,0,stop.id,'咖啡').days[0].stops[0].tag,'咖啡');
 assert.throws(()=>applyStopTag(days,1,stop.id,'咖啡'),/移動或刪除/);assert.throws(()=>applyStopTag(days,0,stop.id,'未提供的標籤'),/有效/);assert.throws(()=>applyStopTag(days,-1,stop.id,'咖啡'),/日期/);
});
test('fixed concerts and flights reject inline type changes without modifying booking data or any input',()=>{
 const days=structuredClone(seedDays),flight={id:'flight-tags',name:'測試航班',tag:'機票',kind:'flight',time:'08:00',duration:120,live:true,createdBy:'owner@example.test',q:'TPE',routeQuery:'TPE',mode:'transit',coordinates:{lat:25.08,lng:121.23},flight:{departureAirport:'TPE',arrivalAirport:'KIX',departureDateTime:'2026-11-11T08:00',arrivalDateTime:'2026-11-11T11:00',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo',bookingReference:'TESTONLY'},desc:'保留的筆記'};
 days[0].stops.unshift(flight);
 for(const fixed of [flight,{...flight,live:false},{...flight,live:undefined},{id:'concert-tags',name:'固定預約',tag:'演唱會',live:true,time:'19:00',duration:120}]){
  days[0].stops[0]=fixed;const before=structuredClone(days);
  assert.throws(()=>applyStopTag(days,0,fixed.id,'交通'),/固定行程.*編輯視窗/);assert.throws(()=>applyStopTag(days,0,fixed.id,fixed.tag),/編輯視窗/);assert.deepEqual(days,before);
 }
 // The full editor still saves a reviewed flight type without damaging its ticket.
 days[0].stops[0]={...flight,tag:'交通'};const saved=validateDays(days)[0].stops[0];assert.equal(saved.tag,'交通');assert.equal(saved.kind,'flight');assert.equal(saved.live,true);assert.equal(saved.time,'08:00');assert.equal(saved.duration,120);assert.equal(saved.flight.bookingReference,'TESTONLY');
});
test('fixed detection is exact and lock badges expose a static accessible explanation without controls or private data',()=>{
 for(const stop of [{live:true},{kind:'flight'},{kind:'flight',live:false}]){
  assert.equal(isFixedStop(stop),true);const badge=renderFixedStopBadge({...stop,name:'<private>',tag:'<script>',desc:'private notes'});
  assert.match(badge,/class="fixed-stop-badge"/);assert.match(badge,/title="請至編輯視窗調整"/);assert.match(badge,/<svg[^>]+aria-hidden="true"/);assert.match(badge,/>固定行程<\/span>/);assert.doesNotMatch(badge,/<button|<select|<input|<script>|private|data-write|onclick/i);
 }
 for(const stop of [null,undefined,{}, {live:false},{live:'true'},{live:1},{kind:'place'}]){assert.equal(isFixedStop(stop),false);assert.equal(renderFixedStopBadge(stop),'');}
});
test('fixed tags are static for editors and viewers and ignore stale inline draft values',()=>{
 for(const stop of [{id:'concert',name:'固定演出',tag:'演唱會',live:true},{id:'flight',name:'航班',tag:'機票',kind:'flight',live:false},{id:'unsafe',name:'<private>',tag:'自訂<名稱>"',live:true}]){
  for(const canEdit of [false,true]){
   const html=renderCardTag(stop,0,{canEdit,value:'購物'});assert.match(html,/class="tag is-fixed"/);assert.match(html,/title="請至編輯視窗調整"/);assert.doesNotMatch(html,/<select|<option|<button|data-card-tag|購物|<名稱>|<private>/);
   assert.ok(html.includes(stop.tag==='演唱會'?'♫ 演唱會':stop.tag==='機票'?'機票':'自訂&lt;名稱&gt;&quot;'));
  }
 }
});
test('card badge is a labelled native selector for editors and text for viewers, with escaped custom values',()=>{
 const stop={id:'a"b',name:'景點 <A>',tag:'自訂<名稱>'};const editor=renderCardTag(stop,2,{canEdit:true}),viewer=renderCardTag(stop,2);
 assert.match(editor,/select class="tag card-tag-selector"/);assert.match(editor,/data-tag-day="2"/);assert.match(editor,/data-tag-id="a&quot;b"/);assert.match(editor,/aria-label="景點 &lt;A&gt;：更改行程標籤"/);assert.match(editor,/value="自訂&lt;名稱&gt;" selected/);assert.equal(editor.includes('<button'),false);
 assert.equal(viewer,'<span class="tag">自訂&lt;名稱&gt;</span>');assert.equal(viewer.includes('select'),false);
 assert.match(renderCardTag(stop,'2" onfocus="unsafe',{canEdit:true}),/data-tag-day="2&quot; onfocus=&quot;unsafe"/);
});
test('concurrent edits to other fields merge with inline tags and differing tags require a choice',()=>{
 const base=[{date:'1/1',stops:[{id:'a',name:'原名稱',time:'09:00',tag:'景點',q:'台北車站',desc:'',duration:30,mode:'walking',createdBy:'owner@example.test'}]}];
 const mine=applyStopTag(base,0,'a','咖啡').days,theirs=structuredClone(base);theirs[0].stops[0].name='新名稱';theirs[0].stops[0].duration=60;
 let merged=mergeTrip(base,mine,theirs);assert.equal(merged.unresolved.length,0);assert.deepEqual(merged.days[0].stops[0],{...theirs[0].stops[0],tag:'咖啡'});
 theirs[0].stops[0].tag='購物';merged=mergeTrip(base,mine,theirs);assert.deepEqual(merged.unresolved.map(item=>item.key),['a:tag']);
 assert.equal(mergeTrip(base,mine,theirs,{'a:tag':'mine'}).days[0].stops[0].tag,'咖啡');assert.equal(mergeTrip(base,mine,theirs,{'a:tag':'theirs'}).days[0].stops[0].tag,'購物');
});
