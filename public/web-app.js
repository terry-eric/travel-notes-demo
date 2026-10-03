// Installation uses the browser's own prompt. Local snapshots accelerate display;
// identity and permissions still require a live authenticated session.
const button=document.getElementById('install-app');
const dialog=document.getElementById('install-dialog');
const feedback=document.getElementById('install-feedback');
const installNow=document.getElementById('install-now');
const standalone=window.matchMedia('(display-mode: standalone)');
let installPrompt=null;
const installed=()=>{button.hidden=standalone.matches||navigator.standalone===true;};
installed();standalone.addEventListener('change',installed);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installNow.hidden=false;});
window.addEventListener('appinstalled',()=>{installPrompt=null;button.hidden=true;if(dialog.open)dialog.close();});
button.addEventListener('click',()=>{
 button.closest('details').open=false;
 feedback.textContent='';installNow.hidden=!installPrompt;dialog.showModal();
});
installNow.addEventListener('click',async()=>{
 if(!installPrompt)return;
 const prompt=installPrompt;installPrompt=null;installNow.hidden=true;
 try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')dialog.close();}
 catch{feedback.textContent='請從瀏覽器選單選擇安裝，或依上方方式加入主畫面。';}
});
document.getElementById('install-close').addEventListener('click',()=>dialog.close());
// On-screen keyboards resize the visual viewport even when the layout viewport
// stays tall. Keep dialog scrolling and the save footer above the keyboard.
function visibleHeight(){
 if(window.visualViewport?.scale!==1)return;
 document.documentElement.style.setProperty('--visible-height',`${window.visualViewport.height}px`);
}
if(window.visualViewport){visibleHeight();window.visualViewport.addEventListener('resize',visibleHeight);}
