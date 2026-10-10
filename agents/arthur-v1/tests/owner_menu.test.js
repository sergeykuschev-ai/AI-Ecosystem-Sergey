'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOwnerMenu,LABELS}=require('../telegram/owner_menu');

test('owner-only menu and fallback to normal text',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 assert.equal(m.routeText({text:'/menu',userId:111,chatId:111}).replyMarkup.keyboard.length,4);
 assert.equal(m.routeText({text:LABELS.tasks,userId:'111',chatId:'111'}).query,'Что у меня по задачам?');
 assert.equal(m.routeText({text:LABELS.business,userId:'111',chatId:'111'}).kind,'delegate');
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
 assert.match(m.routeCallback({data:'om1:approval',userId:111,chatId:111}).text,/не подключены/);
 assert.equal(m.routeCallback({data:'om1:bad',userId:111,chatId:111}).kind,'message');
 assert.deepEqual(m.routeCallback({data:'am1:agents',userId:111,chatId:111}),{handled:false});
 assert.deepEqual(m.routeCallback({data:'am1:approval',userId:111,chatId:111}),{handled:false});
 assert.match(m.routeText({text:LABELS.development,userId:111,chatId:111}).text,/не запускается/);
});
test('callback navigation has a single owner and only read-only actions',()=>{
 const m=createOwnerMenu({ownerTelegramId:'111'});
 assert.equal(m.routeCallback({data:'om1:root',userId:111,chatId:111}).kind,'message');
 assert.equal(m.routeCallback({data:'om1:status',userId:111,chatId:111}).kind,'status');
 assert.equal(m.routeCallback({data:'om1:tasks',userId:111,chatId:111}).query,'Что у меня по задачам?');
});
