'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  readLastTwoSnapshots,checkAndNotify,buildIncidentMessage,
}=require('../telegram/project_alert_notifier');

const ids=['amurskmarket','vozdooh','business-kpi','purchasing','arthur'];
function dirs(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-project-alert-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const reports=path.join(root,'reports'),state=path.join(root,'state');
  fs.mkdirSync(reports);fs.mkdirSync(state);
  return {root,reports,state};
}
function filename(timestamp){return 'health-'+timestamp.replace(/[:.]/g,'-')+'.json';}
function write(d,t,states={}){
  const data={
    schemaVersion:1,timestamp:t,
    checkedProjects:5,notCheckedProjects:0,status:'healthy',
    results:ids.map(project=>({project,status:states[project]||'healthy',checks:[]})),
  };
  const degraded=data.results.filter(x=>x.status==='degraded').length;
  if(degraded)data.status='degraded';
  fs.writeFileSync(path.join(d,filename(t)),JSON.stringify(data));
}
function transport(){
  const messages=[];
  return {messages,async sendMessage(chatId,text){messages.push({chatId,text});return {ok:true}}};
}

test('requires two distinct hourly failures before sending an owner-only notification',async t=>{
  const {reports,state}=dirs(t),telegram=transport();
  write(reports,'2026-10-09T07:00:00.000Z');
  write(reports,'2026-10-09T08:00:00.000Z',{vozdooh:'degraded'});
  const args={directory:reports,stateDirectory:state,chatId:'111',telegram,
    now:()=>new Date('2026-10-09T08:20:00.000Z')};
  let outcome=await checkAndNotify(args);
  assert.deepEqual(outcome.sent,[]);
  assert.equal(telegram.messages.length,0);
  write(reports,'2026-10-09T09:00:00.000Z',{vozdooh:'degraded'});
  args.now=()=>new Date('2026-10-09T09:10:00.000Z');
  outcome=await checkAndNotify(args);
  assert.deepEqual(outcome.sent,['vozdooh']);
  assert.equal(telegram.messages.length,1);
  assert.equal(telegram.messages[0].chatId,'111');
  assert.match(telegram.messages[0].text,/два|двух последовательных проверках/u);
  assert.match(telegram.messages[0].text,/vozdooh27.ru/);
  assert.doesNotMatch(telegram.messages[0].text,/https?:|secret|\/run\//i);
});

test('duplicate hourly polls and simulated gateway restart never repeat claimed incident',async t=>{
  const {reports,state}=dirs(t),telegram=transport();
  write(reports,'2026-10-09T07:00:00.000Z',{'business-kpi':'degraded'});
  write(reports,'2026-10-09T08:00:00.000Z',{'business-kpi':'degraded'});
  const config={directory:reports,stateDirectory:state,chatId:'111',telegram,
    now:()=>new Date('2026-10-09T08:15:00.000Z')};
  assert.deepEqual((await checkAndNotify(config)).sent,['business-kpi']);
  assert.deepEqual((await checkAndNotify(config)).sent,[]);
  assert.equal(telegram.messages.length,1);
  write(reports,'2026-10-09T09:00:00.000Z',{'business-kpi':'degraded'});
  config.now=()=>new Date('2026-10-09T09:15:00.000Z');
  assert.deepEqual((await checkAndNotify(config)).sent,[]);
  assert.equal(telegram.messages.length,1);
});

test('two distinct healthy checks rearm future incident',async t=>{
  const {reports,state}=dirs(t),telegram=transport();
  const data={'purchasing':'degraded'};
  write(reports,'2026-10-09T07:00:00.000Z',data);
  write(reports,'2026-10-09T08:00:00.000Z',data);
  const cfg={directory:reports,stateDirectory:state,chatId:'111',telegram,now:()=>new Date('2026-10-09T08:10:00.000Z')};
  assert.deepEqual((await checkAndNotify(cfg)).sent,['purchasing']);
  write(reports,'2026-10-09T09:00:00.000Z');
  cfg.now=()=>new Date('2026-10-09T09:10:00.000Z');
  assert.deepEqual((await checkAndNotify(cfg)).recovered,[]);
  write(reports,'2026-10-09T10:00:00.000Z');
  cfg.now=()=>new Date('2026-10-09T10:10:00.000Z');
  assert.deepEqual((await checkAndNotify(cfg)).recovered,['purchasing']);
  write(reports,'2026-10-09T11:00:00.000Z',data);
  cfg.now=()=>new Date('2026-10-09T11:10:00.000Z');
  assert.deepEqual((await checkAndNotify(cfg)).sent,[]);
  write(reports,'2026-10-09T12:00:00.000Z',data);
  cfg.now=()=>new Date('2026-10-09T12:10:00.000Z');
  assert.deepEqual((await checkAndNotify(cfg)).sent,['purchasing']);
  assert.equal(telegram.messages.length,2);
});

test('no alerts on stale, duplicated, too-close or partial samples',async t=>{
  const {reports,state}=dirs(t),telegram=transport();
  write(reports,'2026-10-09T07:00:00.000Z',{arthur:'degraded'});
  write(reports,'2026-10-09T07:10:00.000Z',{arthur:'degraded'});
  const cfg={directory:reports,stateDirectory:state,chatId:'111',telegram,
    now:()=>new Date('2026-10-09T07:15:00.000Z')};
  assert.equal((await checkAndNotify(cfg)).status,'not_checked');
  cfg.now=()=>new Date('2026-10-09T11:00:00.000Z');
  assert.equal((await checkAndNotify(cfg)).status,'not_checked');
  assert.equal(telegram.messages.length,0);
});

test('cannot send without a durable writable incident ledger',async t=>{
  const {reports,root}=dirs(t),telegram=transport();
  write(reports,'2026-10-09T07:00:00.000Z',{arthur:'degraded'});
  write(reports,'2026-10-09T08:00:00.000Z',{arthur:'degraded'});
  const cfg={directory:reports,stateDirectory:path.join(root,'missing'),chatId:'111',telegram,
    now:()=>new Date('2026-10-09T08:10:00.000Z')};
  await assert.rejects(()=>checkAndNotify(cfg),e=>e.code==='PROJECT_ALERT_STATE_UNAVAILABLE');
  assert.equal(telegram.messages.length,0);
});

test('ambiguous Telegram failure is not retried automatically after restart',async t=>{
  const {reports,state}=dirs(t);
  write(reports,'2026-10-09T07:00:00.000Z',{arthur:'degraded'});
  write(reports,'2026-10-09T08:00:00.000Z',{arthur:'degraded'});
  const unknown={
    async sendMessage(){throw new Error('network may have delivered message');},
  };
  const cfg={directory:reports,stateDirectory:state,chatId:'111',telegram:unknown,
    now:()=>new Date('2026-10-09T08:15:00.000Z')};
  const first=await checkAndNotify(cfg);
  assert.equal(first.status,'delivery_unknown');
  const safe=transport();cfg.telegram=safe;
  const second=await checkAndNotify(cfg);
  assert.deepEqual(second.sent,[]);
  assert.equal(safe.messages.length,0);
});

test('malformed report, missing owner and unknown project cannot send notifications',async t=>{
  const {reports,state}=dirs(t),telegram=transport();
  write(reports,'2026-10-09T07:00:00.000Z',{vozdooh:'degraded'});
  write(reports,'2026-10-09T08:00:00.000Z',{vozdooh:'degraded'});
  assert.throws(()=>buildIncidentMessage('../secret',[]),/Unregistered/);
  await assert.rejects(()=>checkAndNotify({
    directory:reports,stateDirectory:state,chatId:'',telegram,
  }),e=>e.code==='PROJECT_ALERTS_RECIPIENT_UNAVAILABLE');
  const newest=path.join(reports,filename('2026-10-09T08:00:00.000Z'));
  fs.writeFileSync(newest,'{"status":"healthy"}');
  const result=readLastTwoSnapshots({
    directory:reports,now:()=>new Date('2026-10-09T08:10:00.000Z'),
  });
  assert.equal(result.ready,false);
  assert.equal(telegram.messages.length,0);
});
