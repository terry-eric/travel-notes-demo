// Accept copied Google Maps URLs or the text included with a shared place.
// Only Google Maps destinations are accepted.
export function parseMapsShare(value) {
 const input=String(value??'').trim();
 if(!input)return '';
 if(input.length>5000)throw Error('分享內容太長，請只貼上 Google Maps 連結。');
 const candidates=input.match(/https:\/\/[^\s<>"「」]+/gi)||[];
 for(const candidate of candidates){
  let url;try{url=new URL(candidate.replace(/[。，、）)\]}]+$/u,''));}catch{continue;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)continue;
  const host=url.hostname.toLowerCase(),path=url.pathname;
  const short=host==='maps.app.goo.gl'&&/^\/[A-Za-z0-9_-]+\/?$/.test(path);
  const oldShort=host==='goo.gl'&&/^\/maps\/[A-Za-z0-9_-]+\/?$/.test(path);
  const google=/^(www\.|maps\.)?google\.(com|com\.tw|co\.jp)$/.test(host);
  const mapPage=google&&(path==='/maps'||path.startsWith('/maps/')||host.startsWith('maps.')&&path==='/');
  if((short||oldShort||mapPage)&&url.href.length<=2048)return url.href;
 }
 throw Error('請貼上 Google Maps「分享 → 複製連結」的網址。');
}

export function locationFromMapsUrl(value){
 let url;try{url=new URL(parseMapsShare(value));}catch{return null;}
 if(url.hostname==='maps.app.goo.gl'||url.hostname==='goo.gl'||url.pathname.includes('/maps/dir'))return null;
 const lat=url.pathname.match(/!3d(-?\d+(?:\.\d+)?)/),lng=url.pathname.match(/!4d(-?\d+(?:\.\d+)?)/);
 let label='';try{label=decodeURIComponent((url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1]||'').replace(/\+/g,' '));}catch{}
 if(lat&&lng&&Math.abs(Number(lat[1]))<=90&&Math.abs(Number(lng[1]))<=180)return {query:lat[1]+','+lng[1],label};
 const query=(url.searchParams.get('query')||url.searchParams.get('q')||label).trim();
 return query&&query.length<=300?{query,label:label||query}:null;
}
