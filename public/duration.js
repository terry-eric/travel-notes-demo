export function durationParts(value){
 if(!Number.isInteger(value)||value<0||value>1440)return {hours:'',minutes:0};
 return {hours:Math.floor(value/60),minutes:value%60};
}
export function durationMinutes(hours,minutes){
 if(hours==='')return undefined;
 const h=Number(hours),m=Number(minutes),total=h*60+m;
 if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>24||m<0||m>=60||total>1440)throw Error('停留時間需介於 0 分鐘與 24 小時。');
 return total;
}
export function formatDuration(value){
 const {hours,minutes}=durationParts(value);
 if(hours==='')return '未設定';
 return [hours?hours+' 小時':'',minutes||!hours?minutes+' 分鐘':''].filter(Boolean).join(' ');
}
