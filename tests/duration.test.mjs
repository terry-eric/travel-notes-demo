import test from 'node:test';
import assert from 'node:assert/strict';
import {durationParts,durationMinutes,formatDuration} from '../public/duration.js';
test('hour/quarter-hour selections preserve minutes, unset values and earlier custom durations',()=>{
 for(const value of [0,15,30,45,60,75,90,105,180,1440,20]){
  const parts=durationParts(value);assert.equal(durationMinutes(String(parts.hours),String(parts.minutes)),value);
 }
 assert.equal(durationMinutes('','0'),undefined);
 assert.deepEqual(durationParts(undefined),{hours:'',minutes:0});
 assert.equal(formatDuration(90),'1 小時 30 分鐘');assert.equal(formatDuration(60),'1 小時');assert.equal(formatDuration(15),'15 分鐘');assert.equal(formatDuration(0),'0 分鐘');assert.equal(formatDuration(undefined),'未設定');
});
test('stay selection cannot exceed one day or use malformed hour/minute values',()=>{
 for(const [hours,minutes] of [['24','15'],['25','0'],['1','60'],['1.5','0'],['0','-15'],['bad','15']])assert.throws(()=>durationMinutes(hours,minutes));
});
