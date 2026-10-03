import {apiPath,tripApiPath,selectedTripId,demoMode} from './runtime.js';
import {readCloudJson} from './cloud.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initSharing(){
 const $=id=>document.getElementById(id);let session={},pending=false;
 if(demoMode){
  const dialog=$('sharing-dialog');
  dialog.querySelector('.dialog-heading p').textContent='示範模式不提供帳號登入或邀請同行者。';
  $('share-owner').textContent='資料只儲存在此瀏覽器，網址不會分享你修改的行程。';
  $('share-form').hidden=true;$('share-form').querySelectorAll('input,select,button').forEach(el=>{el.disabled=true;el.removeAttribute('required');});
  $('share-members').hidden=true;dialog.querySelector('.share-footer').hidden=true;
  $('share-status').textContent='正式部署並設定登入後，才能使用邀請與共同編輯。';
  $('sharing-open').addEventListener('click',()=>dialog.showModal());
  $('sharing-close').addEventListener('click',()=>dialog.close());
  return {setSession(value){$('sharing-open').hidden=!value.canEdit;}};
 }
 const request=options=>fetch(tripApiPath('/api/shares'),{cache:'no-store',signal:AbortSignal.timeout(15000),...options}).then(readCloudJson);
 const lock=()=>{$('sharing-dialog').querySelectorAll('button,input,select').forEach(el=>el.disabled=pending);};
 async function load(){
  const data=await request();$('share-owner').textContent=data.owner+' · 擁有者';
  $('share-members').innerHTML=data.members.map(m=>`<div class="share-member ${m.enabled?'':'revoked'}" data-email="${esc(m.email)}"><div><strong>${esc(m.email)}</strong><small>${m.enabled?'已加入白名單':'已移除，可恢復'}</small></div><select aria-label="${esc(m.email)}的權限"><option value="viewer" ${m.role==='viewer'?'selected':''}>只能查看</option><option value="editor" ${m.role==='editor'?'selected':''}>一起編輯</option></select><button type="button" class="secondary" data-member-save data-enabled="${!!m.enabled}">儲存權限</button><button type="button" class="plain ${m.enabled?'danger':''}" data-member-toggle data-enabled="${!m.enabled}">${m.enabled?'移除':'恢復'}</button></div>`).join('')||'<p class="empty">目前只有你能查看。加入 email 後，將邀請連結交給對方即可。</p>';
 }
 async function change(email,role,enabled){
  if(pending||!session.canShare)return;pending=true;lock();$('share-status').textContent='正在儲存…';
  try{await request({method:'PUT',headers:{'Content-Type':'application/json','X-Trip-Client':'multi-1'},body:JSON.stringify({email,role,enabled})});await load();$('share-status').textContent=enabled?'已更新邀請名單。':'已移除，此帳號無法再讀取行程。';if(enabled)$('share-form').reset();}
  catch(e){$('share-status').textContent=e.message;}finally{pending=false;lock();}
 }
 $('sharing-open').addEventListener('click',async()=>{
  if(!session.canShare)return;$('sharing-dialog').showModal();pending=true;lock();$('share-status').textContent='正在載入白名單…';
  try{await load();$('share-status').textContent='';}catch(e){$('share-status').textContent=e.message;}finally{pending=false;lock();}
 });
 $('sharing-close').addEventListener('click',()=>$('sharing-dialog').close());
 $('sharing-dialog').addEventListener('cancel',e=>{if(pending)e.preventDefault();});
 $('share-form').addEventListener('submit',e=>{e.preventDefault();void change($('share-email').value,$('share-role').value,true);});
 $('share-members').addEventListener('click',e=>{const button=e.target.closest('[data-member-save],[data-member-toggle]');if(!button)return;const member=button.closest('[data-email]');void change(member.dataset.email,member.querySelector('select').value,button.dataset.enabled==='true');});
 $('share-copy').addEventListener('click',async()=>{const url=location.origin+apiPath('/overview')+'?trip='+encodeURIComponent(selectedTripId);try{await navigator.clipboard.writeText(url);$('share-status').textContent='已複製此旅行的邀請連結。對方需使用邀請的 email 登入。';}catch{$('share-status').textContent='請複製網址：'+url;}});
 return {setSession(value){session=value;$('sharing-open').hidden=!value.canShare;}};
}
