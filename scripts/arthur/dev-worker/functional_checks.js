'use strict';

const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

const SITE_CHECKS=Object.freeze([
  {id:'amursk-home-content',origin:'https://amurskmarket.ru',route:'/',markers:['Ампер, Вентиль, Метиз Маркет и Миска','Бонусная']},
  {id:'amursk-miska-content',origin:'https://amurskmarket.ru',route:'/miska/',markers:['Миска','зоомагазин']},
  {id:'amursk-bonus-content',origin:'https://amurskmarket.ru',route:'/bonus/',markers:['Бонусная программа']},
  {id:'amursk-sitemap-content',origin:'https://amurskmarket.ru',route:'/sitemap.xml',markers:['urlset','amurskmarket.ru']},
  {id:'vozdooh-home-content',origin:'https://vozdooh27.ru',route:'/',markers:['VOZDOOH']},
  {id:'vozdooh-catalog-content',origin:'https://vozdooh27.ru',route:'/catalog',markers:['Каталог','VOZDOOH']},
  {id:'vozdooh-cart-content',origin:'https://vozdooh27.ru',route:'/cart',markers:['Корзина','VOZDOOH']},
  {id:'vozdooh-checkout-page',origin:'https://vozdooh27.ru',route:'/checkout',markers:['Оформление заказа','VOZDOOH']},
  {id:'vozdooh-api-health',origin:'https://vozdooh27.ru',route:'/api/health',jsonStatus:'ok'},
]);

const DOCKER_CHECKS=Object.freeze([
  {id:'business-kpi-storage',container:'business-kpi-local-web',port:3220,route:'/health',verify:'kpi-storage'},
  {id:'business-kpi-auth-enforced',container:'business-kpi-local-web',port:3220,route:'/api/business-kpi/dashboard',verify:'auth-401'},
  {id:'purchasing-http-contract',container:'purchasing-web-backend',port:3210,route:'/api/v1/health',verify:'purchasing-health'},
  {id:'purchasing-owner-learning-read',container:'purchasing-web-backend',port:3210,route:'/api/v1/owner-learning/knowledge-health',verify:'purchasing-learning'},
]);

const MAX_RESPONSE_BYTES=600000;
const MAX_REPORTS=96;
const ACCEPTED_SITES=new Set(['https://amurskmarket.ru','https://vozdooh27.ru']);

async function checkWebsite(item,{fetchImpl=fetch}={}){
  if(!ACCEPTED_SITES.has(item.origin)||!item.route.startsWith('/')||item.route.startsWith('//')){
    throw new Error('Only registered public website checks allowed');
  }
  const url=new URL(item.route,item.origin);
  if(url.origin!==item.origin)throw new Error('Non-allowlisted origin');
  try{
    const response=await fetchImpl(url.href,{
      method:'GET',credentials:'omit',redirect:'manual',
      signal:AbortSignal.timeout(10000),
      headers:{Accept:'text/html,application/json,application/xml,text/plain'},
    });
    if(response.status!==200)return {id:item.id,status:'degraded',reason:'UNEXPECTED_HTTP',httpStatus:response.status};
    const length=Number(response.headers?.get('content-length')||'0');
    if(length>MAX_RESPONSE_BYTES)return {id:item.id,status:'not_checked',reason:'RESPONSE_TOO_LARGE'};
    const body=await response.text();
    if(body.length>MAX_RESPONSE_BYTES)return {id:item.id,status:'not_checked',reason:'RESPONSE_TOO_LARGE'};
    let correct=false;
    if(item.jsonStatus){
      try {correct=JSON.parse(body)?.status===item.jsonStatus;} catch {}
    }else{
      correct=item.markers.every(x=>body.toLowerCase().includes(x.toLowerCase()));
    }
    return {id:item.id,status:correct?'healthy':'degraded',
      reason:correct?null:'CONTENT_CONTRACT_FAILED',httpStatus:response.status};
  }catch(e){
    return {id:item.id,status:'degraded',reason:'REQUEST_FAILED',errorType:e?.name||'Error'};
  }
}

// Static probe source runs exclusively in the registered local Docker container.
// No credentials are injected. No body or customer data is printed.
const PROBE_SOURCE=String.raw`
const [port,route,verify]=process.argv.slice(1);
(async()=>{
 const response=await fetch('http://127.0.0.1:'+port+route,{
   method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000)
 });
 let valid=false;
 if(verify==='auth-401'){
   valid=response.status===401;
 } else if(response.status===200){
   const j=await response.json();
   const d=j?.data;
   if(verify==='kpi-storage'){
     valid=d?.status==='ok'&&d?.storage?.provider==='postgresql'
       &&d?.storage?.checked===true&&d?.storage?.healthy===true
       &&d?.mode==='AUTH_REQUIRED';
   }else if(verify==='purchasing-health'){
     valid=d?.status==='ok'&&d?.service==='purchasing-web';
     if(valid){
       // Health endpoint alone can stay green while the Windows bind mount
       // returns EIO. Inspect the actual mounted directory in the SAME
       // purchasing container. Never print file names or contents.
       try{
         const fs=require('node:fs');
         const p=require('node:path');
         const dir='/app/data/purchasing';
         const names=fs.readdirSync(dir);
         if(names.length<1||names.length>2000)throw Error('INVALID_COUNT');
         let jsonCount=0,xlsxCount=0;
         for(const name of names){
           const file=p.join(dir,name);
           const stat=fs.lstatSync(file);
           if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50*1024*1024)
             throw Error('INVALID_FILE');
           const fd=fs.openSync(file,'r');
           const magic=Buffer.alloc(4);
           try{
             fs.readSync(fd,magic,0,4,0);
           }finally{
             fs.closeSync(fd);
           }
           if(name.toLowerCase().endsWith('.xlsx')){
             xlsxCount++;
             if(magic[0]!==0x50||magic[1]!==0x4b)throw Error('INVALID_XLSX');
           }else if(name.toLowerCase().endsWith('.json')){
             jsonCount++;
             JSON.parse(fs.readFileSync(file,'utf8'));
           }
         }
         valid=jsonCount>0&&xlsxCount>0;
       }catch{
         valid=false;
       }
     }
   }else if(verify==='purchasing-learning'){
     valid=d&&typeof d==='object'
       &&typeof d.status==='string'
       &&Array.isArray(d.findings);
   }
 }
 console.log(JSON.stringify({ok:valid,httpStatus:response.status}));
 if(!valid)process.exitCode=5;
})().catch(e=>{
 console.log(JSON.stringify({ok:false,reason:'PROBE_FAILED',errorType:e?.name||'Error'}));
 process.exitCode=6;
});
`;

function checkDockerFunction(item,{platform=process.platform,execFile=execFileSync}={}){
  if(platform!=='win32')return {id:item.id,status:'not_checked',reason:'DIFFERENT_HOST'};
  const allowed=DOCKER_CHECKS.some(x=>x===item);
  if(!allowed)throw new Error('Non-allowlisted Docker function check');
  try{
    const output=execFile('docker',[
      'exec',item.container,'node','-e',PROBE_SOURCE,
      String(item.port),item.route,item.verify,
    ],{encoding:'utf8',timeout:11000,maxBuffer:4096,windowsHide:true});
    const result=JSON.parse(output.trim());
    return {id:item.id,status:result.ok?'healthy':'degraded',
      reason:result.ok?null:'FUNCTION_CONTRACT_FAILED',
      httpStatus:result.httpStatus??null};
  }catch(e){
    return {id:item.id,status:'degraded',reason:'LOCAL_PROBE_FAILED',
      errorType:e?.name||'Error'};
  }
}

async function functionalSnapshot({now=()=>new Date(),fetchImpl=fetch,
    execFile=execFileSync,platform=process.platform}={}){
  const checks=[];
  for(const item of SITE_CHECKS)checks.push(await checkWebsite(item,{fetchImpl}));
  for(const item of DOCKER_CHECKS)checks.push(checkDockerFunction(item,{platform,execFile}));
  return {
    schemaVersion:1,timestamp:now().toISOString(),
    status:checks.some(x=>x.status==='degraded')?'degraded':
      checks.some(x=>x.status==='not_checked')?'partial':'healthy',
    checked:checks.filter(x=>x.status!=='not_checked').length,
    notChecked:checks.filter(x=>x.status==='not_checked').length,
    checks,
    // These are intentionally NOT asserted by anonymous functional checks.
    notTested:['live-checkout-and-payment','purchasing-order-creation',
      'customer-emails','1c-sync','sales-figures-and-freshness'],
  };
}

function storeSnapshot(report,{directory,fsImpl=fs}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    throw new Error('Absolute report directory required');
  fsImpl.mkdirSync(directory,{recursive:true});
  const filename='functional-'+report.timestamp.replace(/[:.]/g,'-')+'.json';
  const full=path.join(directory,filename);
  fsImpl.writeFileSync(full,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  const files=fsImpl.readdirSync(directory).filter(x=>
    /^functional-\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.json$/.test(x)).sort();
  for(const old of files.slice(0,Math.max(0,files.length-MAX_REPORTS))){
    fsImpl.unlinkSync(path.join(directory,old));
  }
  return full;
}

module.exports={
  SITE_CHECKS,DOCKER_CHECKS,checkWebsite,checkDockerFunction,
  functionalSnapshot,storeSnapshot,MAX_REPORTS,PROBE_SOURCE,
};
