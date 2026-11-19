const fs=require('fs');
const path=require('path');

function localPath(url){
  if(!url || /^data:/i.test(String(url))) return null;
  const raw=String(url);
  if(/^https?:\/\//i.test(raw)) return null;
  const p=path.join(__dirname,'..','..',raw.replace(/^\//,''));
  return fs.existsSync(p)?p:null;
}

function source(url){
  if(!url) return null;
  if(Buffer.isBuffer(url))return url;
  const value=String(url);
  if(/^data:image\/(png|jpe?g|webp);base64,/i.test(value)){
    try{return Buffer.from(value.split(',',2)[1],'base64');}catch{return null;}
  }
  return localPath(value);
}

function dataUrl(buffer,mime){
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function fetchHostedSource(url){
  const raw=String(url||'').trim();
  if(!/^https?:\/\//i.test(raw))return null;
  try{
    const response=await fetch(raw,{redirect:'follow',headers:{'User-Agent':'PRO-MARK-Document-Renderer'}});
    if(!response.ok)return null;
    const contentType=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!/^image\/(png|jpe?g|webp)$/i.test(contentType))return null;
    const buffer=Buffer.from(await response.arrayBuffer());
    return buffer.length?buffer:null;
  }catch{return null;}
}

module.exports={localPath,source,dataUrl,fetchHostedSource};
