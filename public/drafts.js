export function createDraftStore(storage,key){
 let failed=false;
 return {
  read(){try{const draft=JSON.parse(storage.getItem(key)||'null');return draft?.version===1?draft:null;}catch{return null;}},
  write(value){try{storage.setItem(key,JSON.stringify({...value,version:1,updatedAt:Date.now()}));failed=false;return true;}catch{failed=true;return false;}},
  clear(){try{storage.removeItem(key);failed=false;return true;}catch{failed=true;return false;}},
  get failed(){return failed;}
 };
}
