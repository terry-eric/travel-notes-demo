import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMapsShare} from '../public/maps-link.js';
import {handleApi} from '../server/api.js';
import {localDatabase} from '../scripts/local-db.mjs';
import {seedDays} from '../public/seed.js';

test('accepts shared text, short links and place links while rejecting other destinations',()=>{
 assert.equal(parseMapsShare('北菓樓 札幌本館\nhttps://maps.app.goo.gl/abcDEF123?g_st=ic'),'https://maps.app.goo.gl/abcDEF123?g_st=ic');
 assert.equal(parseMapsShare('地點（https://goo.gl/maps/abc123）。'),'https://goo.gl/maps/abc123');
 assert.equal(parseMapsShare('https://www.google.com/maps/place/Sapporo/'),'https://www.google.com/maps/place/Sapporo/');
 assert.equal(parseMapsShare(''),'');
 for(const link of ['javascript:alert(1)','http://maps.app.goo.gl/a','https://maps.app.goo.gl.evil.com/a','https://www.google.com/url?q=https://evil.com','https://evil.com/maps','https://user:pass@www.google.com/maps/place/a','https://maps.app.goo.gl:8443/a','https://goo.gl/not-maps/a'])assert.throws(()=>parseMapsShare(link));
});

test('shared place link survives reload, renaming and undo without any Places key',async()=>{
 const DB=localDatabase();
 const req=body=>new Request('https://trip.example/api/trip',{method:body?'PUT':'GET',headers:{'oai-authenticated-user-id':'owner@example.com','Content-Type':'application/json',Origin:'https://trip.example','X-Trip-Client':'multi-1'},body:body?JSON.stringify(body):undefined});
 try{
 const days=structuredClone(seedDays);days[0].stops.push({name:'下午咖啡',mapUrl:'https://maps.app.goo.gl/abc123',q:'',desc:'靠窗座位'});
 let response=await handleApi(req({days,revision:0,mutationId:'share'}),{DB});assert.equal(response.status,200);
 let saved=await(await handleApi(req(),{DB})).json();assert.equal(saved.days[0].stops.at(-1).mapUrl,'https://maps.app.goo.gl/abc123');
 saved.days[0].stops.at(-1).name='旅途休息';
 saved=await(await handleApi(req({days:saved.days,revision:1,mutationId:'rename'}),{DB})).json();assert.equal(saved.days[0].stops.at(-1).name,'旅途休息');assert.equal(saved.days[0].stops.at(-1).mapUrl,'https://maps.app.goo.gl/abc123');
 saved=await(await handleApi(req({days:saved.previous,revision:2,mutationId:'undo'}),{DB})).json();assert.equal(saved.days[0].stops.at(-1).name,'下午咖啡');assert.equal(saved.days[0].stops.at(-1).mapUrl,'https://maps.app.goo.gl/abc123');
 saved.days[0].stops.at(-1).mapUrl='https://evil.com/maps';assert.equal((await handleApi(req({days:saved.days,revision:3,mutationId:'invalid'}),{DB})).status,400);
 assert.equal((await(await handleApi(req(),{DB})).json()).revision,3);
 }finally{DB.close();}
});
