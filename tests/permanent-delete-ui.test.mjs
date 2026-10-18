import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {withoutDeletedStops,sanitizePermanentDraft} from '../public/drafts.js';

const fixture=()=>[{title:'第一天',stops:[{id:'removed-id',name:'被刪除的名稱',desc:'removed private fixture',time:'10:00'},{id:'keep-id',name:'保留行程',desc:'original',time:'11:00',flight:{unknownPrivateFixture:{keep:true}}}]}];
const snapshot=(days=fixture(),revision=2)=>({trip:{id:'trip-ui',title:'測試旅行'},days,previous:structuredClone(days),revision,role:'owner'});
const plain=value=>JSON.parse(JSON.stringify(value));
const source=fs.readFileSync('public/app.js','utf8');
function section(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}
const code=[
 section('function currentDraft(){','function restoreStayInputs(){'),
 section('function stagePermanentRecovery(','function openEditor('),
 section('async function remove(day,index){','async function move('),
].join('\n');

function harness(queue=[]){
 const nodes=new Map(),events={requests:[],notices:[],saved:[],cache:[],merged:0,confirm:0,refresh:[]};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{open:false,hidden:false,textContent:'',close(){this.open=false;}});return nodes.get(id);};
 const initial=snapshot();let uuid=0,stored=null;
 const ctx={console,structuredClone,withoutDeletedStops,sanitizePermanentDraft,$,
  tripId:'trip-ui',currentTrip:initial.trip,days:initial.days,previous:initial.previous,revision:2,ready:true,busy:false,identityEpoch:0,permissionEpoch:0,
  access:{canEdit:true,role:'owner'},pending:null,conflict:false,editorScope:null,editorDirty:false,editorReadOnly:false,editing:null,newStopId:'new-id',
  transportDirty:false,transportScope:null,transportDraft:null,transportEditorId:'',timelineEditorId:'',stayDraft:null,dayNameDraft:null,tagDraft:null,recovery:null,activeDay:0,activeStop:0,authExpired:false,
  crypto:{randomUUID:()=>`mutation-${++uuid}`},clone:structuredClone,clearStaleTravel:structuredClone,
  canChange:()=>ctx.access.canEdit&&ctx.ready&&!ctx.busy&&!ctx.pending&&!ctx.conflict&&!ctx.recovery,
  scopeSnapshot:()=>({tripId:ctx.tripId,trip:ctx.currentTrip,days:structuredClone(ctx.days),revision:ctx.revision}),
  window:{confirm:message=>{events.confirm++;events.confirmMessage=message;return true;}},
  importer:{dirty:false,snapshot:()=>null,close(){this.dirty=false;$('import-dialog').open=false;}},
  editorFields:()=>({name:'保留的未儲存編輯',hours:'1',minutes:'0'}),
  draftStore:{write(value){stored=structuredClone(value);events.saved.push(stored);return true;},clear(){stored=null;events.saved.push(null);return true;}},
  conflictUI:{close:()=>{$('conflict-dialog').open=false;},message(){},show(){}},
  travelCache:{deleteTrip:id=>events.cache.push(['delete',id]),clearCatalogue(){}},
  cacheConfirmed:data=>events.cache.push(['confirmed',structuredClone(data)]),
  applyTripRole:role=>{ctx.access.role=role;ctx.access.canEdit=role!=='viewer';},
  renderTripMeta(){},refresh:(day,stop)=>events.refresh.push([day,stop]),lock(){},notice:value=>events.notices.push(value),
  assertImportedSchedule(){},showConflicts(){},mergedSchedule:value=>({days:value,reason:''}),
  mergeTrip(){events.merged++;throw Error('permanent handling must not merge');},
  async fetchJson(options){events.requests.push(options?JSON.parse(options.body):null);const result=queue.shift();if(typeof result==='function')return result(options);if(result instanceof Error)throw result;return structuredClone(result);},
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,events,$,stored:()=>stored};
}

test('deletion asks irreversible confirmation and submits the reviewed stable ID/revision, independent of live indices',async()=>{
 const latest=fixture();latest[0].stops.reverse();
 const h=harness([{...snapshot([latest[0]],5),permanent:true,deletedStopId:'removed-id'}]);
 h.$('editor').open=true;h.ctx.editorScope={tripId:'trip-ui',days:fixture(),revision:2};h.ctx.editing={day:0,index:0,id:'removed-id'};h.ctx.days=latest;h.ctx.revision=4;
 // A successful server acknowledgement must describe the item as absent.
 const deleted=latest.map(day=>({...day,stops:day.stops.filter(stop=>stop.id!=='removed-id')}));
 h.ctx.fetchJson=async options=>{h.events.requests.push(JSON.parse(options.body));return {...snapshot(deleted,5),permanent:true,deletedStopId:'removed-id'};};
 assert.equal(await h.ctx.remove(0,0),true);
 assert.match(h.events.confirmMessage,/永久刪除.*無法復原/);assert.equal(h.events.confirm,1);
 assert.deepEqual(plain(h.events.requests[0]),{permanent:true,deleteStopId:'removed-id',revision:2,mutationId:'mutation-1'});
 assert.equal(h.events.merged,0);assert.equal(h.ctx.previous[0].stops.some(stop=>stop.id==='removed-id'),false);assert.equal(h.stored(),null);
});

test('cancelled confirmation never queues or sends a deletion',async()=>{
 const h=harness();h.ctx.window.confirm=message=>{h.events.confirmMessage=message;return false;};
 const before=structuredClone(h.ctx.days);assert.equal(await h.ctx.remove(0,0),false);
 assert.deepEqual(h.ctx.days,before);assert.equal(h.ctx.pending,null);assert.equal(h.events.requests.length,0);
});

test('a lost deletion reply retains the same mutation and ID for retry, even after indices change',async()=>{
 const offline=Error('lost reply');offline.status=503;
 const deleted=fixture();deleted[0].stops.shift();deleted[0].stops.push({id:'other-new-id',name:'同行者新站'});
 const h=harness([offline,{...snapshot(deleted,7),permanent:true,deletedStopId:'removed-id'}]);
 assert.equal(await h.ctx.remove(0,0),false);assert.equal(h.ctx.pending.deleteStopId,'removed-id');assert.equal(h.$('retry').textContent,'重試刪除');
 h.ctx.days[0].stops.reverse();assert.equal(await h.ctx.commit(null,null,null,null,true),true);
 assert.deepEqual(h.events.requests[1],h.events.requests[0]);assert.equal(h.events.confirm,1);assert.equal(h.events.merged,0);
 assert.deepEqual(h.ctx.days[0].stops.map(stop=>stop.id),['keep-id','other-new-id']);assert.equal(h.ctx.pending,null);assert.equal(h.stored(),null);
});

test('an incomplete acknowledgement or one still containing the target cannot clear the pending deletion or replace the snapshot',async()=>{
 for(const result of [{permanent:true,deletedStopId:'removed-id',trip:{id:'trip-ui'}},{...snapshot(fixture(),3),permanent:true,deletedStopId:'removed-id'}]){
  const h=harness([result]),before=structuredClone(h.ctx.days);assert.equal(await h.ctx.remove(0,0),false);
  assert.equal(h.ctx.pending.deleteStopId,'removed-id');assert.deepEqual(h.ctx.days,before);assert.equal(h.$('retry').textContent,'重試刪除');assert.equal(h.events.cache.length,0);
 }
});

test('deletion CAS conflict loads current content and cancels the intent without merging or automatically confirming again',async()=>{
 const conflict=Error('updated');conflict.status=409;const latest=fixture();latest[0].stops[0].name='同行者已修改';
 const h=harness([conflict,snapshot(latest,3)]);assert.equal(await h.ctx.remove(0,0),false);
 assert.equal(h.events.requests.length,2);assert.equal(h.events.requests[1],null);assert.equal(h.events.merged,0);
 assert.equal(h.ctx.pending,null);assert.equal(h.ctx.conflict,false);assert.equal(h.ctx.days[0].stops[0].name,'同行者已修改');assert.equal(h.ctx.revision,3);
 assert.match(h.events.notices.at(-1),/重新查看最新內容.*再確認永久刪除/);
});

test('permanent-ID 409 redacts old undo/drafts/pending while keeping unrelated edits for manual review',async()=>{
 const gone=Error('permanent');gone.status=409;gone.data={code:'PERMANENT_STOP_DELETED',deletedStopIds:['removed-id']};
 const cloud=fixture();cloud[0].stops.shift();cloud[0].stops[0].desc='remote change';
 const h=harness([gone,snapshot(cloud,3)]),mine=fixture();mine[0].stops[1].desc='my unrelated change';
 h.$('editor').open=true;h.ctx.editorDirty=true;h.ctx.editorScope={tripId:'trip-ui',days:fixture(),revision:2};h.ctx.editing={day:0,index:1,id:'keep-id'};
 assert.equal(await h.ctx.commit(mine,'normal save'),false);assert.equal(h.events.merged,0);assert.equal(h.events.requests.length,2);
 assert.equal(h.ctx.pending,null);assert.equal(h.ctx.conflict,false);assert.equal(h.$('editor').open,false);assert.equal(h.$('draft-recovery').hidden,false);
 const draft=h.stored();assert.ok(draft.pending);assert.equal(draft.pending.days[0].stops[0].desc,'my unrelated change');assert.equal(draft.editor.fields.name,'保留的未儲存編輯');assert.equal(draft.editor.editing.index,0);
 assert.doesNotMatch(JSON.stringify(draft),/removed-id|被刪除的名稱|removed private fixture/);assert.doesNotMatch(JSON.stringify(h.ctx.previous),/removed-id/);
 assert.equal(h.ctx.days[0].stops[0].desc,'remote change');assert.match(h.events.notices.at(-1),/沒有自動合併.*其他未儲存修改保留/);
});

test('permanent-ID cleanup happens before a failed refresh and cannot leave an automatic retry with the old item',async()=>{
 const gone=Error('permanent');gone.status=409;gone.data={code:'PERMANENT_STOP_DELETED',deletedStopIds:['removed-id']};const offline=Error('offline');offline.status=503;
 const h=harness([gone,offline]),mine=fixture();mine[0].stops[1].desc='keep local change';
 assert.equal(await h.ctx.commit(mine,'normal save'),false);assert.equal(h.ctx.pending,null);assert.equal(h.events.merged,0);
 assert.doesNotMatch(JSON.stringify(h.ctx.days),/removed-id/);assert.doesNotMatch(JSON.stringify(h.ctx.previous),/removed-id/);assert.doesNotMatch(JSON.stringify(h.stored()),/removed-id/);
 assert.equal(h.stored().pending.days[0].stops[0].desc,'keep local change');assert.equal(h.$('retry').textContent,'重新載入');
});

test('redaction handles all known recovery scopes without mutating surviving flight fields or the original draft',()=>{
 const days=fixture(),scope={tripId:'trip-ui',days,revision:2};
 const value={tripId:'trip-ui',editor:{scope,editing:{id:'keep-id',day:0,index:1},fields:{name:'typed'}},transport:{scope,id:'keep-id',minutes:'10'},stay:{scope,values:{'removed-id':{hours:1},'keep-id':{hours:2}}},tag:{scope,id:'removed-id'},dayName:{scope,day:0,value:'new day'},pending:{base:days,days,previous:days,merge:{remote:snapshot(),choices:{gone:'mine'}},message:'被刪除的名稱',importGuard:{rows:[{id:'removed-id'},{id:'import-keep'}]}},imported:{scope,rows:[{id:'removed-id'},{id:'import-keep'}],prompt:'被刪除的名稱',text:'{"id":"removed-id"}'}};
 const before=structuredClone(value),safe=sanitizePermanentDraft(value,['removed-id']);assert.deepEqual(value,before);
 assert.equal(safe.editor.editing.index,0);assert.equal(safe.tag,undefined);assert.deepEqual(Object.keys(safe.stay.values),['keep-id']);assert.equal(safe.pending.merge,undefined);assert.equal(safe.imported.prompt,undefined);assert.equal(safe.imported.text,'');
 assert.doesNotMatch(JSON.stringify(safe),/removed-id|被刪除的名稱|removed private fixture/);assert.deepEqual(safe.pending.days[0].stops[0].flight,days[0].stops[1].flight);
 assert.equal(sanitizePermanentDraft({tripId:'trip-ui',editor:{scope,editing:{id:'removed-id',day:0,index:0}}},['removed-id']),null);
});
