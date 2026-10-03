const decode=part=>Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const jsonPart=part=>JSON.parse(new TextDecoder().decode(decode(part)));
// Validate the signed assertion, not a caller-supplied identity header.
export async function verifyAccess(token,{issuer,audience,email},getKeys,now=Date.now()/1000){
 try{
  if(!token||token.length>16384)return null;
  const parts=token.split('.');if(parts.length!==3)return null;
  const header=jsonPart(parts[0]),claims=jsonPart(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string')return null;
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==issuer||!audiences.includes(audience)||typeof claims.email!=='string'||claims.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)||(email&&claims.email.toLowerCase()!==email.toLowerCase())||typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now)))return null;
  const keys=await getKeys(header.kid);const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)return null;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  return valid?{email:claims.email.toLowerCase(),sub:claims.sub}:null;
 }catch{return null;}
}
