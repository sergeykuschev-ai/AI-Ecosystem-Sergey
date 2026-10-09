'use strict';

const { execFileSync } = require('node:child_process');
const { PROJECTS } = require('./projects');

const MAX_PUBLIC_TIMEOUT_MS = 10000;
const ALLOWED_HOSTS = new Set(['amurskmarket.ru','vozdooh27.ru']);

function chooseProjects(selection='all') {
  if(selection==='all') return Object.values(PROJECTS);
  if(!Object.hasOwn(PROJECTS,selection)){
    throw new Error('Unknown registered project: '+String(selection).slice(0,64));
  }
  return [PROJECTS[selection]];
}

function safePublicUrl(project, route) {
  if(project.kind!=='public-site') throw new TypeError('Not a public-site project');
  if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||route.includes('\\')){
    throw new Error('Disallowed project path');
  }
  const url=new URL(route,project.origin);
  if(url.protocol!=='https:'||!ALLOWED_HOSTS.has(url.hostname)
     ||url.origin!==project.origin ||url.username ||url.password){
    throw new Error('Public health checks must use registered project origins');
  }
  return url;
}

async function checkSite(project, {fetchImpl=fetch,timeoutMs=MAX_PUBLIC_TIMEOUT_MS}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>MAX_PUBLIC_TIMEOUT_MS){
    throw new Error('Timeout outside allowed range');
  }
  const checks=[];
  for(const target of project.checks){
    const url=safePublicUrl(project,target.path);
    const started=Date.now();
    try{
      const response=await fetchImpl(url.href,{
        method:'GET',redirect:'manual',credentials:'omit',
        signal:AbortSignal.timeout(timeoutMs),
        headers:{'Accept':'text/html,application/json,text/plain,application/xml'},
      });
      let ok=response.status===target.expect;
      let problem=ok?null:'UNEXPECTED_HTTP_STATUS';
      if(ok&&target.jsonStatus){
        const body=await response.json();
        ok=body?.status===target.jsonStatus;
        if(!ok)problem='UNEXPECTED_HEALTH_PAYLOAD';
      }
      checks.push({
        check:target.path,status:ok?'pass':'fail',
        httpStatus:response.status,problem,
        durationMs:Math.max(0,Date.now()-started),
      });
    }catch(error){
      // Error classes only: a fetch error can include URLs with private tokens.
      checks.push({
        check:target.path,status:'fail',
        httpStatus:null,problem:'REQUEST_FAILED',
        errorType:error?.name||'Error',
        durationMs:Math.max(0,Date.now()-started),
      });
    }
  }
  return {project:project.id,host:project.host,kind:project.kind,
    status:checks.every(c=>c.status==='pass')?'healthy':'degraded',checks};
}

function parseDockerState(text){
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||typeof value.Running!=='boolean'){
    throw new Error('Unexpected Docker inspect response');
  }
  return {running:value.Running,health:value.Health?.Status??null};
}

function checkDocker(project,{platform=process.platform,execFile=execFileSync}={}){
  if(platform!=='win32'){
    return {project:project.id,host:project.host,kind:project.kind,
      status:'not_checked',reason:'DOCKER_SERVICE_ON_DIFFERENT_HOST',checks:[]};
  }
  const start=Date.now();
  try{
    const raw=execFile('docker',['inspect',project.container,
      '--format','{{json .State}}'],{
        encoding:'utf8',timeout:8000,maxBuffer:16384,windowsHide:true,
      });
    const state=parseDockerState(raw.trim());
    const ok=state.running&&(state.health===null||state.health==='healthy');
    return {project:project.id,host:project.host,kind:project.kind,
      status:ok?'healthy':'degraded',
      checks:[{check:'docker:state',status:ok?'pass':'fail',
        problem:ok?null:'CONTAINER_NOT_HEALTHY',running:state.running,
        health:state.health,durationMs:Date.now()-start}]};
  }catch(e){
    return {project:project.id,host:project.host,kind:project.kind,
      status:'degraded',
      checks:[{check:'docker:state',status:'fail',
        problem:'DOCKER_INSPECT_UNAVAILABLE',errorType:e?.name||'Error'}]};
  }
}

async function inspectProject(project,options={}){
  if(project.kind==='public-site')return checkSite(project,options);
  if(project.kind==='docker-local')return checkDocker(project,options);
  throw new Error('Unknown project kind');
}

async function runChecks({selection='all',now=()=>new Date(),...options}={}){
  const projects=chooseProjects(selection),results=[];
  for(const project of projects){
    results.push(await inspectProject(project,options));
  }
  const degraded=results.some(p=>p.status==='degraded');
  const notChecked=results.some(p=>p.status==='not_checked');
  const checked=results.filter(p=>p.status!=='not_checked');
  return {
    schemaVersion:1,
    timestamp:now().toISOString(),
    status:degraded?'degraded':notChecked?'partial':'healthy',
    checkedProjects:checked.length,notCheckedProjects:results.length-checked.length,
    results,
  };
}

// Only check is allowed. No deploy, write, shell or database mutations.
function supportedAction(action){
  if(action!=='check') throw new Error('Only read-only check is supported by Dev Worker v1');
  return action;
}

module.exports={
  PROJECTS,chooseProjects,safePublicUrl,checkSite,parseDockerState,
  checkDocker,inspectProject,runChecks,supportedAction,
};
