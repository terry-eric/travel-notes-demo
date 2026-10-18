import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewImport} from '../public/import-review.js';

const stop=(name,time,duration,extra={})=>({name,time,q:name,...(duration===undefined?{}:{duration}),...extra});
const row=(day,name,time,duration,extra={})=>({...stop(name,time,duration,extra),day});
const calendar=stops=>[{isoDate:'2027-04-12',stops},{isoDate:'2027-04-13',stops:[]}];
const overlaps=issues=>issues.filter(issue=>issue.type==='overlap').map(issue=>issue.row);
const duplicates=issues=>issues.filter(issue=>issue.type==='duplicate').map(issue=>issue.row);

test('clear duplicates normalize whitespace and case but require the same day, name and place',()=>{
 const days=calendar([stop('  Museum Visit  ','10:00',0,{routeQuery:'Tokyo   Japan',q:'old query'})]);
 const rows=[row(0,'museum visit','11:00',0,{q:' tokyo japan '}),row(1,'museum visit','11:00',0,{q:'Tokyo Japan'}),row(0,'museum visit','12:00',0,{q:'Osaka Japan'}),row(0,'museum visit','13:00',0,{q:''})];
 assert.deepEqual(duplicates(reviewImport(rows,days)),[0]);
});

test('duplicates within a batch report both original row indexes',()=>{
 const rows=[row(0,'Coffee','10:00',0,{q:'Tokyo Cafe'}),row(0,'Walk','11:00',0),row(0,' coffee ','12:00',0,{q:'tokyo  cafe'})];
 const issues=reviewImport(rows,calendar([]));
 assert.deepEqual(duplicates(issues),[0,2]);
 assert.match(issues[0].message,/第 3 筆/);assert.match(issues[1].message,/第 1 筆/);
});

test('known intervals are half open: touching endpoints are allowed and interior points collide',()=>{
 const days=calendar([stop('Reserved','10:00',60)]);
 const rows=[row(0,'Before','09:30',30),row(0,'Inside','10:30',undefined),row(0,'After','11:00',15),row(0,'Crossing','09:59',2),row(0,'Starts together','10:00',0)];
 const issues=reviewImport(rows,days);
 const existingOnly=issues.filter(issue=>issue.message.includes('既有行程'));
 assert.deepEqual(overlaps(existingOnly),[1,3,4]);
});

test('unknown durations retain point collisions and clock-prefixed reservations are usable',()=>{
 const days=calendar([stop('Reservation','17:30 抵達',undefined),stop('Unscheduled','下午',120)]);
 const rows=[row(0,'Same point','17:30',undefined),row(0,'Covers reservation','17:00',60),row(0,'Boundary','17:00',30),row(0,'Unknown clock','待安排',60)];
 assert.deepEqual(overlaps(reviewImport(rows,days).filter(issue=>issue.message.includes('既有行程'))),[0,1]);
});

test('overnight cross-timezone flights block both trip calendar dates until their real arrival',()=>{
 const flight={departureAirport:'桃園 TPE',arrivalAirport:'東京 HND',departureDateTime:'2027-04-12T22:00',arrivalDateTime:'2027-04-13T04:00',departureTimezone:'Asia/Taipei',arrivalTimezone:'Asia/Tokyo'};
 const days=calendar([stop('Flight','23:00',300,{kind:'flight',flight})]);
 const rows=[row(0,'Before departure','22:00',60),row(0,'At departure','23:00',undefined),row(1,'During flight','01:00',60),row(1,'After arrival','04:00',15),row(1,'Crosses arrival','03:30',45)];
 const existingOnly=reviewImport(rows,days,{timezone:'Asia/Tokyo'}).filter(issue=>issue.message.includes('既有行程'));
 assert.deepEqual(overlaps(existingOnly),[1,2,4]);
});

test('international date line arrivals are compared in the trip timezone rather than airport clock dates',()=>{
 const flight={departureDateTime:'2027-04-12T20:00',arrivalDateTime:'2027-04-12T13:00',departureTimezone:'Asia/Tokyo',arrivalTimezone:'America/Los_Angeles'};
 const days=calendar([stop('Date line flight','20:00',540,{kind:'flight',flight})]);
 const rows=[row(1,'Still in flight','04:30',undefined),row(1,'Landed','05:00',15)];
 assert.deepEqual(overlaps(reviewImport(rows,days,{timezone:'Asia/Tokyo'})),[0]);
});

test('batch interval collisions flag both affected rows and preserve legal adjacency',()=>{
 const rows=[row(0,'First','10:00',60),row(0,'Next','11:00',30),row(0,'Overlap','10:30',15)];
 const issues=reviewImport(rows,calendar([]),{timezone:'UTC'});
 assert.deepEqual(overlaps(issues),[0,2]);assert.match(issues[0].message,/第 3 筆/);assert.match(issues[1].message,/第 1 筆/);
});

test('legacy month/day calendars without a timezone use UTC and permit cross-day comparisons',()=>{
 const days=[{date:'11/11',stops:[stop('Overnight','23:00',120)]},{date:'11/12',stops:[]}];
 assert.deepEqual(overlaps(reviewImport([row(1,'Before end','00:30',undefined),row(1,'At end','01:00',undefined)],days)),[0]);
});

test('invalid or ambiguous clocks do not invent intervals and review does not mutate inputs',()=>{
 const days=calendar([stop('Malformed flight','10:00',60,{kind:'flight',flight:{departureDateTime:'bad',arrivalDateTime:'bad',departureTimezone:'bad',arrivalTimezone:'bad'}})]);
 const rows=[row(0,'Unknown','morning',60),row(0,'Valid','10:00',60),row(99,'Outside calendar','10:00',60)];
 const before=structuredClone({rows,days});
 assert.deepEqual(reviewImport(rows,days,{timezone:'UTC'}),[]);assert.deepEqual({rows,days},before);
 const dstDays=[{isoDate:'2027-03-14',stops:[stop('Clock gap','02:30',60)]}];
 assert.deepEqual(reviewImport([row(0,'Known','03:00',15)],dstDays,{timezone:'America/New_York'}),[]);
 assert.deepEqual(reviewImport(null,days),[]);assert.deepEqual(reviewImport(rows,null),[]);
});
