'use strict';

// Read-only KPI data coverage. Runs inside the existing Arthur Gateway container
// to reuse its already-provisioned service account, without exporting API secrets.

const ALLOWED_STATUS=new Set(['COMPLETE','PARTIAL','NO_DATA']);
const MAX_STORES=24;
function periodParts(now=new Date()){
 const f=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Vladivostok',year:'numeric',month:'2-digit',day:'2-digit'
 });
 const parts=f.formatToParts(now);
 const get=t=>parts.find(x=>x.type===t).value;
 return {year:Number(get('year')),month:Number(get('month')),date:get('year')+'-'+get('month')+'-'+get('day')};
}
function shortError(e){return String(e?.code||e?.name||'UNAVAILABLE').replace(/[^A-Z0-9_]/g,'').slice(0,60)}
async function audit({client,now=new Date(),storeId}={}){
 if(!client||!storeId)throw Error('KPI_AUDIT_NOT_CONFIGURED');
 const period=periodParts(now);
 const ref=await client.getReferenceData(storeId);
 const stores=ref?.stores;
 if(!Array.isArray(stores)||stores.length===0||stores.length>MAX_STORES)throw Error('KPI_STORE_LIST_INVALID');
 const seen=new Set(),items=[];
 for(const store of stores){
  const id=store?.id;
  if(typeof id!=='string'||!id||id.length>80||seen.has(id))throw Error('KPI_STORE_ID_INVALID');
  seen.add(id);
  const row={
   store:String(store.name||store.code||'').slice(0,75),
   monthlyDataStatus:'UNAVAILABLE',
   monthlyShifts:null,monthRevenuePresent:false,monthQrPresent:false,
   todayShifts:null,importRecords:null,
  };
  try{
    const [month,today,imports]=await Promise.all([
      client.getDashboard({storeId:id,year:period.year,month:period.month}),
      client.getToday({storeId:id}),
      client.getImports(id),
    ]);
    const m=month?.month;
    row.monthlyDataStatus=ALLOWED_STATUS.has(m?.dataStatus)?m.dataStatus:'UNKNOWN';
    row.monthlyShifts=Number.isSafeInteger(m?.shiftsCount)?m.shiftsCount:null;
    row.monthRevenuePresent=Number.isFinite(m?.revenue);
    row.monthQrPresent=Number.isFinite(m?.qrShare);
    row.todayShifts=Array.isArray(today?.shifts)?today.shifts.length:null;
    row.importRecords=Array.isArray(imports?.items)?imports.items.length:null;
  }catch(e){row.error=shortError(e);}
  items.push(row);
 }
 const statuses={
  complete:items.filter(x=>x.monthlyDataStatus==='COMPLETE').length,
  partial:items.filter(x=>x.monthlyDataStatus==='PARTIAL').length,
  noData:items.filter(x=>x.monthlyDataStatus==='NO_DATA').length,
  unavailable:items.filter(x=>!ALLOWED_STATUS.has(x.monthlyDataStatus)).length,
 };
 return {schemaVersion:1,checkedAt:now.toISOString(),period:period.date,
   state:statuses.unavailable?'not_checked':
     (statuses.partial||statuses.noData)?'attention':'complete',
   stores:items,totals:statuses,
   notes:[
     'Monthly completeness describes business data coverage, not whether shops were open.',
     'No write requests or reconciliation to 1C were made.',
     'No revenue amounts, service credentials, employees or personal data are included.',
   ]};
}
async function main(){
 try{
  const {loadConfig}=require('./agents/arthur-v1/telegram/config');
  const {BusinessKpiClient}=require('./agents/arthur-v1/skills/business_kpi/business_kpi_client');
  const c=loadConfig();
  if(!c.businessKpi?.enabled)throw Error('KPI_BUSINESS_API_NOT_ENABLED');
  const client=new BusinessKpiClient({
   baseUrl:c.businessKpi.baseUrl,
   serviceKeys:c.businessKpi.serviceKeys,
   serviceId:c.businessKpi.serviceId,
   maxRetries:0,timeoutMs:7500,
  });
  const report=await audit({client,storeId:process.env.BUSINESS_KPI_DEFAULT_STORE_ID});
  console.log(JSON.stringify(report));
 }catch(e){
  console.log(JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),
   state:'not_checked',error:shortError(e)}));
  process.exitCode=2;
 }
}
if(require.main===module||process.argv[1]==='-')main();
module.exports={audit,periodParts};
