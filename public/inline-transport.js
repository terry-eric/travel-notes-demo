import {legSignature,savedTravelMinutes,pushSchedule} from './transport.js';

export const transportIcons={
 walking:{label:'步行',shape:'<circle cx="13" cy="4" r="2"/><path d="m7 21 3-6 3-3 1 4 4 5M6 11l4-4 4 1 3 4h3M10 7l-1 7"/>'},
 transit:{label:'大眾運輸',shape:'<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 11h14M12 3v8M8 21l2-3m4 0 2 3"/><circle cx="9" cy="15" r=".7"/><circle cx="15" cy="15" r=".7"/>'},
 driving:{label:'開車',shape:'<path d="m5 9 2-5h10l2 5M4 17H3V9h18v8h-1M7 17h10M6 12h2m8 0h2"/><rect x="4" y="15" width="3" height="5" rx="1"/><rect x="17" y="15" width="3" height="5" rx="1"/>'},
 bicycling:{label:'自行車',shape:'<circle cx="5" cy="16" r="4"/><circle cx="19" cy="16" r="4"/><path d="m5 16 5-8 5 8H5m5-8h6l3 8M8 5h4m3 0h3v3"/>'}
};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=mode=>`<svg class="transport-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${transportIcons[mode].shape}</svg>`;

export function validateTransportInput({mode,minutes}){
 if(!Object.hasOwn(transportIcons,mode))throw Error('請選擇有效的交通方式。');
 const value=String(minutes??'').trim();
 if(!/^\d+$/.test(value)||Number(value)>1440)throw Error('請填寫 0 到 1440 的整數分鐘。');
 return {mode,minutes:Number(value)};
}

// Stable identity and the original revision keep the existing conflict merge path intact.
export function applyManualTransport(days,day,id,values){
 const input=validateTransportInput(values),next=structuredClone(days),stops=next[day]?.stops;
 const index=stops?.findIndex(stop=>stop.id===id)??-1;
 if(index<0||index===0&&!stops[0].from)throw Error('找不到這兩站的交通行程，請重新整理後再試。');
 const stop=stops[index];stop.mode=input.mode;stop.travelMinutes=input.minutes;stop.travelSignature=legSignature(stops,index);
 return {days:next,index,...input,result:pushSchedule(stops,index)};
}

export function renderInlineTransportRow(stops,index,{canEdit=false,draft=null}={}){
 if(!stops[index]||index===0&&!stops[index].from)return '';
 const stop=stops[index],mode=draft?.mode||stop.mode||'walking',safeMode=Object.hasOwn(transportIcons,mode)?mode:'walking';
 const minutes=draft?draft.minutes:savedTravelMinutes(stops,index),pair=(index?stops[index-1].name:stop.from)+' → '+stop.name;
 const route=`<button type="button" class="inline-route-button" data-transport="${index}" aria-haspopup="dialog" aria-label="${esc(pair)}：查看 Google Maps 路線">Google Maps ↗</button>`;
 if(!canEdit)return `<div class="transfer-row inline-transfer is-viewer"><div class="inline-transfer-summary">${icon(safeMode)}<span>${transportIcons[safeMode].label}</span><strong>${minutes===null?'未設定時間':esc(minutes)+' 分鐘'}</strong>${route}</div></div>`;
 const feedback=`transfer-feedback-${index}`;
 return `<div class="transfer-row inline-transfer${draft?' is-dirty':''}"><form class="inline-transfer-form" data-transport-form="${index}" data-transport-id="${esc(stop.id)}" aria-label="${esc(pair)}的交通"><span class="inline-mode-icon">${icon(safeMode)}</span><label class="inline-mode-label"><span class="inline-sr-only">${esc(pair)}的交通方式</span><select name="mode" data-write>${Object.entries(transportIcons).map(([value,item])=>`<option value="${value}" ${safeMode===value?'selected':''}>${item.label}</option>`).join('')}</select></label><label class="inline-minutes-label"><span class="inline-sr-only">${esc(pair)}的交通時間（分鐘）</span><input name="minutes" type="number" inputmode="numeric" min="0" max="1440" step="1" required placeholder="分鐘" value="${esc(minutes??'')}" aria-describedby="${feedback}" data-write><span>分鐘</span></label><button type="submit" class="inline-transfer-save" data-write>儲存</button>${route}<button type="button" class="inline-transfer-cancel" data-transport-cancel="${index}" ${draft?'':'hidden'}>取消</button><p class="inline-transfer-feedback" id="${feedback}" role="status" aria-live="polite">${draft?'未儲存；儲存後會順延後續行程。':''}</p></form></div>`;
}
