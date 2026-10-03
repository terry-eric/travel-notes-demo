'use strict';
// Fictional five-day fixture for local previews and API tests. These dates,
// reservations and times do not describe anyone's actual travel plans.
export const seedDays = [
 {date:'11/11',week:'週三',color:'#a66b4f',tint:'#f5ebe4',title:'初見台北',sub:'虛構範例・城市散步',intro:'用公開景點示範如何安排旅行。所有時間與預約皆為虛構，請自行調整。',tip:'此行程僅供功能展示；交通、營業時間及活動內容請另行確認。',stops:[
  {time:'依航班',name:'桃園機場 → 台北',q:'臺灣桃園國際機場',tag:'抵達',desc:'示範機場抵達項目；依自己的交通安排調整。'},
  {time:'下午',name:'台北車站周邊休息',q:'臺北車站',tag:'休息',desc:'示範保留一段休息時間。',mode:'transit'},
  {time:'下午',name:'臺北植物園',q:'臺北植物園',tag:'散步',desc:'公開景點範例，實際參觀時間請依當日公告。'},
  {time:'傍晚',name:'中正紀念堂廣場',q:'中正紀念堂 臺北',tag:'城市風景',desc:'示範市區散步項目。'},
  {time:'晚餐',name:'永康街周邊用餐',q:'永康街 臺北',tag:'用餐',desc:'示範以街區搜尋餐廳，未指定店家或預約。'},
  {time:'有餘裕再去',name:'大安森林公園',q:'大安森林公園',tag:'彈性備案',desc:'示範可依天候或體力刪減的備案。',mode:'transit'}]},
 {date:'11/12',week:'週四',color:'#a67b28',tint:'#f7efdb',title:'沿河慢慢走',sub:'虛構範例・街區探索',intro:'以台北公開街區展示一天的排序與交通設定。',tip:'所列時間僅供測試排程，並非交通班次。',stops:[
  {time:'09:30',name:'北門站',q:'北門站 臺北',tag:'交通',desc:'示範從車站開始的散步行程。',from:'臺北車站',mode:'transit'},
  {time:'11:00',name:'迪化街周邊午餐',q:'迪化街 臺北',tag:'用餐',desc:'示範一般用餐項目，未指定店家。'},
  {time:'12:30',name:'大稻埕街區',q:'大稻埕 臺北',tag:'散步',desc:'公開街區範例。'},
  {time:'13:30',name:'霞海城隍廟周邊',q:'臺北霞海城隍廟',tag:'文化',desc:'示範文化景點項目。'},
  {time:'14:30',name:'延平河濱公園',q:'延平河濱公園 臺北',tag:'散步',desc:'示範沿河步行項目。'},
  {time:'16:00',name:'大稻埕碼頭',q:'大稻埕碼頭 臺北',tag:'黃昏散步',desc:'示範保留拍照與休息時間。'}]},
 {date:'11/13',week:'週五',color:'#698565',tint:'#eaf0e5',title:'藝文的一天',sub:'虛構範例・固定時間',intro:'以虛構劇場預約示範固定時間項目；此處不代表任何真實活動。',tip:'17:30 的劇場預約完全虛構，僅供編輯、匯入與排程測試。',stops:[
  {time:'10:00',name:'華山文創園區',q:'華山1914文化創意產業園區',tag:'文化',desc:'公開景點範例，展覽資訊請另行確認。'},
  {time:'12:00',name:'忠孝新生站周邊午餐',q:'忠孝新生站 臺北',tag:'用餐',desc:'示範以車站周邊搜尋餐廳。'},
  {time:'13:30',name:'中山街區散步',q:'中山站 臺北',tag:'散步',desc:'示範午後散步項目。',mode:'transit'},
  {time:'15:30',name:'自由休息時間',tag:'保留空白',desc:'示範不指定地點的休息項目。'},
  {time:'17:30 抵達',name:'虛構劇場預約（範例）',q:'國家戲劇院 臺北',tag:'固定預約',live:true,desc:'完全虛構的預約時間，並無真實演出或票券；展示固定時間如何保留。',mode:'transit'}]},
 {date:'11/14',week:'週六',color:'#7a7395',tint:'#eeeaf6',title:'展覽與城市風景',sub:'虛構範例・彈性安排',intro:'以公開景點和虛構導覽示範旅行安排。',tip:'18:00 的導覽時間為虛構範例，請勿視為真實場館活動。',stops:[
  {time:'09:00',name:'信義街區早餐',q:'信義區 臺北',tag:'早餐',desc:'示範街區用餐項目。'},
  {time:'10:30',name:'松山文創園區',q:'松山文創園區',tag:'文化',desc:'公開景點範例，展覽與開放時間請依場館公告。'},
  {time:'12:00',name:'午餐與自由時間',tag:'休息',desc:'示範保留可自由調整的空白時間。'},
  {time:'14:00',name:'市政府站周邊',q:'市政府站 臺北',tag:'交通',desc:'示範交通與市區移動項目，所列時間不是班次。',mode:'transit'},
  {time:'18:00 開始',name:'虛構城市導覽（範例）',q:'臺北市政府',tag:'固定預約',live:true,desc:'完全虛構的導覽與集合時間；此項目僅供功能展示。'}]},
 {date:'11/15',week:'週日',color:'#567f97',tint:'#e6f0f5',title:'留下旅行筆記',sub:'虛構範例・返程',intro:'最後一天以公開景點示範備案和返程提醒。',tip:'沒有真實航班、住宿或個人預約，請使用自己的資訊取代範例。',stops:[
  {time:'有空再去',name:'臺北孔廟',q:'臺北孔廟',tag:'彈性備案',desc:'公開景點範例，可依自己的時間省略。'},
  {time:'依航班',name:'台北車站周邊採買',q:'臺北車站',tag:'伴手禮',desc:'示範返程前的彈性採買項目。',mode:'transit'},
  {time:'出發前',name:'檢查隨身物品',tag:'返程準備',desc:'示範一般提醒，不含任何個人物品或住宿資訊。'},
  {time:'預留報到',name:'桃園國際機場',q:'臺灣桃園國際機場',tag:'返程',desc:'示範返程提醒；實際交通與報到時間請自行確認。',mode:'transit'}]}
];
for(const [dayIndex,day] of seedDays.entries())for(const [stopIndex,stop] of day.stops.entries()){stop.id=`seed-${dayIndex}-${stopIndex}`;stop.q??='';stop.mode??='walking';}
