import {parseMapsShare,locationFromMapsUrl} from '../public/maps-link.js';

export async function resolveMapsShare(value,fetcher=fetch){
 let target=parseMapsShare(value);
 if(!target)throw Error('請貼上 Google Maps 分享連結。');
 const signal=AbortSignal.timeout(8000);
 for(let hop=0;hop<5;hop++){
  const location=locationFromMapsUrl(target);if(location)return location;
  // Follow only validated Google Maps redirects; never scrape page content.
  const response=await fetcher(target,{method:'HEAD',redirect:'manual',signal});
  const next=response.headers.get('Location');
  if(![301,302,303,307,308].includes(response.status)||!next)break;
  target=parseMapsShare(new URL(next,target).href);
 }
 throw Error('這條分享連結暫時無法讀取地點，請在上方填入店名或地址，或貼上 Google Maps 網頁的完整地點網址。');
}

export async function handleMapsResolve(request,fetcher=fetch){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const reply=(body,status=200)=>Response.json(body,{status,headers});
 if(!request.headers.get('oai-authenticated-user-id'))return reply({error:'請重新登入網站。'},401);
 if(request.method!=='POST')return reply({error:'不支援此操作。'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)return reply({error:'請從本站讀取地點。'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'資料格式不正確。'},415);
 // Bound the request while streaming, regardless of Content-Length.
 const reader=request.body?.getReader();if(!reader)return reply({error:'請貼上分享連結。'},400);
 let bytes=0,parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>6000){await reader.cancel();return reply({error:'分享內容太長。'},413);}parts.push(value);}
 let link;
 try{const buffer=new Uint8Array(bytes);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}link=parseMapsShare(JSON.parse(new TextDecoder().decode(buffer)).url);if(!link)throw Error('請貼上分享連結。');}
 catch(e){return reply({error:e.message},400);}
 try{return reply(await resolveMapsShare(link,fetcher));}
 catch(e){return reply({error:e.name==='TimeoutError'?'讀取分享連結逾時，請重試或填入店名／地址。':e.message},422);}
}
