import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{deploymentTarget} from '../server/cloudflare.js';

test('deployment target accepts explicit safe host/base and rejects malformed configuration',()=>{
 assert.deepEqual(deploymentTarget({APP_HOST:'trip.example.com',APP_BASE:'/trip'}),{host:'trip.example.com',base:'/trip'});
 assert.deepEqual(deploymentTarget({APP_HOST:'travel.example.com',APP_BASE:'/private/travel'}),{host:'travel.example.com',base:'/private/travel'});
 assert.deepEqual(deploymentTarget({APP_HOST:'travel.example.com',APP_BASE:''}),{host:'travel.example.com',base:''});
 for(const APP_HOST of [undefined,'','https://trip.example.com','trip.example.com:443','*.example.com','-trip.example.com','trip..example.com','trip.example.com/other','trip.example.com@evil.example'])assert.equal(deploymentTarget({APP_HOST,APP_BASE:'/trip'}),null);
 for(const APP_BASE of [undefined,'/','/trip/','//trip','/trip/..','/trip?redirect=evil','/trip<script>','/trip%2Fprivate'])assert.equal(deploymentTarget({APP_HOST:'trip.example.com',APP_BASE}),null);
});

test('alternate deployment path rejects other hosts and adjacent paths before Access verification',async()=>{
 const env={APP_HOST:'travel.example.com',APP_BASE:'/private/travel',ACCESS_ISSUER:'https://trip-test.cloudflareaccess.com',ACCESS_AUD:'aud'};
 for(const url of ['https://evil.example/private/travel','https://travel.example.com/private/traveller','https://travel.example.com/trip','https://travel.example.com/private/travel%2Fapi/trip'])assert.equal((await worker.fetch(new Request(url),env)).status,404);
 assert.equal((await worker.fetch(new Request('https://travel.example.com/private/travel/api/trip'),env)).status,401);
 assert.equal((await worker.fetch(new Request('https://travel.example.com/private/travel'),{})).status,503);
});
