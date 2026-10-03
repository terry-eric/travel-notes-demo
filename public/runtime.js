// The same frontend works at the original origin and under /trip on Cloudflare.
const moduleUrl=new URL(import.meta.url);
const configuredBase=globalThis.document?.querySelector?.('meta[name="trip-app-base"]')?.content;
export const appBase=typeof configuredBase==='string'&&(configuredBase===''||/^\/(?!\/)[^?#]*$/.test(configuredBase))?configuredBase.replace(/\/+$/,''):['http:','https:'].includes(moduleUrl.protocol)?moduleUrl.pathname.replace(/\/[^/]*$/,''):'';
// The static entry point installs the browser-only API before importing the app.
export const demoMode=globalThis.__TRAVEL_NOTES_DEMO__?.enabled===true;
export const apiPath=path=>appBase+path;
export const selectedTripId=new URL(globalThis.location?.href||'https://trip.example').searchParams.get('trip')||'';
export function tripApiPath(path,id=selectedTripId){
 const url=new URL(apiPath(path),'https://trip.example');if(id)url.searchParams.set('trip',id);
 return url.pathname+url.search;
}
