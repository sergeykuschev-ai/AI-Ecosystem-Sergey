'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOwnerMenu}=require('../telegram/owner_menu');
const {createOwnerMenuBridge}=require('../telegram/owner_menu_bridge');

function fixture(){
  const calls=[],sent=[],questions=[],events=[];
  const tg={
    async call(method,payload,opts){calls.push({method,payload,opts});return{ok:true}},
    async sendMessage(chatId,text,opts){sent.push({chatId,text,opts});return {ok:true}},
  };
  const logger={warn(event,nullArg,data){events.push({event,data})}};
  const bridge=createOwnerMenuBridge({
    menu:createOwnerMenu({ownerTelegramId:'111'}),
    ownerTelegramId:'111',telegram:tg,logger,helpText:'Артур: помощь',
    async statusReader(){return 'Gateway: работает'},
    async delegateReader(query){questions.push(query);return 'Ответ на: '+query},
  });
  const msg=(text,from=111,chat=111)=>({message:{text,from:{id:from},chat:{id:chat}}});
  const cb=(data,from=111,chat=111)=>({callback_query:{id:'callback123',data,from:{id:from},message:{chat:{id:chat},message_id:70}}});
  return{bridge,calls,sent,questions,events,msg,cb};
}

test('version-independent bridge leaves existing ar1 and Harness am1 untouched',async()=>{
 const f=fixture();
 assert.equal(await f.bridge.handle(f.cb('ar1:t:d:00000000-0000-0000-0000-000000000000:abc')),false);
 assert.equal(await f.bridge.handle(f.cb('am1:approval')),false);
 assert.equal(await f.bridge.handle(f.msg('Что у меня сегодня?')),false);
 assert.equal(await f.bridge.handle({edited_message:{text:'📋 Задачи'}}),false);
 assert.equal(f.calls.length,0);
 assert.equal(f.sent.length,0);
});

test('owner private /start provides keyboard, unrelated chat does not',async()=>{
 const f=fixture();
 assert.equal(await f.bridge.handle(f.msg('/start',111,111)),true);
 assert.equal(f.sent[0].text,'Артур: помощь');
 assert.equal(f.sent[0].opts.replyMarkup.keyboard.length,4);
 assert.equal(await f.bridge.handle(f.msg('/start',111,-100)),false);
 assert.equal(await f.bridge.handle(f.msg('/start',222,222)),false);
 assert.equal(f.sent.length,1);
});

test('recognized menu text in a group is denied instead of reaching Arthur',async()=>{
 const f=fixture();
 assert.equal(await f.bridge.handle(f.msg('📋 Задачи',111,-100)),true);
 assert.equal(await f.bridge.handle(f.msg('/menu',222,222)),true);
 assert.equal(f.sent.length,2);
 assert.ok(f.sent.every(x=>x.text==='Доступ запрещён.'));
 assert.deepEqual(f.questions,[]);
 assert.equal(await f.bridge.handle(f.msg('Что у меня сегодня?',111,-100)),false);
});

test('tasks subsection navigates via om1 and never writes on create/complete',async()=>{
 const f=fixture();
 assert.equal(await f.bridge.handle(f.msg('📋 Задачи')),true);
 assert.ok(f.sent[0].opts.replyMarkup.inline_keyboard.flat().some(b=>b.callback_data==='om1:tasks:today'));
 assert.equal(await f.bridge.handle(f.cb('om1:tasks:today')),true);
 assert.deepEqual(f.questions,['Что у меня сегодня?']);
 assert.match(f.sent[1].text,/Ответ на/);
 assert.equal(f.calls[0].method,'answerCallbackQuery');
 assert.equal(await f.bridge.handle(f.cb('om1:tasks:create')),true);
 assert.equal(await f.bridge.handle(f.cb('om1:tasks:complete')),true);
 assert.equal(f.questions.length,1);
 assert.match(f.sent[2].text,/напиши/);
});

test('unauthorized owner-menu callbacks are acknowledged and not answered',async()=>{
 const f=fixture();
 assert.equal(await f.bridge.handle(f.cb('om1:business',222,222)),true);
 assert.equal(await f.bridge.handle(f.cb('om1:tasks:all',111,-100)),true);
 assert.equal(f.sent.length,0);
 assert.equal(f.questions.length,0);
 assert.deepEqual(f.calls.map(x=>x.payload.show_alert),[true,true]);
});

test('status reader and approval do not invoke delegated task actions',async()=>{
 const f=fixture();
 await f.bridge.handle(f.cb('om1:status'));
 await f.bridge.handle(f.cb('om1:approval'));
 assert.match(f.sent[0].text,/Gateway:/);
 assert.match(f.sent[1].text,/не активированы/);
 assert.deepEqual(f.questions,[]);
});

test('callback acknowledgement failure does not cause duplicate callbacks or writes',async()=>{
 const f=fixture();
 const failing={
   call:async()=>{throw Object.assign(new Error('offline'),{code:'NETWORK'})},
   sendMessage:async(chat,text,options)=>{f.sent.push({chatId:chat,text,opts:options})},
 };
 const bridge=createOwnerMenuBridge({
   menu:createOwnerMenu({ownerTelegramId:'111'}),telegram:failing,
   ownerTelegramId:'111',statusReader:async()=>'healthy',
   delegateReader:async()=>{throw Error('should not delegate')},
   logger:{warn:(...a)=>f.events.push(a)},
 });
 assert.equal(await bridge.handle(f.cb('om1:approval')),true);
 assert.equal(f.sent.length,1);
 assert.equal(f.events[0][0],'owner_menu_ack_failed');
});

test('bridge rejects missing owner, menu, callbacks, read-only adapters',()=>{
 const f=fixture(),m=createOwnerMenu({ownerTelegramId:'111'});
 const base={
   menu:m,telegram:{sendMessage:async()=>{},call:async()=>{}},
   ownerTelegramId:'111',statusReader:async()=>'',delegateReader:async()=>''};
 assert.throws(()=>createOwnerMenuBridge({...base,ownerTelegramId:''}),/Trusted/);
 assert.throws(()=>createOwnerMenuBridge({...base,menu:null}),/Owner menu/);
 assert.throws(()=>createOwnerMenuBridge({...base,statusReader:null}),/Read-only/);
});
