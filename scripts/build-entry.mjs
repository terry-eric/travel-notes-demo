import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Forks can change this fixed destination after deploying their own service.
export const liveAppUrl='https://demo.terry878.org/trip';
export const entryOutput=path.resolve(root,'_pages');

export function buildEntry(){
 if(entryOutput!==path.join(root,'_pages'))throw Error('Invalid Pages output path');
 // A separate output keeps the optional local demo completely out of Pages.
 if(fs.existsSync(entryOutput)&&fs.lstatSync(entryOutput).isSymbolicLink())throw Error('Pages output must be a local directory');
 fs.mkdirSync(entryOutput,{recursive:true});
 for(const name of fs.readdirSync(entryOutput)){
  const target=path.resolve(entryOutput,name);
  if(path.dirname(target)!==entryOutput)throw Error('Invalid Pages output entry');
  fs.rmSync(target,{recursive:true,force:true});
 }
 const html=`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="1;url=${liveAppUrl}">
<link rel="canonical" href="${liveAppUrl}">
<meta name="description" content="旅手帖：登入後建立私人旅行，並邀請同行的人。">
<title>旅手帖 · 開啟我的旅行</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#28423d;background:#f3f5ef}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:440px;padding:36px;border:1px solid #d8e1d4;border-radius:20px;background:#fff}
h1{margin:0 0 12px;font-size:28px}p{margin:0 0 24px;line-height:1.8}
a{display:block;padding:14px 18px;border-radius:10px;background:#315c4e;color:#fff;text-align:center;text-decoration:none;font-weight:600}
a:focus-visible{outline:3px solid #ab802c;outline-offset:4px}small{display:block;margin-top:16px;line-height:1.7;color:#667972}
@media(max-width:480px){main{padding:28px 24px}}
</style>
</head>
<body><main>
<h1>旅手帖</h1>
<p>登入後建立私人旅行，並邀請同行的人。</p>
<a href="${liveAppUrl}">開啟我的旅行</a>
<small>即將前往 demo.terry878.org/trip。若沒有自動開啟，請點上方按鈕。</small>
</main></body>
</html>
`;
 for(const name of ['index.html','404.html'])fs.writeFileSync(path.join(entryOutput,name),html);
 fs.writeFileSync(path.join(entryOutput,'.nojekyll'),'');
 return entryOutput;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Live service entry: '+buildEntry());
