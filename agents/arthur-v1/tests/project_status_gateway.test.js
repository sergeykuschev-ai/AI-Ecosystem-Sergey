'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createTelegramGateway}=require('../telegram/telegram_gateway');
const {loadConfig}=require('../telegram/config');

function makeGateway(projectStatusReader){
  const sent=[];
  let invokedArthur=0,calledReader=0;
  const config=loadConfig({
    TELEGRAM_BOT_TOKEN:'123456:fake-test-only-token-00000',
    TELEGRAM_ALLOWED_USER_IDS:'111111',
    ARTHUR_OWNER_PROFILE_ID:'test-owner',
    TELEGRAM_POLL_TIMEOUT_MS:'1000',
    TELEGRAM_API_TIMEOUT_MS:'2000',
    TELEGRAM_GATEWAY_HEALTH_PORT:'0',
  });
  const gateway=createTelegramGateway({
    config,
    logger:{info(){},warn(){},error(){},debug(){}},
    telegramClient:{
      async sendMessage(chatId,text){sent.push({chatId,text});return {ok:true}},
      async getUpdates(){return {result:[]}},
      async call(){return {ok:true}},
    },
    arthur:{async handle(){invokedArthur++;return {status:'success',answer:{text:'from ai'}}}},
    projectStatusReader:()=>{calledReader++;return projectStatusReader()},
    // The production process has a voice ASR URL. Bypass the unrelated real
    // downloader in these isolated command tests, while keeping auth handling.
    voiceTranscriber:{async transcribe(){return 'not used in text command tests';}},
  });
  const send=async(text,userId=111111)=>gateway.handleUpdate({
    update_id:100+sent.length,
    message:{message_id:100+sent.length,from:{id:userId},
      chat:{id:userId},text},
  });
  return {gateway,sent,send,
    calls:()=>({reader:calledReader,arthur:invokedArthur})};
}

test('allowed owner gets deterministic /projects report, no AI calls',async()=>{
  const f=makeGateway(()=> '✅ amurskmarket.ru — доступен');
  await f.send('/projects');
  assert.equal(f.sent.length,1);
  assert.match(f.sent[0].text,/amurskmarket.ru/);
  assert.deepEqual(f.calls(),{reader:1,arthur:0});
});
test('Russian phrase routes exactly to read-only monitor',async()=>{
  const f=makeGateway(()=> 'Статус пяти проектов');
  await f.send('Статус проектов');
  assert.match(f.sent[0].text,/пяти проектов/);
  assert.equal(f.calls().reader,1);
});
test('unapproved Telegram user cannot retrieve project report',async()=>{
  const f=makeGateway(()=> 'Sensitive business status');
  await f.send('/projects',999999);
  assert.match(f.sent[0].text,/Доступ запрещён/);
  assert.equal(f.calls().reader,0);
  assert.equal(f.calls().arthur,0);
});
test('/status and generic messages still use original handlers',async()=>{
  const f=makeGateway(()=> 'project data');
  await f.send('Обычное сообщение');
  assert.equal(f.calls().reader,0);
  assert.equal(f.calls().arthur,1);
});
test('command reader failure does not leak exception contents',async()=>{
  const f=makeGateway(()=>{throw new Error('C:\\secret\\token=private-value');});
  await f.send('/projects');
  assert.equal(f.sent.length,1);
  assert.doesNotMatch(f.sent[0].text,/private-value|C:\\secret/);
});
