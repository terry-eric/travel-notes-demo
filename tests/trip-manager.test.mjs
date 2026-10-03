import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTravelDate,validateNewTrip,tripDateLabel,tripRoleLabel,tripMutation,updateCurrentTripRecord,groupTripsByMonth} from '../public/trip-manager.js';

test('new trips validate inclusive dates and leap years without local timezone drift',()=>{
 assert.equal(parseTravelDate('2028-02-29'),Date.UTC(2028,1,29));
 for(const date of ['2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-1-03','0099-01-01','not-a-date',undefined])assert.equal(parseTravelDate(date),null);
 assert.deepEqual(validateNewTrip({title:'  春日旅行  ',startDate:'2028-02-29',endDate:'2028-02-29'}),{title:'春日旅行',startDate:'2028-02-29',endDate:'2028-02-29'});
 assert.equal(validateNewTrip({title:'兩個月',startDate:'2026-10-01',endDate:'2026-11-29'}).endDate,'2026-11-29');
 assert.throws(()=>validateNewTrip({title:'太久',startDate:'2026-10-01',endDate:'2026-11-30'}),/1–60 天/);
 assert.throws(()=>validateNewTrip({title:'倒置',startDate:'2026-10-02',endDate:'2026-10-01'}),/早於/);
 for(const title of ['', '   ', '旅'.repeat(121),null])assert.throws(()=>validateNewTrip({title,startDate:'2026-10-01',endDate:'2026-10-01'}),/旅行名稱/);
 assert.equal(validateNewTrip({title:'日本',startDate:'2026-10-01',endDate:'2026-10-01',timezone:'Asia/Tokyo'}).timezone,'Asia/Tokyo');
 assert.throws(()=>validateNewTrip({title:'日本',startDate:'2026-10-01',endDate:'2026-10-01',timezone:'Made/Up'}),/時區/);
});

test('library labels distinguish owner and invited roles and show a full date range',()=>{
 assert.equal(tripRoleLabel('owner'),'我的旅行');assert.equal(tripRoleLabel('editor'),'受邀 · 可編輯');assert.equal(tripRoleLabel('viewer'),'受邀 · 僅查看');
 assert.equal(tripDateLabel({startDate:'2026-12-31',endDate:'2027-01-02'}),'2026/12/31 — 2027/01/02 · 3 天');
 assert.equal(tripDateLabel({startDate:'bad',endDate:'2027-01-02'}),'日期尚未設定');
});

test('trip library groups by departure year and month in chronological order without changing the catalogue',()=>{
 const trips=[
  {id:'leap',title:'Leap',startDate:'2028-02-29'},
  {id:'cross-year',title:'New year',startDate:'2026-12-31',endDate:'2027-01-02'},
  {id:'nov',title:'Hokkaido',startDate:'2026-11-11'},
  {id:'early-feb',title:'February',startDate:'2028-02-01'},
  {id:'jan',title:'January',startDate:'2027-01-02'},
  {id:'oct-b',title:'B',startDate:'2026-10-03'},
  {id:'invalid',title:'Missing',startDate:'2026-02-29'},
  {id:'oct-a',title:'A',startDate:'2026-10-03'},
 ];
 const original=structuredClone(trips),groups=groupTripsByMonth(trips);
 assert.deepEqual(groups.map(group=>group.key),['2026-10','2026-11','2026-12','2027-01','2028-02','undated']);
 assert.deepEqual(groups.map(group=>group.label),['2026 年 10 月','2026 年 11 月','2026 年 12 月','2027 年 1 月','2028 年 2 月','日期尚未設定']);
 assert.deepEqual(groups.flatMap(group=>group.trips.map(trip=>trip.id)),['oct-a','oct-b','nov','cross-year','jan','early-feb','leap','invalid']);
 assert.deepEqual(trips,original);
 assert.deepEqual(groupTripsByMonth([]),[]);
});

test('deletion and restoration require an owner and the exact reviewed revision',()=>{
 const trip={id:'legacy-hokkaido-2026',role:'owner',revision:24};
 assert.deepEqual(tripMutation(trip),{id:trip.id,revision:24});
 assert.deepEqual(tripMutation(trip,'restore'),{id:trip.id,revision:24,action:'restore'});
 for(const role of ['editor','viewer',undefined])assert.throws(()=>tripMutation({...trip,role}),/擁有者/);
 for(const revision of [undefined,-1,1.5,'24',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>tripMutation({...trip,revision}),/版本不完整/);
 assert.throws(()=>tripMutation({...trip,id:'bad id'}),/版本不完整/);
 assert.throws(()=>tripMutation(trip,'purge'),/操作不正確/);
});

test('authoritative selected-trip revisions refresh the card without downgrading newer catalogue data or permissions',()=>{
 const record={id:'travel-1',title:'巴黎旅行',role:'editor',canShare:false,revision:8};
 assert.equal(updateCurrentTripRecord(record,{id:'travel-1',title:'舊名稱',revision:7}),record);
 assert.equal(updateCurrentTripRecord(record,{id:'travel-2',title:'其他旅行',revision:9}),record);
 assert.equal(updateCurrentTripRecord(record,{id:'travel-1',title:'沒有版本'}),record);
 const next=updateCurrentTripRecord(record,{id:'travel-1',title:'巴黎跨年',revision:9,role:'owner',canShare:true});
 assert.equal(next.title,'巴黎跨年');assert.equal(next.revision,9);assert.equal(next.role,'editor');assert.equal(next.canShare,false);
 assert.deepEqual(tripMutation({...next,role:'owner'}),{id:'travel-1',revision:9});
 assert.equal(record.revision,8);
});
