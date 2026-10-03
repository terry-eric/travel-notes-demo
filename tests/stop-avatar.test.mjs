import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStopAvatar,stopAvatarLabel} from '../public/stop-avatar.js';

test('avatars are limited to stops explicitly marked as fixed time',()=>{
 for(const stop of [undefined,null,{}, {live:false,createdBy:'owner@example.test'},{live:'true',createdBy:'owner@example.test'},{live:1,createdBy:'owner@example.test'},{tag:'演唱會',createdBy:'owner@example.test'}]){assert.equal(renderStopAvatar(stop),'');assert.equal(stopAvatarLabel(stop),'');}
 assert.match(renderStopAvatar({live:true,createdBy:'owner@example.test'}),/class="stop-avatar"/);
});

test('containing cards can include the same plain creator label in their accessible name',()=>{
 assert.equal(stopAvatarLabel({live:true,createdBy:' OWNER@EXAMPLE.COM '}),'新增者：owner');
 assert.equal(stopAvatarLabel({live:true,editedBy:'editor@example.test'}),'固定時間行程，尚未記錄新增者');
 assert.equal(stopAvatarLabel({live:true,createdBy:"o'reilly&co@example.test"}),"新增者：o'reilly&co");
});

test('historical fixed stops show a generic silhouette without guessing the current editor',()=>{
 for(const creator of [undefined,null,'','not-an-email','a@example','a@@example.test','a\n@example.test',123,'a'.repeat(255)+'@example.test']){
  const html=renderStopAvatar({live:true,createdBy:creator,editedBy:'editor@example.test'});
  assert.match(html,/stop-avatar--unknown/);assert.match(html,/<svg /);
  assert.match(html,/aria-label="固定時間行程，尚未記錄新增者"/);assert.match(html,/title="固定時間行程，尚未記錄新增者"/);
  assert.doesNotMatch(html,/editor|stop-avatar-letter/);
 }
});

test('known creator initials and colours stay stable across devices, stops, and normalized email casing',()=>{
 const original={live:true,createdBy:'owner@example.com',name:'音樂會'},before=structuredClone(original),html=renderStopAvatar(original);
 assert.equal(html,renderStopAvatar({...original,id:'other-stop',name:'其他行程',createdBy:' OWNER@EXAMPLE.COM '}));
 assert.match(html,/aria-label="新增者：owner"/);assert.match(html,/title="新增者：owner"/);assert.match(html,/aria-hidden="true">O<\/span>/);
 assert.doesNotMatch(html,/gmail\.com/);assert.deepEqual(original,before);
});

test('HTML metacharacters in creator names are escaped in accessible labels and tooltips',()=>{
 const html=renderStopAvatar({live:true,createdBy:"o'reilly&co@example.test"});
 assert.match(html,/aria-label="新增者：o&#39;reilly&amp;co"/);assert.match(html,/title="新增者：o&#39;reilly&amp;co"/);
 const hostile=renderStopAvatar({live:true,createdBy:'a"&<script>@example.test'});
 assert.doesNotMatch(hostile,/<script>|onerror|onclick/);assert.match(hostile,/a&quot;&amp;&lt;script&gt;/);
});

test('the creator avatar is local and inert, without an image lookup or a new tap target',()=>{
 for(const stop of [{live:true},{live:true,createdBy:'owner@example.test',photoUrl:'https://untrusted.test/photo.png'}]){
  const html=renderStopAvatar(stop);
  assert.doesNotMatch(html,/<button|<a\b|<img|tabindex|\bsrc=|https?:|gravatar|data-created-by/i);
  assert.match(html,/role="img"/);
 }
});

test('generated letter colours retain readable contrast',()=>{
 const luminance=hex=>{
  const values=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*values[0]+.7152*values[1]+.0722*values[2];
 };
 const palettes=new Set();
 for(let index=0;index<30;index++){
  const html=renderStopAvatar({live:true,createdBy:`creator${index}@example.test`}),[,background,foreground]=html.match(/--stop-avatar-bg:(#[a-f0-9]{6});--stop-avatar-fg:(#[a-f0-9]{6})/);
  palettes.add(background);const values=[luminance(background),luminance(foreground)].sort((a,b)=>a-b);
  assert.ok((values[1]+.05)/(values[0]+.05)>=4.5);
 }
 assert.ok(palettes.size>1);
});
