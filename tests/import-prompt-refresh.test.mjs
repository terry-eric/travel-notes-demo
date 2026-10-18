import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshGptPrompt} from '../public/import.js';
import {buildGptPrompt} from '../public/gpt-import.js';
const trip={title:'未來的旅行',timezone:'Asia/Tokyo'};
const days=[{isoDate:'2027-04-12',date:'4/12',stops:[{name:'已有早餐',q:'Tokyo Japan',time:'09:00',duration:30}]}];

test('refresh replaces stale context and keeps multiline requirements literally',()=>{
 const requirement='想去海邊\n$&、$`、$\' 不要改寫\n保留我的偏好';
 const original=buildGptPrompt(days,trip).replace('（在此填入目的地、想去的地方、餐廳、每天開始時間及其他偏好）',()=>requirement);
 const latest=structuredClone(days);latest[0].stops[0].name='同行者改過的早餐';latest[0].stops.push({name:'已預約晚餐',time:'19:00',q:'Tokyo Japan',duration:60,live:true});
 const refreshed=refreshGptPrompt(original,latest,trip);
 assert.ok(refreshed.includes(requirement));assert.match(refreshed,/同行者改過的早餐/);assert.match(refreshed,/已預約晚餐/);assert.doesNotMatch(refreshed,/已有早餐/);
 assert.deepEqual(days[0].stops.length,1);
});
