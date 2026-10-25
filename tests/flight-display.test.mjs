import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {flightLocalTimes,flightTripSchedule,flightTimezoneChange,previousFlightArrivalTimezone} from '../public/flights.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf('function renderTimelineRail('),end=app.indexOf('\nfunction openTimelineTime(',start);
assert.ok(start>=0&&end>start);
const render=new Function('flightLocalTimes','formatDuration','clockMinutes','esc','access','timelineEditorId','activeDay','flightTimezoneChange','previousFlightArrivalTimezone','days',app.slice(start,end)+';return renderTimelineRail;')(
 flightLocalTimes,n=>`${Math.floor(n/60)}h${n%60}m`,s=>/^\d{2}:\d{2}$/.test(s||'')?Number(s.slice(0,2))*60+Number(s.slice(3)):null,s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),{canEdit:true},'',0,flightTimezoneChange,previousFlightArrivalTimezone,[]);
const outbound={number:'SYNTHETIC',departureAirport:'TPE',arrivalAirport:'KIX',departureDateTime:'2026-12-26T07:40',arrivalDateTime:'2026-12-26T11:10',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo'};
const stop=flight=>({id:'synthetic-flight',name:'合成航班',kind:'flight',flight,live:true,time:flightTripSchedule(flight,'Asia/Tokyo').time,duration:flightLocalTimes(flight).duration});
test('reproduce07:40 ticket versus08:40 trip basis; display local endpoints without mutating schedule',()=>{
 const item=stop(outbound),before=JSON.stringify(item),html=render(item,0),times=flightLocalTimes(outbound);
 assert.equal(item.time,'08:40');assert.equal(times.departure.time,'07:40');assert.equal(times.arrival.time,'11:10');assert.equal(times.duration,150);
 assert.match(html,/起飛 07:40/);assert.match(html,/抵達 11:10/);assert.match(html,/UTC\+08:00/);assert.match(html,/UTC\+09:00/);assert.doesNotMatch(html,/>08:40</);assert.match(html,/data-details="0"/);assert.equal(JSON.stringify(item),before);
});
test('return uses Tokyo departure and Taipei arrival local clocks, not one globally fixed plus1',()=>{
 const f={...outbound,departureAirport:'KIX',arrivalAirport:'TPE',departureDateTime:'2026-12-26T18:00',arrivalDateTime:'2026-12-26T19:30',departureTimezone:'Asia/Tokyo',arrivalTimezone:'Asia/Taipei'},t=flightLocalTimes(f),html=render(stop(f),0);
 assert.equal(t.duration,150);assert.equal(t.arrival.offsetMinutes-t.departure.offsetMinutes,-60);assert.match(html,/起飛 18:00/);assert.match(html,/抵達 19:30/);
});
test('overnight retains both ticket dates even when trip timeline starts on following date',()=>{
 const f={...outbound,departureDateTime:'2026-12-26T23:40',arrivalDateTime:'2026-12-27T03:10'},html=render(stop(f),0);
 assert.equal(flightTripSchedule(f,'Asia/Tokyo').date,'2026-12-27');assert.equal(flightLocalTimes(f).duration,150);assert.match(html,/起飛 23:40/);assert.match(html,/2026\/12\/26/);assert.match(html,/2026\/12\/27/);assert.match(html,/抵達 03:10/);
});
test('event date controls DST offsets and localized timezone label',()=>{
 const winter={...outbound,departureTimezone:'America/Los_Angeles',departureDateTime:'2027-03-01T12:00',arrivalDateTime:'2027-03-02T17:00'},summer={...winter,departureDateTime:'2027-07-01T12:00',arrivalDateTime:'2027-07-02T16:00'};
 assert.equal(flightLocalTimes(winter).departure.offsetLabel,'UTC-08:00');assert.equal(flightLocalTimes(summer).departure.offsetLabel,'UTC-07:00');assert.notEqual(flightLocalTimes(winter).departure.zoneLabel,flightLocalTimes(summer).departure.zoneLabel);assert.equal(flightLocalTimes(winter).duration,720);assert.equal(flightLocalTimes(summer).duration,720);
});
test('date-line east/west dates are retained, without naive local-clock duration subtraction',()=>{
 const east={...outbound,arrivalTimezone:'America/Los_Angeles',departureDateTime:'2026-12-26T23:00',arrivalDateTime:'2026-12-26T19:00'},west={...outbound,departureTimezone:'America/Los_Angeles',arrivalTimezone:'Asia/Taipei',departureDateTime:'2026-12-26T23:00',arrivalDateTime:'2026-12-28T05:00'};
 assert.equal(flightLocalTimes(east).duration,720);assert.equal(flightLocalTimes(west).duration,840);assert.match(render(stop(west),0),/2026\/12\/28/);
});
test('invalid/unknown timezone shows confirmation needed instead of a guessed local clock',()=>{
 const html=render({...stop(outbound),flight:{...outbound,departureTimezone:'Unknown/Place'}},0);assert.match(html,/航班時間待確認/);assert.doesNotMatch(html,/08:40|UTC\+/);
});
test('ordinary stop rail remains unchanged',()=>{
 const item={id:'synthetic-place',name:'合成景點',time:'09:30',duration:60},before=JSON.stringify(item),html=render(item,0);
 assert.match(html,/>09:30</);assert.match(html,/離開 10:30/);assert.doesNotMatch(html,/起飛|UTC|當地/);assert.equal(JSON.stringify(item),before);
});

test('outbound and return notices use event offsets; repeated same-zone endpoints do not repeat changes',()=>{
 const go=flightLocalTimes(outbound),back=flightLocalTimes({...outbound,departureTimezone:'Asia/Tokyo',arrivalTimezone:'Asia/Taipei',departureDateTime:'2026-12-27T18:00',arrivalDateTime:'2026-12-27T19:30'});
 assert.equal(flightTimezoneChange(go.departure).kind,'initial');assert.equal(flightTimezoneChange(go.arrival,go.departure.timezone).deltaMinutes,60);
 assert.equal(flightTimezoneChange(back.departure,go.arrival.timezone),null);assert.equal(flightTimezoneChange(back.arrival,back.departure.timezone).deltaMinutes,-60);
 const html=render(stop(outbound),0);assert.equal((html.match(/data-flight-zone-change/g)||[]).length,1);assert.match(html,/快1小時/);
});
test('transition compares both zones at arrival instant across a DST change',()=>{
 const f={...outbound,departureTimezone:'America/New_York',arrivalTimezone:'Europe/London',departureDateTime:'2027-03-14T01:30',arrivalDateTime:'2027-03-14T09:30'},t=flightLocalTimes(f);
 assert.equal(t.departure.offsetMinutes,-300);assert.equal(flightTimezoneChange(t.arrival,t.departure.timezone).deltaMinutes,240);
});
test('flight history crosses day pages but never invents zones for ordinary stops',()=>{
 const d=[{stops:[{...stop(outbound)}, {id:'place',time:'12:00',tag:'住宿'}]},{stops:[{id:'unknown-place',time:'09:00'}, {...stop({...outbound,departureTimezone:'Asia/Tokyo',arrivalTimezone:'Asia/Taipei',departureDateTime:'2026-12-27T18:00',arrivalDateTime:'2026-12-27T19:30'})}]}];
 const before=JSON.stringify(d);assert.equal(previousFlightArrivalTimezone(d,1,1),'Asia/Tokyo');assert.equal(JSON.stringify(d),before);
 const unknown=[{stops:[{kind:'flight',flight:{departureTimezone:'Unknown'}}]},{stops:[]}];assert.equal(previousFlightArrivalTimezone(unknown,1,0),null);
 assert.match(app,/一般行程沿用旅行時區：[\s\S]*currentTrip\?\.timezone/);assert.doesNotMatch(app,/stop\.timezone\s*=/);
});
test('different timezone names with equal offsets still announce the region change',()=>{
 const t=flightLocalTimes({...outbound,departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Singapore',arrivalDateTime:'2026-12-26T10:10'});
 const change=flightTimezoneChange(t.arrival,t.departure.timezone);assert.equal(change.deltaMinutes,0);assert.match(change.message,/時差相同/);
});
