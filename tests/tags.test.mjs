import test from 'node:test';
import assert from 'node:assert/strict';
import {tags,tagCategory,tagOptions,renderCardTag,applyStopTag} from '../public/tags.js';
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
test('inline changes affect only the tag and preserve custom labels, booking data and identity',()=>{
 const days=structuredClone(seedDays),flight={id:'flight-tags',name:'測試航班',tag:'機票',kind:'flight',time:'08:00',duration:120,live:true,createdBy:'owner@example.test',q:'TPE',routeQuery:'TPE',mode:'transit',coordinates:{lat:25.08,lng:121.23},flight:{departureAirport:'TPE',arrivalAirport:'KIX',departureDateTime:'2026-11-11T08:00',arrivalDateTime:'2026-11-11T11:00',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo',bookingReference:'TESTONLY'},desc:'保留的筆記'};
 days[0].stops.unshift(flight);const result=applyStopTag(days,0,flight.id,'交通');
 assert.deepEqual(result.days[0].stops[0],{...flight,tag:'交通'});assert.deepEqual(days[0].stops[0],flight);assert.deepEqual(result.days.slice(1),days.slice(1));
 const saved=validateDays(result.days)[0].stops[0];assert.equal(saved.tag,'交通');assert.equal(saved.kind,'flight');assert.equal(saved.live,true);assert.equal(saved.time,'08:00');assert.equal(saved.duration,120);assert.equal(saved.flight.bookingReference,'TESTONLY');
 days[0].stops[0].tag='我的收藏';assert.equal(applyStopTag(days,0,flight.id,'我的收藏').changed,false);assert.equal(applyStopTag(days,0,flight.id,'咖啡').days[0].stops[0].tag,'咖啡');
 assert.throws(()=>applyStopTag(days,1,flight.id,'咖啡'),/移動或刪除/);assert.throws(()=>applyStopTag(days,0,flight.id,'未提供的標籤'),/有效/);assert.throws(()=>applyStopTag(days,-1,flight.id,'咖啡'),/日期/);
});
test('card badge is a labelled native selector for editors and text for viewers, with escaped custom values',()=>{
 const stop={id:'a"b',name:'景點 <A>',tag:'自訂<名稱>'};const editor=renderCardTag(stop,2,{canEdit:true}),viewer=renderCardTag(stop,2);
 assert.match(editor,/select class="tag card-tag-selector"/);assert.match(editor,/data-tag-day="2"/);assert.match(editor,/data-tag-id="a&quot;b"/);assert.match(editor,/aria-label="景點 &lt;A&gt;：更改行程標籤"/);assert.match(editor,/value="自訂&lt;名稱&gt;" selected/);assert.equal(editor.includes('<button'),false);
 assert.equal(viewer,'<span class="tag">自訂&lt;名稱&gt;</span>');assert.equal(viewer.includes('select'),false);
});
test('concurrent edits to other fields merge with inline tags and differing tags require a choice',()=>{
 const base=[{date:'1/1',stops:[{id:'a',name:'原名稱',time:'09:00',tag:'景點',q:'台北車站',desc:'',duration:30,mode:'walking',createdBy:'owner@example.test'}]}];
 const mine=applyStopTag(base,0,'a','咖啡').days,theirs=structuredClone(base);theirs[0].stops[0].name='新名稱';theirs[0].stops[0].duration=60;
 let merged=mergeTrip(base,mine,theirs);assert.equal(merged.unresolved.length,0);assert.deepEqual(merged.days[0].stops[0],{...theirs[0].stops[0],tag:'咖啡'});
 theirs[0].stops[0].tag='購物';merged=mergeTrip(base,mine,theirs);assert.deepEqual(merged.unresolved.map(item=>item.key),['a:tag']);
 assert.equal(mergeTrip(base,mine,theirs,{'a:tag':'mine'}).days[0].stops[0].tag,'咖啡');assert.equal(mergeTrip(base,mine,theirs,{'a:tag':'theirs'}).days[0].stops[0].tag,'購物');
});
