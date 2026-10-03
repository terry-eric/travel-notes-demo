import {calendarDays,cleanState,DEMO_VERSION} from './model.js';
import {legSignature} from '../public/transport.js';

// A fictional trip for exploring the app. No production account or itinerary.
export const DEMO_TRIP_ID='demo-kyoto-three-days';
export function createDemoState(){
 const trip={id:DEMO_TRIP_ID,title:'京都散步 · 三日示範',startDate:'2027-04-12',endDate:'2027-04-14',timezone:'Asia/Tokyo'};
 const days=calendarDays(trip),stop=(id,time,name,q,duration,tag,desc,extra={})=>({id,time,name,q,duration,tag,desc,mode:'walking',...extra});
 Object.assign(days[0],{title:'東山的慢步調',sub:'寺院・小巷・茶點',intro:'示範行程：從東山開始，留一段沒有趕路的午後。',tip:'這是虛構示例，請自行確認實際交通與營業資訊。',stops:[
  stop('demo-kiyomizu','09:00','清水寺','Kiyomizu-dera Kyoto',90,'景點','試試編輯名稱、停留時間或備註。'),
  stop('demo-sannenzaka','11:00','三年坂散步','Sannenzaka Kyoto',60,'散步','可拖曳行程，或在編輯視窗調整順序。'),
  stop('demo-gion','14:00','祇園茶點時間','Gion Kyoto',60,'美食','固定時間行程會保留原定時間。', {live:true,createdBy:'demo-a@example.invalid'})
 ]});
 Object.assign(days[1],{title:'嵐山的綠意',sub:'竹林・河岸・休息',intro:'用幾個景點練習交通分鐘數與時間順延。',stops:[
  stop('demo-bamboo','09:30','竹林小徑','Arashiyama Bamboo Grove Kyoto',60,'景點','外部 Google Maps 連結可以直接開啟。'),
  stop('demo-bridge','11:00','渡月橋','Togetsukyo Bridge Kyoto',45,'散步','兩站間的分鐘數可自行輸入。'),
  stop('demo-lunch','12:30','河邊午餐','Arashiyama Kyoto',75,'美食','試試交通時間「儲存並順延」。')
 ]});
 days[1].stops[1].travelMinutes=15;days[1].stops[1].travelSignature=legSignature(days[1].stops,1);
 Object.assign(days[2],{title:'城市裡的最後一天',sub:'市場・書店・返程',intro:'先保留有預約的項目，再安排自由活動。',stops:[
  stop('demo-market','10:00','錦市場','Nishiki Market Kyoto',90,'美食','此資料只存在這個瀏覽器。'),
  stop('demo-reservation','14:00','示範預約行程','Kyoto Station',60,'行程','B 頭像是合成示範角色。', {live:true,createdBy:'demo-b@example.invalid'}),
  stop('demo-station','16:00','京都車站','Kyoto Station',30,'交通','在「我的旅行」建立你自己的空白旅行。', {mode:'transit'})
 ]});
 return cleanState({version:DEMO_VERSION,trips:[{trip,days,previous:null,revision:0,deletedAt:null,mutationId:'',creators:{}}]});
}
