'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {matchesRecurringRequest,parseRecurringRequest}=require('../planner/recurring_request_parser');
const {reminderKeyboard,parsePersonalCallback}=require('../telegram/personal_buttons');
const {createTelegramGateway}=require('../telegram/telegram_gateway');
const {loadConfig}=require('../telegram/config');
const {detectIntent,INTENTS}=require('../planner/intents');
const {createRuleBasedPlanBuilder}=require('../planner/plan_builder');

test('daily and weekday recurring commands route with exact time and transport receipt',()=>{
 const daily=parseRecurringRequest('Напоминай английский каждый день в 20:00');
 assert.deepEqual(daily,{operation:'create',title:'английский',weekdays:[1,2,3,4,5,6,7],localTime:'20:00'});
 assert.deepEqual(parseRecurringRequest('Спортзал по понедельникам, средам и пятницам в 18:00').weekdays,[1,3,5]);
 assert.equal(detectIntent('Напоминай английский каждый день в 20:00'),INTENTS.CORE_RECURRING);
 const plan=createRuleBasedPlanBuilder().build({message:'Напоминай английский каждый день в 20:00',transport:{metadata:{updateId:123}}});
 assert.equal(plan.steps[0].parameters.sourceRef,'telegram-update:123');
 assert.equal(parseRecurringRequest('Спортзал по понедельникам').operation,undefined);
 assert.equal(matchesRecurringRequest('Как заниматься английским каждый день?'),false);
 assert.equal(parseRecurringRequest('Покажи повторяющиеся дела').operation,'list');
 assert.equal(parseRecurringRequest('Отмени повтор английский').operation,'cancel');
});
const task={id:'00000000-0000-4000-8000-000000000001',updatedAt:'2026-10-09T01:00:00.123Z'};
test('buttons fit Telegram callback limit and preserve millisecond task version',()=>{
 const buttons=reminderKeyboard(task).inline_keyboard[0];
 assert.equal(buttons.length,3);
 for(const button of buttons) {
  assert.ok(Buffer.byteLength(button.callback_data)<=64);
  assert.equal(parsePersonalCallback(button.callback_data).expectedUpdatedAt,task.updatedAt);
 }
 assert.equal(parsePersonalCallback('pa:d:bad:1'),null);
 assert.equal(reminderKeyboard({id:'bad',updatedAt:'bad'}),undefined);
});

function gateway() {
 const writes=[],answers=[],edits=[];
 const config=loadConfig({TELEGRAM_BOT_TOKEN:'test',TELEGRAM_ALLOWED_USER_IDS:'111',ARTHUR_OWNER_PROFILE_ID:'sergey',ARTHUR_PERSONAL_ENABLED:'true',ARTHUR_PERSONAL_REMINDERS_ENABLED:'true'});
 const instance=createTelegramGateway({config,arthur:{},businessKpiSkill:null,mailSkill:null,
  logger:{info(){},warn(){},error(){}},
  personalCore:{async applyPersonalTaskAction(owner,id,input){writes.push({owner,id,input});return {status:'updated'};}},
  telegramClient:{async answerCallbackQuery(id,text){answers.push({id,text});},async editMessageReplyMarkup(...args){edits.push(args);}},
 });
 return {instance,writes,answers,edits};
}
test('callback requires owner private chat and acknowledges durable action',async()=>{
 const {instance,writes,answers,edits}=gateway();
 const query={id:'test-query',from:{id:111},message:{chat:{id:111},message_id:3},data:reminderKeyboard(task).inline_keyboard[0][0].callback_data};
 await instance.handleUpdate({callback_query:{...query,from:{id:222}}});
 await instance.handleUpdate({callback_query:{...query,message:{chat:{id:-1},message_id:3}}});
 assert.equal(writes.length,0);
 await instance.handleUpdate({callback_query:query});
 assert.equal(writes.length,1);assert.equal(writes[0].owner,'sergey');
 assert.equal(writes[0].input.action,'done');assert.equal(writes[0].input.sourceRef,'telegram-callback:test-query');
 assert.equal(answers.length,3);assert.equal(edits.length,1);
});
