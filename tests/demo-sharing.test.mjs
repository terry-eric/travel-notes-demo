import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(demoMode){
 const elements=new Map(),calls=[];
 const node=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,required:true,textContent:'',innerHTML:'',listeners:new Map(),addEventListener(event,listener){this.listeners.set(event,listener);},removeAttribute(name){delete this[name];},async click(){return this.listeners.get('click')?.({preventDefault(){}});}});return elements.get(id);};
 const controls=['share-email','share-role','share-submit'].map(node),dialog=node('sharing-dialog'),form=node('share-form');
 form.querySelectorAll=()=>controls;
 dialog.querySelector=selector=>node(selector);
 dialog.querySelectorAll=()=>[...controls,node('sharing-close')];
 dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
 const source=fs.readFileSync('public/sharing.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function');
 const context={document:{getElementById:node},demoMode,apiPath:value=>value,tripApiPath:value=>value+'?trip=shared-fixture',selectedTripId:'shared-fixture',AbortSignal,
  fetch:async(url,options)=>{calls.push({url,options});return {owner:'owner@example.com',members:[]};},readCloudJson:async value=>value,
  location:{origin:'https://trip.example.com'},navigator:{clipboard:{writeText:async text=>calls.push({clipboard:text})}}};
 vm.createContext(context);vm.runInContext(source,context);return {sharing:context.initSharing(),node,controls,calls};
}

test('synthetic sharing explains browser-only data and cannot send invitations even with a forged share permission',async()=>{
 const h=harness(true);h.sharing.setSession({canEdit:true,canShare:true});
 assert.equal(h.node('sharing-open').hidden,false);assert.equal(h.node('share-form').hidden,true);
 for(const control of h.controls){assert.equal(control.disabled,true);assert.equal(control.required,undefined);}
 assert.equal(h.node('share-members').hidden,true);assert.equal(h.node('.share-footer').hidden,true);
 await h.node('sharing-open').click();assert.equal(h.node('sharing-dialog').open,true);
 assert.match(h.node('share-owner').textContent,/此瀏覽器/);assert.match(h.node('share-status').textContent,/正式部署/);
 assert.equal(h.node('share-form').listeners.has('submit'),false);assert.equal(h.node('share-copy').listeners.has('click'),false);assert.deepEqual(h.calls,[]);
 await h.node('sharing-close').click();assert.equal(h.node('sharing-dialog').open,false);
 h.sharing.setSession({canEdit:false,canShare:true});assert.equal(h.node('sharing-open').hidden,true);
});

test('production sharing still loads only the selected trip for a live owner and blocks a viewer',async()=>{
 const h=harness(false);h.sharing.setSession({canEdit:true,canShare:false});
 assert.equal(h.node('sharing-open').hidden,true);await h.node('sharing-open').click();assert.deepEqual(h.calls,[]);
 h.sharing.setSession({canEdit:true,canShare:true});await h.node('sharing-open').click();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/shares?trip=shared-fixture');
 assert.equal(h.node('sharing-dialog').open,true);assert.equal(h.node('share-owner').textContent,'owner@example.com · 擁有者');
 assert.equal(h.node('share-form').listeners.has('submit'),true);assert.equal(h.node('share-copy').listeners.has('click'),true);
 assert.equal(h.node('share-form').hidden,false);
});
