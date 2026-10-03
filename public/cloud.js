import {apiPath,tripApiPath} from './runtime.js';
export async function readCloudJson(response){
 const fail=(message,status,data)=>{const error=Error(message);error.status=status;if(data!==undefined)error.data=data;throw error;};
 const type=response.headers.get('Content-Type')||'';
 if(response.status===401||(response.status===403&&!type.includes('application/json'))||response.redirected||(response.ok&&type.includes('text/html')))
  fail('登入已過期，請重新登入網站後載入。',401);
 let body;
 try{body=await response.json();}catch{fail('暫時無法連上雲端，請重試。',response.status||503);}
 if(!response.ok)fail(body.error||'暫時無法連上雲端，請重試。',response.status,body);
 return body;
}
export async function fetchEmbedConfig(fetcher=fetch){
 const response=await fetcher(apiPath('/api/maps-config'),{cache:'no-store',signal:AbortSignal.timeout(10000)});
 const config=await readCloudJson(response);
 if(typeof config?.embedKey!=='string')throw Error('地圖設定回應不完整，請重試。');
 return config.embedKey.trim();
}
export async function fetchTripUpdate(revision,fetcher=fetch,onRole=()=>{},isCurrent=()=>true){
 const path=tripApiPath('/api/trip'),response=await fetcher(path+(path.includes('?')?'&':'?')+'revision='+encodeURIComponent(revision),{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(response.status===204){if(isCurrent())onRole(response.headers.get('X-Trip-Role'));return null;}
 const data=await readCloudJson(response);if(!isCurrent())return null;onRole(data.role);return data;
}

// Cached data never supplies identity or permissions. Confirm the selected
// trip's live session before reading an account-scoped snapshot.
export async function loadVerifiedTripSnapshot({tripId,fetchSession,fetchSnapshot,onSession,onCached=()=>{},onFresh,isCurrent=()=>true}){
 let cache;
 try{
  const session=await fetchSession();
  if(!isCurrent())return;
  if(typeof session?.email!=='string'||!session.email||session.trip?.id!==tripId||!['owner','editor','viewer'].includes(session.role)){
   const error=Error('無法確認這趟旅行的登入權限，請重新登入。');error.status=401;throw error;
  }
  cache=onSession(session);
  if(!isCurrent())return;
  const saved=cache?.readTrip(tripId);
  if(saved&&isCurrent())onCached(saved);
  const snapshot=await fetchSnapshot();
  if(!isCurrent())return;
  if(snapshot?.trip?.id!==tripId||!Array.isArray(snapshot.days)||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0)throw Error('行程回應不完整，請重新載入。');
  cache?.writeTrip(tripId,snapshot);
  onFresh(snapshot);
  return snapshot;
 }catch(error){
  if(isCurrent()){
   if(error.status===401)cache?.clearAccount();
   if(error.status===403)cache?.deleteTrip(tripId);
  }
  throw error;
 }
}
