import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetNames} from './assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const demoOutput=path.join(root,'_site');
export function buildDemo(){
 // The destination is fixed inside this checkout; no backend or environment files enter it.
 fs.mkdirSync(demoOutput,{recursive:true});
 const expected=new Set([...assetNames,'demo','404.html','.nojekyll']);
 for(const entry of fs.readdirSync(demoOutput))if(!expected.has(entry))fs.rmSync(path.join(demoOutput,entry),{recursive:true,force:true});
 for(const name of assetNames){
  const source=path.join(root,'public',name),destination=path.join(demoOutput,name);
  if(name.endsWith('.png')){fs.copyFileSync(source,destination);continue;}
  let text=fs.readFileSync(source,'utf8');
  if(name==='index.html'){
   text=text.replace(/<script type="module" src="\/web-app.js"><\/script><script type="module" src="\/app.js"><\/script>/,'<link rel="stylesheet" href="./demo/style.css"><script type="module" src="./demo/bootstrap.js"></script>');
   text=text.replace(/(href|src)="\/(?!\/)/g,'$1="./').replace('crossorigin="use-credentials"','');
   text=text.replace('旅手帖：建立自己的旅行、邀請同行的人，一起安排每日行程與 Google Maps。','旅手帖公開示範：在此瀏覽器建立旅行與安排每日行程。').replace('<title>旅手帖 · 我的旅行</title>','<title>旅手帖 · 瀏覽器示範</title>');
   text=text.replace(/href="\.\/(trips|overview|daily|map|notes)"/g,'href="./index.html?page=$1"');
  }
  if(name==='manifest.webmanifest'){
   const manifest=JSON.parse(text);manifest.name='旅手帖 · 瀏覽器示範';manifest.description='示範資料只儲存在此瀏覽器。';manifest.start_url='./index.html?page=trips';text=JSON.stringify(manifest,null,2)+'\n';
  }
  if(name==='app.js'||name==='trip-manager.js'){
   text=text.replaceAll('雲端','此瀏覽器').replaceAll('其他裝置或同行者','其他分頁').replaceAll('其他裝置','其他分頁').replaceAll('其他人','其他分頁').replaceAll('同行者','示範使用者').replaceAll('已自動同步最新行程','已載入此瀏覽器最新行程').replaceAll('已與此瀏覽器同步 · 自動更新','已載入此瀏覽器 · 修改自動儲存').replaceAll('已儲存至此瀏覽器','已儲存至此瀏覽器').replaceAll('旅行已恢復，原本有效的示範使用者邀請也會恢復。','旅行已恢復。').replaceAll('安排每日行程，邀請同行的人一起規劃。','安排每日行程，試試編輯、排序與匯入。').replaceAll('建立自己的旅行，或開啟示範使用者邀請的旅行。','建立自己的旅行，所有修改只儲存在此瀏覽器。');
  }
  fs.writeFileSync(destination,text);
 }
 const demoDir=path.join(demoOutput,'demo');fs.mkdirSync(demoDir,{recursive:true});
 const demoFiles=['api.js','model.js','seed.js','bootstrap.js','style.css'];
 for(const entry of fs.readdirSync(demoDir))if(!demoFiles.includes(entry))fs.rmSync(path.join(demoDir,entry),{recursive:true,force:true});
 for(const name of demoFiles)fs.writeFileSync(path.join(demoDir,name),fs.readFileSync(path.join(root,'demo',name),'utf8').replaceAll("'../public/","'../"));
 fs.writeFileSync(path.join(demoOutput,'.nojekyll'),'');
 fs.writeFileSync(path.join(demoOutput,'404.html'),'<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旅手帖示範</title><p>此示範使用查詢參數導覽。<a href="./index.html?page=trips">開啟我的旅行</a></p></html>\n');
 return demoOutput;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Static browser demo: '+buildDemo());
