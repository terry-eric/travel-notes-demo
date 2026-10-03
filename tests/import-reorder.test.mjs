import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImportText,insertImported} from '../public/import.js';
import {moveStop} from '../public/reorder.js';
import {seedDays} from '../public/seed.js';
import {clearStaleTravel,legSignature} from '../public/transport.js';
import {mergeTrip} from '../public/merge.js';
const row=(id,day,time)=>({id,day,time,name:id,mapUrl:'https://www.google.com/maps/place/Otaru+Canal/',q:'Otaru Canal'});

test('Google share batches preserve custom titles and reject foreign URLs and excessive items',()=>{
 const rows=parseImportText('咖啡時間 https://maps.app.goo.gl/abc123\n小樽運河\nhttps://www.google.com/maps/place/Otaru+Canal/');
 assert.equal(rows.length,2);assert.equal(rows[0].name,'咖啡時間');assert.equal(rows[1].name,'小樽運河');assert.equal(rows[1].q,'Otaru Canal');
 assert.equal(parseImportText('https://www.google.com/maps/place/Otaru+Canal/')[0].name,'Otaru Canal');
 for(const input of ['沒有連結','https://evil.example/place',(Array(101).fill('https://maps.app.goo.gl/abc123').join('\n'))])assert.throws(()=>parseImportText(input));
});
test('dated imports retain all existing stops and anchors while inserting selected times',()=>{
 const base=structuredClone(seedDays),before=structuredClone(base);
 const added=insertImported(base,[row('import-one',1,'10:15'),row('import-two',2,'18:30'),row('import-three',1,'10:30')]);
 assert.deepEqual(base,before);assert.equal(added[1].stops[1].id,'import-one');assert.equal(added[1].stops[2].id,'import-three');
 for(let d=0;d<base.length;d++)assert.deepEqual(added[d].stops.filter(s=>!s.id.startsWith('import-')),base[d].stops);
 const concert=added[2].stops.find(s=>s.live);assert.equal(concert.time,base[2].stops.find(s=>s.live).time);
 assert.equal(added[2].stops.find(s=>s.id==='import-two').time,'18:30');
});
test('invalid dates, times, duplicate identities and capacity errors do not partially change a trip',()=>{
 const base=structuredClone(seedDays);
 for(const invalid of [row('bad',5,'09:00'),row('bad',0,'24:00'),row(base[0].stops[0].id,0,'09:00'),{...row('bad',0,'09:00'),q:''}])assert.throws(()=>insertImported(base,[row('good',0,'09:00'),invalid]));
 const full=structuredClone(base);full[0].stops=Array.from({length:100},(_,i)=>({...row('full-'+i,0,'09:00')}));
 assert.throws(()=>insertImported(full,[row('extra',0,'10:00')]));assert.equal(full[0].stops.length,100);
 assert.deepEqual(base,seedDays);
});
test('identity reordering preserves edited data, invalidates only changed route pairs and merges a remote rename',()=>{
 const base=structuredClone(seedDays),stops=base[1].stops;
 for(let i=1;i<stops.length;i++){stops[i].travelMinutes=6;stops[i].travelSignature=legSignature(stops,i);}
 const mine=structuredClone(base);mine[1].stops=moveStop(mine[1].stops,stops[3].id,1);clearStaleTravel(mine);
 assert.deepEqual(mine[1].stops.map(s=>s.id),[stops[0].id,stops[3].id,stops[1].id,stops[2].id,stops[4].id,stops[5].id]);
 assert.equal(mine[1].stops[3].travelMinutes,6);assert.equal(mine[1].stops[5].travelMinutes,6);assert.equal(mine[1].stops[1].travelMinutes,undefined);
 const remote=structuredClone(base);remote[1].stops[3].name='同行者新名稱';
 const result=mergeTrip(base,mine,remote);assert.equal(result.unresolved.length,0);assert.equal(result.days[1].stops[1].name,'同行者新名稱');
 assert.throws(()=>moveStop(stops,'missing',1));assert.throws(()=>moveStop(stops,stops[0].id,-1));
});
