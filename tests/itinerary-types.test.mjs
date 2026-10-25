import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {itineraryTypeOptions,itineraryTypeValue,resolveItineraryType,renderCardTag,tagCategory} from '../public/tags.js';
import {validateDays} from '../server/api.js';
const labels=['景點','用餐','咖啡','購物','交通','住宿','演唱會','自由時間','其他'];
const trip={id:'synthetic',startDate:'2027-04-12',endDate:'2027-04-12',timezone:'Asia/Tokyo'};
function save(stop){return validateDays([{stops:[stop]}],trip)[0].stops[0];}
test('all nine categories save, JSON-reopen and card-render as existing place+tag',()=>{
 for(const label of labels){const type=resolveItineraryType('tag:'+label),value=save({id:'test-'+label,name:'合成-'+label,time:'09:00',tag:type.tag,q:'合成位置',mode:'walking',kind:type.kind});const reopened=JSON.parse(JSON.stringify(value));assert.equal(reopened.tag,label);assert.equal(itineraryTypeValue(reopened),'tag:'+label);assert.notEqual(reopened.kind,'flight');assert.match(renderCardTag(reopened,0),new RegExp(label));assert.equal(tagCategory(reopened.tag),tagCategory(label));}
});
test('custom labels, legacy general and another stop stay intact across classification choices',()=>{
 const old={id:'custom',name:'合成自訂',tag:'私藏散步',time:'11:00',q:'合成位置',mode:'walking'},before=JSON.stringify(old),options=itineraryTypeOptions([old.tag,'休息',old.tag]);
 assert.equal(options.filter(option=>option.value==='tag:私藏散步').length,1);assert.equal(itineraryTypeValue(old),'tag:私藏散步');assert.equal(resolveItineraryType('place',old.tag).tag,old.tag);
 for(const label of labels)resolveItineraryType('tag:'+label,old.tag);
 assert.equal(JSON.stringify(old),before);assert.equal(save(old).tag,old.tag);assert.equal(itineraryTypeValue({}), 'place');
});
test('flight remains the only special kind and ordinary conversion drops only its flight structure',()=>{
 const flight={id:'flight',name:'合成航班',time:'08:40',kind:'flight',tag:'機票',mode:'walking',flight:{departureAirport:'TPE',arrivalAirport:'KIX',departureDateTime:'2027-04-12T07:40',arrivalDateTime:'2027-04-12T11:10',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo'}};
 const saved=save(flight);assert.equal(saved.kind,'flight');assert.equal(saved.duration,150);assert.equal(itineraryTypeValue(saved),'flight');
 const ordinary={...saved,tag:resolveItineraryType('tag:住宿',saved.tag).tag};delete ordinary.kind;delete ordinary.flight;assert.equal(save(ordinary).tag,'住宿');assert.equal(save(ordinary).kind,undefined);
});
test('invalid classifications reject while hostile existing labels are escaped at render',()=>{
 assert.throws(()=>resolveItineraryType('hotel'));assert.throws(()=>resolveItineraryType('tag:'));assert.throws(()=>resolveItineraryType('tag:'+'x'.repeat(31)));assert.throws(()=>resolveItineraryType('tag:bad\nlabel'));
 assert.doesNotMatch(renderCardTag({id:'x',name:'QA',tag:'<img src=x onerror=x>'},0),/<img/);
});
test('real editor preserves place fields between category choices and only clears them on flight boundary',()=>{
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const start=app.indexOf("$('field-kind').addEventListener('change',"),end=app.indexOf('\n});',start);assert.ok(start>=0&&end>start);
 const source=app.slice(start,end+4),fields=Object.fromEntries(['kind','coordinates','mapUrl','q','name'].map(key=>[key,{value:'',dataset:{}}]));fields.kind.dataset.previousKind='place';fields.kind.value='tag:咖啡';fields.coordinates.value='35,135';fields.mapUrl.value='https://maps.google.com/?q=test';fields.q.value='合成地點';fields.name.value='保持名稱';let handler;
 const dollar=id=>{const field=fields[id.slice(6)];return field?{...field,addEventListener(type,fn){handler=fn;}}:null;};
 // Use stable field objects to exercise the actual change callback.
 fields.kind.addEventListener=(type,fn)=>handler=fn;
 const get=id=>fields[id.slice(6)];let updates=0;
 new Function('$','updateFlightEditor','persistDraft','renderEditorGeolocation','readFlightFields','let editorPlaceTypeFields=null,editorDirty=false;'+source)(get,()=>updates++,()=>{},()=>{},()=>({departureAirport:'TPE'}));
 handler();assert.equal(fields.q.value,'合成地點');assert.equal(fields.coordinates.value,'35,135');fields.kind.value='flight';handler();assert.equal(fields.q.value,'TPE');assert.equal(fields.coordinates.value,'');fields.kind.value='tag:住宿';handler();assert.equal(fields.q.value,'合成地點');assert.equal(fields.coordinates.value,'35,135');assert.equal(fields.name.value,'保持名稱');assert.equal(updates,3);
});

test('place-flight draft serializes its backup and a new context restores before switching back',()=>{
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const serializer=app.slice(app.indexOf('function editorFields(){'),app.indexOf('\n',app.indexOf('function editorFields(){')));
 const helper=app.slice(app.indexOf('function restorePlaceTypeFields('),app.indexOf('\nlet editorPlaceTypeFields=',app.indexOf('function restorePlaceTypeFields(')));
 const start=app.indexOf("$('field-kind').addEventListener('change',"),end=app.indexOf('\n});',start),callback=app.slice(start,end+4);
 function context(saved=null){const fields=Object.fromEntries(['name','time','day','order','tag','q','mode','mapUrl','desc','kind','coordinates','fixed'].map(key=>[key,{value:'',dataset:{},checked:false}]));fields.kind.value='tag:咖啡';fields.kind.dataset.previousKind='place';fields.q.value='合成原位置';fields.coordinates.value='35,135';fields.mapUrl.value='https://maps.google.com/?q=35,135';fields.tag.value='咖啡';fields.name.value='合成草稿';let handler;fields.kind.addEventListener=(event,fn)=>handler=fn;
 const get=id=>id==='editor-form'?{elements:{durationHours:{value:'1'},durationMinutes:{value:'0'}}}:fields[id.slice(6)];
 const api=new Function('$','updateFlightEditor','persistDraft','renderEditorGeolocation','readFlightFields',helper+'let editorPlaceTypeFields=null,editorDirty=false;'+serializer+callback+'return {serialize:editorFields,restore:function(draft){editorPlaceTypeFields=restorePlaceTypeFields(draft.fields.placeTypeFields);},switch:function(){return null;}};')(get,()=>{},()=>{},()=>{},()=>({departureAirport:'SYNTHETIC-AIRPORT'}));
 if(saved){for(const key of ['name','time','day','order','tag','q','mode','mapUrl','desc','kind','coordinates'])fields[key].value=saved.fields[key]??'';fields.kind.dataset.previousKind=fields.kind.value==='flight'?'flight':'place';api.restore(saved);}
 return {fields,change:()=>handler(),serialize:api.serialize};}
 const first=context();first.fields.kind.value='flight';first.change();assert.equal(first.fields.q.value,'SYNTHETIC-AIRPORT');const saved=JSON.parse(JSON.stringify({fields:first.serialize()}));assert.equal(saved.fields.placeTypeFields.q,'合成原位置');
 const restored=context(saved);restored.fields.kind.value='tag:住宿';restored.change();assert.equal(restored.fields.q.value,'合成原位置');assert.equal(restored.fields.coordinates.value,'35,135');assert.equal(restored.fields.mapUrl.value,'https://maps.google.com/?q=35,135');assert.equal(restored.fields.name.value,'合成草稿');
 assert.match(app,/populateEditorType\([\s\S]*?editorPlaceTypeFields=restorePlaceTypeFields\(draft\.fields\.placeTypeFields\)/);
});
test('legacy/malformed place backup restores safely, accepting only known bounded fields',()=>{
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),helper=app.slice(app.indexOf('function restorePlaceTypeFields('),app.indexOf('\nlet editorPlaceTypeFields=',app.indexOf('function restorePlaceTypeFields('))),restore=new Function(helper+'return restorePlaceTypeFields;')();
 assert.equal(restore(undefined),null);assert.equal(restore([]),null);assert.equal(restore({q:'x'}),null);assert.equal(restore({q:'x'.repeat(301),coordinates:'',mapUrl:''}),null);assert.deepEqual(restore({q:'QA',coordinates:'35,135',mapUrl:'',name:'do-not-copy',kind:'flight'}),{coordinates:'35,135',mapUrl:'',q:'QA'});
});
