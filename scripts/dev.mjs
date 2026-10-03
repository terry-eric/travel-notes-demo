import http from 'node:http';
import fs from 'node:fs';
import {assetNames,assetType} from './assets.mjs';
import {localDatabase} from './local-db.mjs';
import {handleApi,handleTrips} from '../server/api.js';
import {handleMapsResolve} from '../server/maps-resolve.js';
import {handleMapsConfig} from '../server/maps-config.js';
import {handleSharing} from '../server/sharing.js';
import {sessionFor} from '../server/trips.js';
const owner='owner@example.com',email=process.env.TRIP_PREVIEW_EMAIL||owner;
fs.mkdirSync('.local',{recursive:true});const DB=localDatabase(process.env.TRIP_PREVIEW_DB||'.local/preview.sqlite');
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+server.address().port),chunks=[];for await(const chunk of req)chunks.push(chunk);
  const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id',email);
  const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const env={DB,OWNER_EMAIL:owner,GOOGLE_MAPS_EMBED_KEY:process.env.GOOGLE_MAPS_EMBED_KEY};let response;
  if(url.pathname==='/api/session')response=await sessionFor(request,env);
  else if(url.pathname==='/api/shares')response=await handleSharing(request,env);
  else if(url.pathname==='/api/trips')response=await handleTrips(request,env);
  else if(url.pathname==='/api/maps-resolve')response=await handleMapsResolve(request);
  else if(url.pathname==='/api/maps-config')response=handleMapsConfig(request,env);
  else if(url.pathname==='/api/trip')response=await handleApi(request,env);
  else{
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   const key=['/','/trips','/overview','/daily','/map','/notes'].includes(url.pathname)?'index.html':url.pathname.slice(1);
   if(!assetNames.includes(key)){res.writeHead(404);res.end();return;}
   response=new Response(req.method==='HEAD'?null:fs.readFileSync('public/'+key),{headers:{'Content-Type':assetType(key)}});
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(e.message);res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(0,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port+'/trips'));
