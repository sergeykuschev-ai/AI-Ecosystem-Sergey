'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOwnerMenu,LABELS}=require('../telegram/owner_menu');

test('owner-only menu and fallback to normal text',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 assert.equal(m.routeText({text:'/menu',userId:111,chatId:111}).replyMarkup.keyboard.length,4);
 assert.equal(m.routeText({text:LABELS.tasks,userId:'111',chatId:'111'}).kind,'message');
 assert.equal(m.routeText({text:LABELS.business,userId:'111',chatId:'111'}).kind,'message');
 assert.equal(m.routeText({text:LABELS.status,userId:'111',chatId:'111'}).kind,'status');
 assert.deepEqual(m.routeText({text:'Напомни завтра',userId:'111',chatId:'111'}),{handled:false});
});
test('other users and group chats never receive menu capabilities',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 assert.equal(m.routeText({text:'/menu',userId:222,chatId:222}).denied,true);
 assert.equal(m.routeText({text:'/menu',userId:111,chatId:-100}).denied,true);
 assert.equal(m.routeCallback({data:'om1:root',userId:222,chatId:222}).denied,true);
 assert.equal(m.routeCallback({data:'om1:tasks',userId:111,chatId:-100}).denied,true);
 assert.throws(()=>createOwnerMenu({ownerTelegramId:''}),/Trusted/);
});
test('legacy ar1 callbacks are not captured; no approval execution',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 assert.deepEqual(m.routeCallback({data:'ar1:t:d:00000000-0000-0000-0000-000000000000:abc',userId:111,chatId:111}),{handled:false});
 assert.equal(m.routeCallback({data:'om1:approval',userId:111,chatId:111}).kind,'message');
 assert.match(m.routeCallback({data:'om1:approval',userId:111,chatId:111}).text,/не активированы/);
 assert.equal(m.routeCallback({data:'om1:bad',userId:111,chatId:111}).kind,'message');
 assert.deepEqual(m.routeCallback({data:'am1:agents',userId:111,chatId:111}),{handled:false});
 assert.deepEqual(m.routeCallback({data:'am1:approval',userId:111,chatId:111}),{handled:false});
 assert.match(m.routeText({text:LABELS.development,userId:111,chatId:111}).text,/не запускается/);
});
test('callback navigation has a single owner and only read-only actions',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 assert.equal(m.routeCallback({data:'om1:root',userId:111,chatId:111}).kind,'message');
 assert.equal(m.routeCallback({data:'om1:status',userId:111,chatId:111}).kind,'status');
 assert.equal(m.routeCallback({data:'om1:tasks',userId:111,chatId:111}).kind,'message');
});

test('tasks submenu has planned actions and safe read-only selectors',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 const pick=(data)=>m.routeCallback({data,userId:111,chatId:111});
 const root=pick('om1:tasks');
 const codes=root.replyMarkup.inline_keyboard.flat().map(b=>b.callback_data);
 for(const path of ['today','all','overdue','repeats','create','complete','move'])
   assert.ok(codes.includes('om1:tasks:'+path),path);
 assert.equal(pick('om1:tasks:today').query,'Что у меня сегодня?');
 assert.equal(pick('om1:tasks:all').query,'Что у меня по задачам?');
 assert.equal(pick('om1:tasks:overdue').kind,'delegate');
 assert.equal(pick('om1:tasks:repeats').kind,'delegate');
 for(const path of ['create','complete','move']){
   const r=pick('om1:tasks:'+path);
   assert.equal(r.kind,'message');
   assert.match(r.text,/Напиши|напиши/);
   assert.equal(r.query,undefined);
 }
 assert.equal(m.routeText({text:LABELS.home,userId:111,chatId:111}).kind,'message');
});

test('business submenu has shops and safeguards for unconfirmed live orders',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 const pick=(data)=>m.routeCallback({data,userId:111,chatId:111});
 const options=pick('om1:business').replyMarkup.inline_keyboard.flat().map(x=>x.callback_data);
 for(const key of ['miska','amper','ventil','metiz','purchasing','vozdooh'])
   assert.ok(options.includes('om1:business:'+key));
 assert.equal(pick('om1:business:miska').query,'Как дела у Миски?');
 assert.equal(pick('om1:business:amper').query,'Как дела у Ампера?');
 assert.equal(pick('om1:business:ventil').query,'Как дела у Вентиля?');
 assert.equal(pick('om1:business:metiz').query,'Как дела у Метиз Маркета?');
 assert.equal(pick('om1:business:purchasing').query,'Что сейчас с закупщиком?');
 assert.equal(pick('om1:business:vozdooh').kind,'message');
});

test('approvals and developer action remain informative only',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 const pick=(data)=>m.routeCallback({data,userId:111,chatId:111});
 assert.equal(pick('om1:approval').kind,'message');
 assert.equal(pick('om1:approval').query,undefined);
 const dev=pick('om1:development');
 assert.equal(dev.kind,'message');
 assert.ok(dev.replyMarkup.inline_keyboard.flat().some(b=>b.url?.endsWith('/issues/254')));
 assert.deepEqual(pick('am1:approval'),{handled:false});
 assert.deepEqual(pick('ar1:t:d:00000000-0000-0000-0000-000000000000:abc'),{handled:false});
});
