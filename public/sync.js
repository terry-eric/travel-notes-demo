// Poll only visible, connected pages; never replace an in-progress edit or save.
export function createAutoSync({getState,fetchSnapshot,apply,onDeferred=()=>{},onError=()=>{},onHealthy=()=>{},isActive=()=>true,interval=10000,schedule=setTimeout,cancel=clearTimeout}){
 let running=false,timer=null,flight=null,generation=0,failures=0,deferredRevision=null;
 function plan(){
  if(!running)return;
  if(timer!==null)cancel(timer);
  timer=schedule(()=>{timer=null;void tick();},Math.min(interval*2**Math.min(failures,3),60000));
 }
 function tick(){
  if(flight)return flight;
  if(timer!==null){cancel(timer);timer=null;}
  const before=getState(),blocked=s=>!s.ready||s.busy||s.pending||s.conflict;
  if(!isActive()||blocked(before)){plan();return Promise.resolve();}
  const requestGeneration=generation;
  flight=Promise.resolve().then(async()=>{
   try{
    const snapshot=await fetchSnapshot(before.revision),current=getState();
    if(requestGeneration!==generation||!isActive()||blocked(current)||current.revision!==before.revision)return;
    failures=0;
    if(!snapshot||snapshot.revision<=current.revision){deferredRevision=null;onHealthy();return;}
    if(current.editing){
     if(snapshot.revision!==deferredRevision){deferredRevision=snapshot.revision;onDeferred(snapshot);}
     return;
    }
    deferredRevision=null;apply(snapshot);onHealthy();
   }catch(error){
    if(requestGeneration!==generation)return;
    failures++;
    const current=getState();
    if(isActive()&&!blocked(current)&&current.revision===before.revision)onError(error);
   }finally{flight=null;plan();}
  });
  return flight;
 }
 return {tick,start(){if(running)return;running=true;void tick();},stop(){running=false;generation++;if(timer!==null)cancel(timer);timer=null;}};
}
