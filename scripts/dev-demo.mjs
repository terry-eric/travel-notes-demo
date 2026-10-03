import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {buildDemo} from './build-demo.mjs';

const output=buildDemo(),port=Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7)||0),base=process.argv.find(arg=>arg.startsWith('--base='))?.slice(7).replace(/\/$/,'')||'';
if(!Number.isInteger(port)||port<0||port>65535||base&&(!/^\/(?!\/)[a-zA-Z0-9_/-]+$/.test(base)||base.includes('..')))throw Error('Use --port=0..65535 and optional --base=/repository-name.');
const types={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json; charset=utf-8'};
const server=http.createServer((request,response)=>{
 if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
 let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);}catch{response.writeHead(400);response.end();return;}
 if(pathname===base&&base){response.writeHead(302,{Location:base+'/'});response.end();return;}
 if(!pathname.startsWith(base+'/')){response.writeHead(404);response.end();return;}
 const relative=pathname.slice(base.length+1)||'index.html',target=path.resolve(output,relative),within=target.startsWith(output+path.sep);
 if(!within||!fs.existsSync(target)||!fs.statSync(target).isFile()){response.writeHead(404);response.end();return;}
 response.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});response.end(request.method==='HEAD'?undefined:fs.readFileSync(target));
});
server.listen(port,'127.0.0.1',()=>console.log('Demo: http://127.0.0.1:'+server.address().port+base+'/index.html'));
