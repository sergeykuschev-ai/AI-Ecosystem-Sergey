'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOwnerMenuBridgeForGateway}=require('../telegram/owner_menu_gateway_adapter');

function fixture({allowed=new Set(['111'])}={}){
 const sent=[],acks=[],requests=[],warnings=[];
 const gateway={
   config:{allowedUserIds:allowed,ownerProfileId:'owner-profile'},
   logger:{warn:(...x)=>warnings.push(x)},
   telegram:{
     async sendMessage(chatId,text,options){sent.push({chatId,text,options})},
     async call(method,payload){acks.push({method,payload})},
   },
   async buildStatusText(){return 'STATUS: healthy'},
   arthur:{async handle(req){requests.push(req);return {status:'success',answer:{text:'TASK: '+req.message}}}},
 };
 const helpers={
  gateway,helpText:'HELLO',enabled:true,
  buildArthurRequest:({update,userId,telegramUserId,chatId})=>({
    message:update.message.text,userId,telegramUserId,chatId,
    sourceId:update.update_id,
  }),
  formatArthurResponse:(answer)=>answer.answer.text,
 };
 const msg=(text)=>({update_id:72,message:{text,from:{id:111},chat:{id:111},message_id:33}});
 const cb=(data)=>({update_id:73,callback_query:{id:'cb-id',data,from:{id:111},message:{message_id:33,chat:{id:111}}}});
 return {sent,acks,requests,warnings,gateway,helpers,msg,cb};
}
test('disabled menu requires no extra dependencies and does not start',()=>{
 assert.equal(createOwnerMenuBridgeForGateway({enabled:false}),null);
});
test('gateway binding uses actual Arthur request and preserves private owner',async()=>{
 const f=fixture();
 const bridge=createOwnerMenuBridgeForGateway(f.helpers);
 assert.equal(await bridge.handle(f.msg('/start')),true);
 assert.equal(f.sent[0].text,'HELLO');
 assert.equal(f.sent[0].options.replyMarkup.keyboard.length,4);
 assert.equal(await bridge.handle(f.cb('om1:tasks:today')),true);
 assert.equal(f.acks.length,1);
 assert.deepEqual(f.requests[0],{
   message:'Что у меня сегодня?',
   userId:'owner-profile',telegramUserId:'111',chatId:'111',sourceId:73,
 });
 assert.match(f.sent[1].text,/TASK:/);
 assert.equal(await bridge.handle(f.cb('ar1:t:d:00000000-0000-0000-0000-000000000000:abc')),false);
 assert.equal(await bridge.handle(f.cb('am1:approval')),false);
 assert.equal(f.requests.length,1);
});
test('invalid owner and missing adapters fail closed when menu enabled',()=>{
 const f=fixture({allowed:new Set(['111','222'])});
 assert.throws(()=>createOwnerMenuBridgeForGateway(f.helpers),/one trusted/);
 const g=fixture();
 assert.throws(()=>createOwnerMenuBridgeForGateway({...g.helpers,buildArthurRequest:undefined}),/request helpers/);
});
