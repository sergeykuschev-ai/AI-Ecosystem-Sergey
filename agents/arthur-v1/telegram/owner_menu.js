'use strict';

// Stage-one owner menu: no Harness workflow approvals or execution hooks.
// Never interpret legacy "ar1:" reminder callbacks.
const LABELS=Object.freeze({
  home:'🏠 Меню', tasks:'📋 Задачи', agents:'🤖 Агенты',
  approval:'✅ Согласования', business:'📊 Бизнес',
  development:'🛠 Разработка', status:'🩺 Статус',
});
const CALLBACKS=Object.freeze({
  'om1:root':'home','om1:tasks':'tasks','om1:agents':'agents',
  'om1:approval':'approval','om1:business':'business',
  'om1:development':'development','om1:status':'status',
});
const KEYBOARD=Object.freeze({
  keyboard:[
    [{text:LABELS.tasks},{text:LABELS.agents}],
    [{text:LABELS.approval},{text:LABELS.business}],
    [{text:LABELS.development},{text:LABELS.status}],
    [{text:LABELS.home}],
  ],
  resize_keyboard:true,
  is_persistent:true,
  input_field_placeholder:'Выбери раздел или напиши Артуру',
});

function createOwnerMenu({ownerTelegramId}={}){
  const owner=String(ownerTelegramId||'').trim();
  if(!/^\d+$/.test(owner))throw new Error('Trusted Telegram owner ID required');
  function authorized(userId,chatId){
    return String(userId||'')===owner&&String(chatId||'')===owner;
  }
  function view(section){
    switch(section){
      case 'home': return {handled:true,kind:'message',
        text:'Артур: главное меню. Выбери раздел или просто напиши мне.',
        replyMarkup:KEYBOARD};
      case 'tasks':return {handled:true,kind:'delegate',query:'Что у меня по задачам?'};
      case 'business':return {handled:true,kind:'delegate',query:'Как дела у Миски?'};
      case 'status':return {handled:true,kind:'status'};
      case 'agents':return {handled:true,kind:'message',
        text:'Агенты: DeepSeek и GLM используются для анализа. Статус подключения проверяй в разделе «Статус». Выполнение программных изменений отдельно согласуется.'};
      case 'approval':return {handled:true,kind:'message',
        text:'Согласования Harness ещё не подключены. Эта кнопка ничего не подтверждает и не запускает.'};
      case 'development':return {handled:true,kind:'message',
        text:'Разработка через Codex ведётся отдельно в ChatGPT и GitHub. Windows Codex worker не запускается этой кнопкой. Задача: https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/issues/254'};
      default: return {handled:false};
    }
  }
  function routeText({text,userId,chatId}={}){
    const msg=String(text||'').trim();
    const section=msg==='/menu'?'home':Object.keys(LABELS).find(k=>LABELS[k]===msg);
    if(!section)return {handled:false};
    if(!authorized(userId,chatId))return {handled:true,denied:true};
    return view(section);
  }
  function routeCallback({data,userId,chatId}={}){
    const value=String(data||'');
    if(!value.startsWith('om1:'))return {handled:false};
    if(!authorized(userId,chatId))return {handled:true,denied:true};
    const section=CALLBACKS[value];
    return section?view(section):{handled:true,kind:'message',text:'Кнопка устарела. Открой /menu.'};
  }
  return {routeText,routeCallback,labels:LABELS};
}
module.exports={createOwnerMenu,LABELS};
