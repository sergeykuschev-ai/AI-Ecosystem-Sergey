'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTelegramGateway}=require('../telegram/telegram_gateway');
const {loadConfig}=require('../telegram/config');

function fixture({menuEnabled=true}={}){
  const calls=[],sent=[],handled=[];
  const client={
    async sendMessage(chatId,text,opts){sent.push({chatId,text,opts});return {ok:true}},
    async call(method,payload){calls.push({method,payload});return {ok:true}},
    proxyEnabled:false,
  };
  const arthur={
    async handle(request){handled.push(request.message);return {
      status:'success',answer:{text:'Answer to: '+request.message}}},
    async getDiagnostics(){return {provider:'fake',status:'healthy',models:{fast:'example'}}},
  };
  const config=loadConfig({
    TELEGRAM_BOT_TOKEN:'123:test',
    TELEGRAM_ALLOWED_USER_IDS:'111',
    ARTHUR_OWNER_PROFILE_ID:'owner',
  });
  const logger={info(){},warn(){},error(){}};
  const gateway=createTelegramGateway({
    config,telegramClient:client,arthur,logger,ownerMenuEnabled:menuEnabled,
  });
  return {gateway,client,calls,sent,handled};
}
function msg(text,from=111,chat=111){
 return {update_id:50,message:{message_id:7,from:{id:from},chat:{id:chat},text}};
}
function callback(data,from=111,chat=111){
 return {update_id:60,callback_query:{id:'cb-id',data,from:{id:from},
   message:{message_id:8,chat:{id:chat}}}};
}

test('menu disabled by default leaves /menu and callbacks to original path',async()=>{
 const f=fixture({menuEnabled:false});
 await f.gateway.handleUpdate(msg('/menu'));
 assert.deepEqual(f.handled,['/menu']);
 await f.gateway.handleUpdate(callback('om1:root'));
 assert.equal(f.calls.length,0);
 assert.equal(f.sent.length,1);
});


test('start displays persistent menu to owner in private chat only when enabled',async()=>{
 const enabled=fixture();
 await enabled.gateway.handleUpdate(msg('/start'));
 assert.match(enabled.sent[0].text,/Привет, я Артур/);
 assert.equal(enabled.sent[0].opts.replyMarkup.keyboard.length,4);
 const disabled=fixture({menuEnabled:false});
 await disabled.gateway.handleUpdate(msg('/start'));
 assert.match(disabled.sent[0].text,/Привет, я Артур/);
 assert.deepEqual(disabled.sent[0].opts,{});
 const group=fixture();
 await group.gateway.handleUpdate(msg('/start',111,-100));
 assert.match(group.sent[0].text,/Привет, я Артур/);
 assert.deepEqual(group.sent[0].opts,{});
});

test('ordinary /help never changes existing menu/command behavior',async()=>{
 const f=fixture();
 await f.gateway.handleUpdate(msg('/help'));
 assert.match(f.sent[0].text,/Привет, я Артур/);
 assert.deepEqual(f.sent[0].opts,{});
 assert.equal(f.handled.length,0);
});

test('enabled menu shows owner keyboard and routes tasks through existing Arthur',async()=>{
 const f=fixture();
 await f.gateway.handleUpdate(msg('/menu'));
 assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].opts.replyMarkup.keyboard.length,4);
 await f.gateway.handleUpdate(msg('📋 Задачи'));
 assert.deepEqual(f.handled,['Что у меня по задачам?']);
 assert.match(f.sent[1].text,/Что у меня по задачам/);
 await f.gateway.handleUpdate(msg('🩺 Статус'));
 assert.match(f.sent[2].text,/Gateway:/);
});

test('menu actions are owner only and do not capture ordinary messages',async()=>{
 const f=fixture();
 await f.gateway.handleUpdate(msg('🏠 Меню',111,-100));
 assert.equal(f.handled.length,0);
 assert.match(f.sent[0].text,/Доступ запрещён/);
 await f.gateway.handleUpdate(callback('om1:root',222,222));
 assert.equal(f.calls[0].method,'answerCallbackQuery');
 assert.equal(f.sent.length,1);
 await f.gateway.handleUpdate(msg('Напомни завтра позвонить',111,111));
 assert.deepEqual(f.handled,['Напомни завтра позвонить']);
});

test('new om1 callbacks are acknowledged, old ar1 and Harness am1 are left untouched',async()=>{
 const f=fixture();
 await f.gateway.handleUpdate(callback('ar1:t:d:00000000-0000-0000-0000-000000000000:abc'));
 await f.gateway.handleUpdate(callback('am1:agents'));
 await f.gateway.handleUpdate(callback('am1:approval'));
 assert.equal(f.calls.length,0);
 assert.equal(f.sent.length,0);
 await f.gateway.handleUpdate(callback('om1:root'));
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].method,'answerCallbackQuery');
 assert.match(f.sent[0].text,/главное меню/);
 await f.gateway.handleUpdate(callback('om1:approval'));
 assert.match(f.sent[1].text,/не подключены/);
 assert.equal(f.handled.length,0);
});

test('business menu goes through existing read-only question, not a task executor',async()=>{
 const f=fixture();
 await f.gateway.handleUpdate(msg('📊 Бизнес'));
 assert.deepEqual(f.handled,['Как дела у Миски?']);
 await f.gateway.handleUpdate(msg('🛠 Разработка'));
 assert.match(f.sent[1].text,/Windows Codex worker не запускается/);
 assert.equal(f.handled.length,1);
});
