'use strict';

// Transport bridge independent from the version of ArthurTelegramGateway.
// To integrate into the current Amursk Gateway, register it with one owner
// and call bridge.handle(update) BEFORE the existing ar1: reminder dispatch.
// Never intercept legacy ar1: or future Harness am1: callbacks.
function createOwnerMenuBridge({
  menu, telegram, ownerTelegramId, helpText, statusReader,
  delegateReader, logger,
} = {}) {
  if (!menu || typeof menu.routeText !== 'function' || typeof menu.routeCallback !== 'function') {
    throw new TypeError('Owner menu required');
  }
  if (!telegram || typeof telegram.sendMessage !== 'function' || typeof telegram.call !== 'function') {
    throw new TypeError('Telegram client required');
  }
  if (!/^[0-9]+$/.test(String(ownerTelegramId||''))) {
    throw new TypeError('Trusted owner required');
  }
  if (typeof statusReader !== 'function' || typeof delegateReader !== 'function') {
    throw new TypeError('Read-only status and query adapters required');
  }
  const owner=String(ownerTelegramId);
  const authorized=(from,chat)=>String(from??'')===owner&&String(chat??'')===owner;
  const warn=(event,error)=>logger?.warn?.(event,null,{errorCode:error?.code||error?.name||'UNKNOWN'});

  async function send(chatId,result,update) {
    let text=result.text;
    if(result.kind==='status') text=await statusReader();
    else if(result.kind==='delegate'){
      // The controller produces fixed questions; there is no arbitrary code execution.
      if(typeof result.query!=='string'||!result.query.trim())throw new Error('Menu question required');
      text=await delegateReader(result.query,update);
    }
    await telegram.sendMessage(String(chatId),String(text||'Нет данных для ответа.'),result.replyMarkup
      ?{replyMarkup:result.replyMarkup}:{});
  }

  async function handle(update) {
    if(!update||typeof update!=='object')return false;
    const cb=update.callback_query;
    if(cb){
      // Only om1: belongs to the owner menu. Leave ar1:/am1: to existing handlers.
      if(!String(cb.data||'').startsWith('om1:'))return false;
      const chat=cb.message?.chat?.id;
      const isOwner=authorized(cb.from?.id,chat);
      const route=menu.routeCallback({data:cb.data,userId:cb.from?.id,chatId:chat});
      if(cb.id){
        try{
          await telegram.call('answerCallbackQuery',{
            callback_query_id:cb.id,
            text:isOwner?'Артур':'Нет доступа',
            show_alert:!isOwner,
          },{maxRetries:0});
        }catch(error){warn('owner_menu_ack_failed',error)}
      }
      if(!isOwner || !route.handled || route.denied)return true;
      try{await send(chat,route,update)}
      catch(error){warn('owner_menu_callback_failed',error)}
      return true;
    }
    const msg=update.message;
    if(typeof msg?.text!=='string')return false;
    const isOwner=authorized(msg.from?.id,msg.chat?.id);
    const menuMatch=menu.routeText({
      text:msg.text,userId:msg.from?.id,chatId:msg.chat?.id,
    });
    // Known menu labels in groups must not be forwarded as free-form AI requests.
    // Return a generic denial, with no menu data or task actions.
    if(menuMatch.handled && !isOwner){
      try{await telegram.sendMessage(String(msg.chat.id),'Доступ запрещён.',{})}
      catch(error){warn('owner_menu_deny_failed',error)}
      return true;
    }
    if(!isOwner)return false;
    if(msg.text.trim()==='/start'){
      const root=menu.routeText({text:'/menu',userId:msg.from.id,chatId:msg.chat.id});
      if(!root.handled || root.denied)return false;
      try{
        await telegram.sendMessage(owner,String(helpText||root.text),{
          replyMarkup:root.replyMarkup
        });
      }catch(error){warn('owner_menu_start_failed',error)}
      return true;
    }
    const route=menu.routeText({text:msg.text,userId:msg.from.id,chatId:msg.chat.id});
    if(!route.handled)return false;
    try{await send(owner,route,update)}
    catch(error){warn('owner_menu_text_failed',error)}
    return true;
  }
  return {handle};
}
module.exports={createOwnerMenuBridge};
