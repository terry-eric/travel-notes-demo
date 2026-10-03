// Google iframes are cross-origin: load means navigation finished, not that
// Google successfully painted tiles. Always retain a manual reload control.
export function createMapFrame({getFrame,status,isActive,online=()=>navigator.onLine!==false,schedule=setTimeout,cancel=clearTimeout,delay=180,timeout=8000,maxRetries=2,report=detail=>console.warn('Google map diagnostic '+JSON.stringify(detail))}){
 let source='',loadedSource='',title='',generation=0,timer=null,state='idle',removeListeners=()=>{};
 const stopTimer=()=>{cancel(timer);timer=null;};
 const message=(text,kind='blocking')=>{status.textContent=text;status.dataset.state=kind;status.hidden=false;};
 const reset=()=>{generation++;stopTimer();removeListeners();removeListeners=()=>{};source='';state='idle';status.dataset.state='blocking';};
 // Suspend callbacks when hidden, but never navigate a working map to blank.
 const clear=()=>{reset();};
 const blank=frame=>{try{return frame.contentDocument?.URL==='about:blank';}catch{return false;}};
 function load(src,label,{force=false}={}){
  if(!force&&source===src&&['loading','slow','loaded','offline'].includes(state))return;
  // Keep the connected browsing context when switching/reloading. Removing src
  // and replacing the iframe interleaves about:blank and Google navigations.
  reset();if(!src||!isActive())return;
  source=src;title=label;const run=generation;
  if(!force&&loadedSource===src&&getFrame().src===src&&!blank(getFrame())&&online()){
   state='loaded';getFrame().hidden=false;status.hidden=true;return;
  }
  const valid=()=>run===generation&&isActive();
  function attempt(retries){
   if(!valid())return;
   if(!online()){state='offline';message('目前沒有網路，連線恢復後會重新載入地圖。');return;}
   state='loading';message(retries?`正在重新連線（${retries}/${maxRetries}）…`:'正在載入 Google 地圖…','loading');
   // Coalesce rapid changes, then navigate the existing visible iframe.
   timer=schedule(()=>{
    if(!valid())return;
    const frame=getFrame();
    if(!frame.isConnected){state='failed';message('地圖視窗尚未就緒，請重新載入。');return;}
    removeListeners();frame.hidden=false;frame.loading='eager';
    frame.referrerPolicy='strict-origin-when-cross-origin';frame.title=title;
    let settled=false;
    const current=()=>valid()&&getFrame()===frame;
    const fail=(reason='timeout')=>{
     if(!current()||settled)return;settled=true;stopTimer();
     let timing;try{const entry=performance.getEntriesByName(source).at(-1);if(entry)timing={duration:Math.round(entry.duration),responseStatus:entry.responseStatus??null,transferSize:entry.transferSize};}catch{}
     // No URL, key, addresses or user data are written to diagnostics.
     report({version:'nonblocking-load-v3',reason:typeof reason==='string'?reason:'error',attempt:retries+1,document:blank(frame)?'about:blank':'cross-origin',online:online(),timing});
     // A slow request may already be painting a map. Do not restart it or
     // cover it while waiting for the cross-origin load event.
     if(reason==='timeout'&&online()){settled=false;state='slow';message('Google 地圖載入較慢，可先在 Google Maps 開啟路線；這裡會繼續載入。','slow');return;}
     if(!online()){state='offline';message('目前沒有網路，連線恢復後會重新載入地圖。');}
     else if(retries<maxRetries)attempt(retries+1);
     else{state='failed';message('地圖暫時無法載入，請重新載入，或在 Google Maps 開啟。');}
    };
    const loaded=()=>{
     // The initial/reset about:blank document is same-origin and readable.
     // A real Google document is cross-origin (contentDocument is null).
     // A blank load must never cancel the timeout or hide the loading state.
     if(blank(frame))return;
     if(!current()||(settled&&state!=='failed'))return;settled=true;stopTimer();
     loadedSource=source;state='loaded';status.hidden=true;
    };
    const errored=()=>fail('error');
    frame.addEventListener('load',loaded);
    frame.addEventListener('error',errored);
    removeListeners=()=>{frame.removeEventListener('load',loaded);frame.removeEventListener('error',errored);};
    // Reopening a pending map attaches fresh listeners without interrupting
    // its existing navigation. Explicit reloads and actual errors may retry.
    if(force||retries>0||frame.src!==source)frame.src=source;
    timer=schedule(fail,timeout);
   },delay);
  }
  attempt(0);
 }
 return {load,clear,connectionChanged(){if(source&&isActive())load(source,title,{force:true});}};
}

export function placeEmbedUrl(query,key){
 if(!query||!key)return '';
 const url=new URL('https://www.google.com/maps/embed/v1/place');
 url.searchParams.set('key',key);url.searchParams.set('q',query);url.searchParams.set('language','zh-TW');
 return url.href;
}
