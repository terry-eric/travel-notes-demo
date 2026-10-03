const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function display(value,type,label){
 if(value===undefined)return type==='presence'?'已刪除':'未設定';
 if(type==='order')return value.join(' → ');
 if(type==='presence')return [value.stop.name,value.stop.time,value.stop.desc].filter(Boolean).join('\n');
 if(typeof value==='object')return Object.entries(value).filter(([k])=>k!=='travelSignature').map(([k,v])=>`${({q:'地點',routeQuery:'導航地點',mapUrl:'分享連結',placeId:'地點識別碼',mode:'交通方式',travelMinutes:'交通分鐘'})[k]||k}：${k==='mode'?({walking:'步行',transit:'大眾運輸',driving:'開車／計程車',bicycling:'自行車'})[v]||v:v}`).join('\n')||'未設定';
 if(label==='安排日期')return `第 ${value+1} 天`;
 if(label==='停留時間')return `${value} 分鐘`;
 return String(value);
}
export function initConflicts({onResolve,onLater,onChoice}){
 const dialog=document.getElementById('conflict-dialog'),list=document.getElementById('conflict-list'),status=document.getElementById('conflict-status');let choices={};
 dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void onResolve({...choices});});
 list.addEventListener('change',event=>{if(!event.target.matches('[data-conflict]'))return;choices[event.target.dataset.conflict]=event.target.value;onChoice?.({...choices});});
 document.getElementById('conflict-later').addEventListener('click',()=>{dialog.close();onLater?.();});
 dialog.addEventListener('cancel',()=>onLater?.());
 return {
  show(items,saved={}){choices={...saved};status.textContent='';list.innerHTML=items.map(c=>`<section class="conflict-item"><h3>${escape(c.name)} · ${escape(c.label)}</h3><div class="conflict-values"><div><strong>我的修改</strong><pre>${escape(display(c.mine,c.type,c.label))}</pre></div><div><strong>雲端最新</strong><pre>${escape(display(c.theirs,c.type,c.label))}</pre></div></div><label>保留哪一個？<select data-conflict="${escape(c.key)}" aria-label="${escape(c.name)}的${escape(c.label)}處理方式"><option value="" ${!choices[c.key]?'selected':''}>請選擇</option><option value="mine" ${choices[c.key]==='mine'?'selected':''}>保留我的修改</option><option value="theirs" ${choices[c.key]==='theirs'?'selected':''}>保留雲端最新</option></select></label></section>`).join('');if(!dialog.open)dialog.showModal();},
  message(value){status.textContent=value;},close(){dialog.close();}
 };
}
