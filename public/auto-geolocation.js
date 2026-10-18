import {getStopCoordinates,normalizeCoordinates} from './map-coordinates.js';

export function getLocationQuery(stop){
 if(!stop||typeof stop!=='object')return '';
 return typeof stop.routeQuery==='string'&&stop.routeQuery.trim()?stop.routeQuery.trim():typeof stop.q==='string'?stop.q.trim():'';
}

// The account owns this Map in the caller. A place edit or trip switch changes
// its key, so an old asynchronous reply cannot move a different destination.
export function geocodeStopKey(tripId,stop){
 return JSON.stringify([String(tripId??''),String(stop?.id??''),getLocationQuery(stop),typeof stop?.mapUrl==='string'?stop.mapUrl.trim():'']);
}

export function knownStopPoint(stop,stops=[]){
 const own=getStopCoordinates(stop);if(own)return own;
 const query=getLocationQuery(stop),url=typeof stop?.mapUrl==='string'?stop.mapUrl.trim():'';
 const points=(Array.isArray(stops)?stops:[]).filter(peer=>peer!==stop&&((query&&getLocationQuery(peer)===query)||(url&&peer?.mapUrl?.trim()===url))).map(getStopCoordinates).filter(Boolean);
 if(!points.length)return null;
 // Conflicting saved pins for the same text are not evidence of a unique place.
 const point=points[0];return points.every(other=>Math.abs(point.lat-other.lat)<0.000001&&Math.abs(point.lng-other.lng)<0.000001)?point:null;
}

export function applyGeocodeOverlay(days,results,tripId){
 const next=structuredClone(Array.isArray(days)?days:[]);
 for(const day of next)for(const stop of day.stops||[]){
  if(getStopCoordinates(stop))continue;
  const result=results?.get?.(geocodeStopKey(tripId,stop));
  const point=result?.status==='resolved'?normalizeCoordinates(result.coordinates):null;
  if(point)stop.coordinates=point;
 }
 return next;
}
