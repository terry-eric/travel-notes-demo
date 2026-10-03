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
 '固定演唱會':'concert','甜點':'cafe','早餐':'food','散步':'sight',
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
