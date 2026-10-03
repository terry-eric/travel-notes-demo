const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const colours=[
 ['#e4eedf','#36533d'],['#e2edf6','#345776'],['#f3e5ea','#784357'],
 ['#f3eadf','#765738'],['#eee6f7','#65517d'],['#dff0eb','#315f53'],
];
const silhouette='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg>';

function creatorEmail(value){
 if(typeof value!=='string')return null;
 const email=value.trim().toLowerCase();
 if(!email||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\u0000-\u001f\u007f-\u009f]/.test(email))return null;
 return email;
}

/** Plain text for a containing card's accessible name; escape it at the HTML boundary. */
export function stopAvatarLabel(stop){
 if(stop?.live!==true)return '';
 const email=creatorEmail(stop.createdBy);
 return email?`新增者：${email.slice(0,email.indexOf('@'))}`:'固定時間行程，尚未記錄新增者';
}

/** Inert local initials identify the original creator only on fixed-time stops. */
export function renderStopAvatar(stop){
 if(stop?.live!==true)return '';
 const email=creatorEmail(stop.createdBy),label=escapeHtml(stopAvatarLabel(stop));
 if(!email){
  return `<span class="stop-avatar stop-avatar--unknown" role="img" aria-label="${label}" title="${label}">${silhouette}</span>`;
 }
 const name=email.slice(0,email.indexOf('@')),initial=Array.from(name)[0].toUpperCase();
 let hash=2166136261;
 for(const char of email)hash=Math.imul(hash^char.codePointAt(0),16777619)>>>0;
 const [background,foreground]=colours[hash%colours.length];
 return `<span class="stop-avatar" role="img" aria-label="${label}" title="${label}" style="--stop-avatar-bg:${background};--stop-avatar-fg:${foreground}"><span class="stop-avatar-letter" aria-hidden="true">${escapeHtml(initial)}</span></span>`;
}
