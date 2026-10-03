import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTrip} from '../public/merge.js';
import {createTravelCache} from '../public/cache.js';
import {createDraftStore} from '../public/drafts.js';

const copy=structuredClone;
const initial=()=>[{date:'1/1',stops:[{id:'fixed-stop',name:'固定預約',time:'10:00',q:'台北車站',live:true,createdBy:'alice@example.com'}]},{date:'1/2',stops:[]}];
const stop=result=>result.days.flatMap(day=>day.stops).find(item=>item.id==='fixed-stop');
function memory(){const values=new Map();return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const snapshot=()=>({trip:{id:'attribution-trip',title:'共同旅程',startDate:'2028-01-01',endDate:'2028-01-02',timezone:'Asia/Taipei'},days:initial(),revision:4});

test('cloud creator survives ordinary merges, moves and local spoofing without becoming an editable conflict',()=>{
 const base=initial(),mine=copy(base),theirs=copy(base);
 mine[1].stops.push(mine[0].stops.pop());mine[1].stops[0].desc='我的備註';mine[1].stops[0].createdBy='spoof@example.com';
 theirs[0].stops[0].duration=60;theirs[0].stops[0].createdBy=' Alice@Example.com ';
 const result=mergeTrip(base,mine,theirs);
 assert.equal(result.unresolved.length,0);assert.equal(result.days[0].stops.length,0);
 assert.equal(stop(result).createdBy,'alice@example.com');assert.equal(stop(result).desc,'我的備註');assert.equal(stop(result).duration,60);
 assert.equal(mine[1].stops[0].createdBy,'spoof@example.com');
 delete theirs[0].stops[0].createdBy;
 assert.equal(stop(mergeTrip(base,mine,theirs)).createdBy,undefined);
});

test('creator-only differences do not turn an unchanged deletion into a presence conflict',()=>{
 const base=initial(),mine=copy(base),theirs=copy(base);delete base[0].stops[0].createdBy;
 mine[0].stops=[];
 let result=mergeTrip(base,mine,theirs);
 assert.equal(result.conflicts.length,0);assert.equal(stop(result),undefined);
 const local=copy(base),deleted=copy(base);local[0].stops[0].createdBy='spoof@example.com';deleted[0].stops=[];
 result=mergeTrip(base,local,deleted);
 assert.equal(result.conflicts.length,0);assert.equal(stop(result),undefined);
});

test('retaining a genuinely edited deleted stop preserves its known base creator, never a draft replacement',()=>{
 const base=initial(),mine=copy(base),theirs=copy(base);
 mine[0].stops[0].name='我的預約修改';mine[0].stops[0].createdBy='spoof@example.com';theirs[0].stops=[];
 const pending=mergeTrip(base,mine,theirs);assert.equal(pending.unresolved.length,1);assert.equal(pending.unresolved[0].type,'presence');
 const retained=mergeTrip(base,mine,theirs,{'presence:fixed-stop':'mine'});
 assert.equal(retained.unresolved.length,0);assert.equal(stop(retained).name,'我的預約修改');assert.equal(stop(retained).createdBy,'alice@example.com');
 delete base[0].stops[0].createdBy;
 assert.equal(stop(mergeTrip(base,mine,theirs,{'presence:fixed-stop':'mine'})).createdBy,undefined);
});

test('new local stops remain unattributed until saved while cloud additions keep their authenticated creator',()=>{
 const base=initial(),mine=copy(base),theirs=copy(base);
 mine[0].stops.push({id:'local-new',name:'我的新增',createdBy:'spoof@example.com'});
 theirs[0].stops.push({id:'remote-new',name:'朋友新增',createdBy:'bob@example.com'});
 const result=mergeTrip(base,mine,theirs);assert.equal(result.conflicts.length,0);
 assert.equal(result.days[0].stops.find(item=>item.id==='local-new').createdBy,undefined);
 assert.equal(result.days[0].stops.find(item=>item.id==='remote-new').createdBy,'bob@example.com');
});

test('account-scoped cache retains normalized creators for fixed and ordinary stops but strips credentials and permissions',()=>{
 const storage=memory(),cache=createTravelCache({storage,appBase:'/trip',email:'viewer@example.com'}),data=snapshot();
 data.days[0].stops[0].createdBy=' Alice@Example.com ';
 Object.assign(data.days[0].stops[0],{canEdit:true,token:'private-secret',avatarUrl:'https://evil.example/avatar'});
 data.days[1].stops.push({id:'ordinary',name:'一般景點',createdBy:'bob@example.com'});
 assert.equal(cache.writeTrip(data.trip.id,data),true);
 const loaded=cache.readTrip(data.trip.id);assert.equal(loaded.days[0].stops[0].createdBy,'alice@example.com');
 assert.equal(loaded.days[1].stops[0].createdBy,'bob@example.com');assert.equal(loaded.days[1].stops[0].live,undefined);
 for(const key of ['canEdit','token','avatarUrl'])assert.equal(loaded.days[0].stops[0][key],undefined);
 const other=createTravelCache({storage,appBase:'/trip',email:'other@example.com'});assert.equal(other.readTrip(data.trip.id),null);
});

test('malformed or unknown cache creators are omitted without discarding the itinerary',()=>{
 const storage=memory(),cache=createTravelCache({storage,appBase:'/trip',email:'viewer@example.com'});
 for(const value of [undefined,null,{},true,1,'','invalid','a@@example.com','a b@example.com','a'.repeat(255)+'@example.com']){
  const data=snapshot();data.days[0].stops[0].createdBy=value;
  assert.equal(cache.writeTrip(data.trip.id,data),true);assert.equal(cache.readTrip(data.trip.id).days[0].stops[0].createdBy,undefined);
 }
 const key=cache.accountPrefix+'trip:attribution-trip',stored=JSON.parse(storage.getItem(key));
 stored.data.days[0].stops[0].createdBy=' BOB@Example.com ';storage.setItem(key,JSON.stringify(stored));
 assert.equal(cache.readTrip('attribution-trip').days[0].stops[0].createdBy,'bob@example.com');
});

test('draft serialization preserves known creators and unknown legacy stops for subsequent cloud merging',()=>{
 const storage=memory(),draft=createDraftStore(storage,'scoped-draft'),base=initial();
 base[1].stops.push({id:'legacy-stop',name:'舊行程'});
 assert.equal(draft.write({editor:{scope:{days:base,revision:4}},pending:{base,days:copy(base)}}),true);
 const recovered=draft.read();assert.equal(recovered.editor.scope.days[0].stops[0].createdBy,'alice@example.com');
 assert.equal(recovered.pending.days[1].stops[0].createdBy,undefined);
 assert.equal(stop(mergeTrip(recovered.pending.base,recovered.pending.days,base)).createdBy,'alice@example.com');
});
