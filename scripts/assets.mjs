export const textAssetNames=['index.html','app.js','web-app.js','runtime.js','trip-manager.js','sharing.js','sync.js','identity.js','merge.js','drafts.js','cache.js','conflicts.js','reorder.js','import.js','gpt-import.js','import-review.js','maps-link.js','routes.js','transport.js','duration.js','tags.js','map-frame.js','cloud.js','style.css','responsive.css','trip-manager.css','stop-avatar.js','stop-avatar.css','manifest.webmanifest'];
textAssetNames.push('inline-transport.js','inline-transport.css','route-map.js','route-map.css','map-coordinates.js','flights.js','flights.css','day-names.js','day-names.css','planning.css','vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css','vendor/leaflet/LICENSE.txt');
export const binaryAssetNames=['icon-180.png','icon-192.png','icon-512.png',...['layers-2x.png','layers.png','marker-icon-2x.png','marker-icon.png','marker-shadow.png'].map(name=>'vendor/leaflet/images/'+name)];
export const assetNames=[...textAssetNames,...binaryAssetNames];
export function assetType(name){
 return name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.webmanifest')?'application/manifest+json; charset=utf-8':name.endsWith('.png')?'image/png':name.endsWith('.txt')?'text/plain; charset=utf-8':'text/html; charset=utf-8';
}
