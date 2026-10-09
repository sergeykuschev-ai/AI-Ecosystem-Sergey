'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {audit,periodParts}=require('./arthur-kpi-coverage-observer.cjs');
const time=new Date('2026-10-09T08:30:00.000Z');
function client(conditions){
 const shops=['Ампер','Вентиль','Метиз Маркет','Миска'];
 return {
  async getReferenceData(){return {stores:shops.map((name,i)=>({id:'s'+i,name}))}},
  async getDashboard({storeId,year,month}){
   assert.equal(year,2026);assert.equal(month,10);
   const index=Number(storeId.slice(1)),c=conditions[index];
   if(c==='ERR')throw Object.assign(new Error('password=secret'),{code:'KPI_TIMEOUT'});
   return {month:{dataStatus:c,shiftsCount:c==='NO_DATA'?0:9,
    revenue:c==='NO_DATA'?0:1234,qrShare:c==='NO_DATA'?null:.17}};
  },
  async getToday({storeId}){
   return {shifts:storeId==='s2'?[]:[{id:'test'}]};
  },
  async getImports(storeId){
   return {items:storeId==='s3'?[{},{}]:[]};
  }
 };
}
test('date computed in Amursk timezone, not server UTC',()=>{
 assert.deepEqual(periodParts(new Date('2026-10-08T18:00:00Z')),
  {year:2026,month:10,date:'2026-10-09'});
});
test('reports COMPLETE, PARTIAL and NO_DATA distinctly without revenue values',async()=>{
 const r=await audit({client:client(['PARTIAL','PARTIAL','NO_DATA','COMPLETE']),storeId:'s3',now:time});
 assert.equal(r.state,'attention');assert.equal(r.totals.complete,1);
 assert.equal(r.totals.partial,2);assert.equal(r.totals.noData,1);
 assert.equal(r.stores[2].monthlyShifts,0);
 assert.equal(r.stores[3].importRecords,2);
 assert.doesNotMatch(JSON.stringify(r),/1234|password|secret/);
});
test('inaccessible shop remains not_checked and never masquerades as healthy',async()=>{
 const r=await audit({client:client(['COMPLETE','ERR','NO_DATA','COMPLETE']),storeId:'s3',now:time});
 assert.equal(r.state,'not_checked');
 assert.equal(r.totals.unavailable,1);
 assert.equal(r.stores[1].error,'KPI_TIMEOUT');
 assert.doesNotMatch(JSON.stringify(r),/password=secret/);
});
test('reject empty or duplicated store list',async()=>{
 await assert.rejects(()=>audit({storeId:'s',client:{getReferenceData:async()=>({stores:[]})}}),/LIST_INVALID/);
 await assert.rejects(()=>audit({storeId:'s',client:{getReferenceData:async()=>({stores:[{id:'a'},{id:'a'}]})}}),/ID_INVALID/);
});
