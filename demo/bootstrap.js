import {createDemoApi} from './api.js';
import {DEMO_TRIP_ID} from './seed.js';

const base=new URL('../',import.meta.url).pathname.replace(/\/$/,'');
const url=new URL(location.href);
if(!url.searchParams.has('page'))url.searchParams.set('page',({'#overview':'overview','#daily':'daily','#map-panel':'map','#before':'notes'})[url.hash]||(/^#day-\d+-stop-\d+$/.test(url.hash)?'daily':'overview'));
if(!url.searchParams.has('trip')&&url.searchParams.get('page')!=='trips')url.searchParams.set('trip',DEMO_TRIP_ID);
history.replaceState(null,'',url.pathname+url.search+url.hash);
let storage;try{storage=localStorage;}catch{}
const api=createDemoApi({storage,base});
const originalFetch=globalThis.fetch.bind(globalThis);
// Only app API calls are intercepted. Browser navigation to Google Maps stays external.
globalThis.fetch=(input,options)=>{
 const target=new URL(input instanceof Request?input.url:String(input),location.href);
 return target.origin===location.origin&&target.pathname.startsWith(base+'/api/')?api.fetch(input instanceof Request?input:target.href,options):originalFetch(input,options);
};
globalThis.__TRAVEL_NOTES_DEMO__={enabled:true};

const banner=document.createElement('aside');banner.className='demo-banner';banner.setAttribute('aria-label','示範模式');
banner.innerHTML='<div><strong>示範模式 · 資料只儲存在此瀏覽器</strong><small>可自由試用。此示例無帳號登入、雲端同步或邀請功能。</small></div><div class="demo-actions"><button id="demo-days-open" type="button" class="secondary">管理日期</button><button id="demo-reset" type="button" class="plain">重設示範資料</button></div><p id="demo-status" role="status" aria-live="polite" hidden></p>';
document.querySelector('main').prepend(banner);
const status=document.getElementById('demo-status');
function message(value){status.textContent=value;status.hidden=!value;}
try{api.load();if(api.recovered)message('先前示範資料格式不正確，已恢復合成示例。');}catch(error){message(error.message);}
document.getElementById('demo-reset').addEventListener('click',()=>{
 if(!confirm('重設此示範的所有旅行、已刪除旅行及草稿，恢復京都三日示例？'))return;
 try{api.reset();location.assign(base+'/index.html?page=overview&trip='+DEMO_TRIP_ID);}catch(error){message(error.message);}
});
const accountLabel=document.querySelector('.trip-account small');if(accountLabel)accountLabel.textContent='儲存位置';
document.querySelector('.trip-create-help').textContent='每趟旅行可安排 1–60 天。新旅行會有空白的每日行程，資料只存在此瀏覽器。';
document.querySelector('#trip-library-empty p').textContent='建立旅行後，就能安排每日行程。示範模式不提供登入或同行者邀請。';
document.querySelector('#trip-deleted > p').textContent='已刪除旅行仍保留在此瀏覽器，你可以恢復完整行程。';
document.querySelector('.install-note').textContent='資料只存在此瀏覽器，不會同步到其他裝置。清除網站資料會刪除你的示範修改。';
document.getElementById('sharing-open').textContent='邀請功能說明';

const dialog=document.createElement('dialog');dialog.id='demo-days-dialog';dialog.setAttribute('aria-labelledby','demo-days-title');
dialog.innerHTML='<div class="dialog-heading"><div><h2 id="demo-days-title">管理旅行日期</h2><p>可編輯每日主題，新增、移動或刪除日期。日期會從出發日連續排列。</p></div><button type="button" class="plain" id="demo-days-close" aria-label="關閉管理日期">✕</button></div><form id="demo-day-form"><label>選擇日期<select id="demo-day-select"></select></label><label>每日主題<input id="demo-day-title" maxlength="120" required></label><label>小標<input id="demo-day-sub" maxlength="300"></label><label>行程介紹<textarea id="demo-day-intro" maxlength="2000" rows="2"></textarea></label><label>提醒<textarea id="demo-day-tip" maxlength="2000" rows="2"></textarea></label><p id="demo-day-status" role="status" aria-live="polite"></p><div class="demo-day-order"><button type="button" class="secondary" id="demo-day-up">日期上移</button><button type="button" class="secondary" id="demo-day-down">日期下移</button><button type="button" class="plain danger" id="demo-day-delete">刪除此日</button></div><div class="dialog-footer"><button type="button" class="secondary" id="demo-day-add">＋ 新增一天</button><button type="submit" class="primary">儲存每日主題</button></div></form>';
document.body.append(dialog);
let current=null,dayPending=false;
const field=name=>document.getElementById('demo-day-'+name);
const tripId=new URL(location.href).searchParams.get('trip');
const editSelected=()=>{const day=current.days[Number(field('select').value)];for(const name of ['title','sub','intro','tip'])field(name).value=day[name];field('up').disabled=field('select').value==='0';field('down').disabled=Number(field('select').value)===current.days.length-1;field('delete').disabled=current.days.length===1;field('add').disabled=current.days.length===60;};
document.getElementById('demo-days-open').hidden=!tripId;
document.getElementById('demo-days-open').addEventListener('click',async()=>{
 if(!globalThis.__TRAVEL_NOTES_DEMO__.canManageDays?.()){message('請先儲存或取消目前的編輯，再管理日期。');return;}
 try{
  const response=await api.fetch(base+'/api/trip?trip='+encodeURIComponent(tripId));current=await response.json();if(!response.ok)throw Error(current.error);
  field('select').replaceChildren(...current.days.map((day,index)=>{const option=document.createElement('option');option.value=index;option.textContent=`第 ${index+1} 天 · ${day.isoDate} · ${day.title}`;return option;}));
  field('select').value=Math.min(Number(new URL(location.href).searchParams.get('day')||1)-1,current.days.length-1);editSelected();field('status').textContent='';dialog.showModal();
 }catch(error){message(error.message);}
});
field('select').addEventListener('change',editSelected);
document.getElementById('demo-days-close').addEventListener('click',()=>{if(!dayPending)dialog.close();});
dialog.addEventListener('cancel',event=>{if(dayPending)event.preventDefault();});
async function mutateDay(action,extra={}){
 if(dayPending)return;dayPending=true;dialog.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);field('status').textContent='正在儲存至此瀏覽器…';
 try{
  const response=await api.fetch(base+'/api/demo/days?trip='+encodeURIComponent(tripId),{method:'PUT',body:JSON.stringify({action,index:Number(field('select').value),revision:current.revision,...extra})}),data=await response.json();
  if(!response.ok)throw Error(data.error);location.reload();
 }catch(error){field('status').textContent=error.message;dayPending=false;dialog.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=false);editSelected();}
}
document.getElementById('demo-day-form').addEventListener('submit',event=>{event.preventDefault();void mutateDay('edit',Object.fromEntries(['title','sub','intro','tip'].map(name=>[name,field(name).value])));});
field('add').addEventListener('click',()=>void mutateDay('add'));
field('up').addEventListener('click',()=>void mutateDay('move',{to:Number(field('select').value)-1}));
field('down').addEventListener('click',()=>void mutateDay('move',{to:Number(field('select').value)+1}));
field('delete').addEventListener('click',()=>{if(confirm('刪除此日及當天所有行程？後面的日期會往前排列。'))void mutateDay('delete');});
await import('../web-app.js');
await import('../app.js');
