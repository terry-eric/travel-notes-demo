export const tags = [
 {label:'景點',id:'sight'},
 {label:'用餐',id:'food'},
 {label:'咖啡',id:'cafe'},
 {label:'購物',id:'shopping'},
 {label:'交通',id:'transport'},
 {label:'住宿',id:'hotel'},
 {label:'演唱會',id:'concert'},
 {label:'自由時間',id:'free'},
 {label:'其他',id:'other'}
];
const aliases = {
 '固定演唱會':'concert','甜點':'cafe','早餐':'food','散步':'sight','機票':'transport','航班':'transport',
 '城市風景':'sight','玻璃工藝':'sight','音樂盒':'sight','黃昏散步':'sight',
 'JR 出發':'transport','抵達':'transport','返程':'transport','提早出發':'transport',
 '市區採買':'shopping','伴手禮':'shopping','保留空白':'free','彈性備案':'free'
};
export function tagCategory(tag){
 return tags.find(item=>item.label===tag)?.id || (Object.hasOwn(aliases,tag)?aliases[tag]:'other');
}
// Existing custom labels stay selectable, without changing stored trip data.
export function tagOptions(value){
 const current=value||'其他';
 return tags.some(item=>item.label===current)?tags.map(item=>item.label):[current,...tags.map(item=>item.label)];
}
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function isFixedStop(stop){return stop?.live===true||stop?.kind==='flight';}
export function renderFixedStopBadge(stop){
 if(!isFixedStop(stop))return '';
 return '<span class="fixed-stop-badge" title="請至編輯視窗調整"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>固定行程</span>';
}
export function renderCardTag(stop,day,{canEdit=false,value=stop.tag||'其他'}={}){
 const fixed=isFixedStop(stop);
 // A stale inline draft must not disguise a stop that has become fixed.
 if(fixed)value=stop.tag||'其他';
 if(!canEdit||fixed)return `<span class="tag${fixed?' is-fixed':''}"${fixed?' title="請至編輯視窗調整"':''}>${tagCategory(value)==='concert'?'♫ ':''}${escapeHtml(value)}</span>`;
 const options=tagOptions(stop.tag);
 // The current saved custom label remains available, including after a retry.
 if(!options.includes(value))options.unshift(value);
 return `<label class="card-tag-control"><select class="tag card-tag-selector" data-card-tag data-tag-day="${escapeHtml(day)}" data-tag-id="${escapeHtml(stop.id)}" data-write aria-label="${escapeHtml(stop.name)}：更改行程標籤">${options.map(label=>`<option value="${escapeHtml(label)}"${label===value?' selected':''}>${escapeHtml(label)}</option>`).join('')}</select><span class="card-tag-status" role="status" aria-live="polite"></span></label>`;
}
// Tags are presentation metadata. Changing one never changes route, time,
// sequence, attribution, or private booking information. Fixed stops are edited
// through the editor window, where the complete arrangement can be reviewed.
export function applyStopTag(days,day,id,value){
 if(!Number.isInteger(day)||!days[day]?.stops)throw Error('找不到行程日期。');
 const index=days[day].stops.findIndex(stop=>stop.id===id);
 if(index<0)throw Error('行程已移動或刪除，請重新整理後再選擇標籤。');
 const stop=days[day].stops[index];
 if(isFixedStop(stop))throw Error('固定行程的類型已鎖定，請至編輯視窗調整。');
 const label=typeof value==='string'?value.trim():'';
 if(!label||label.length>30||!tagOptions(stop.tag).includes(label))throw Error('請選擇有效的行程標籤。');
 const next=structuredClone(days);next[day].stops[index].tag=label;
 return {days:next,index,changed:(stop.tag||'其他')!==label};
}
