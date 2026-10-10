'use strict';

const { createOwnerMenu } = require('./owner_menu');
const { createOwnerMenuBridge } = require('./owner_menu_bridge');

// Bind the version-independent bridge to the existing production Gateway.
// Integration needs only one construction assignment AFTER gateway.arthur is created,
// and one routing check BEFORE the existing reminder callback handling.
function createOwnerMenuBridgeForGateway({
  gateway, buildArthurRequest, formatArthurResponse, helpText, enabled,
} = {}) {
  if(enabled !== true)return null;
  if(!gateway?.config || typeof gateway?.telegram?.sendMessage!=='function') {
    throw new TypeError('Existing Telegram Gateway required');
  }
  if(typeof buildArthurRequest!=='function'||typeof formatArthurResponse!=='function') {
    throw new TypeError('Existing Arthur request helpers required');
  }
  const ids=gateway.config.allowedUserIds;
  if(!(ids instanceof Set)||ids.size!==1||!gateway.config.ownerProfileId) {
    throw new Error('Menu requires one trusted Telegram owner and owner profile');
  }
  const owner=[...ids][0];
  if(!/^[0-9]+$/.test(String(owner)))throw new Error('Invalid owner Telegram ID');
  const menu=createOwnerMenu({ownerTelegramId:String(owner)});
  return createOwnerMenuBridge({
    menu, ownerTelegramId:String(owner),
    telegram:gateway.telegram,logger:gateway.logger,helpText,
    statusReader:async()=>gateway.buildStatusText(),
    delegateReader:async(query,update)=>{
      const callback=update.callback_query;
      const message=update.message || callback?.message;
      const from=update.message?.from || callback?.from;
      const normalizedUpdate={
        update_id:update.update_id,
        message:{...message,from,text:query},
      };
      const request=buildArthurRequest({
        update:normalizedUpdate,
        userId:gateway.config.ownerProfileId,
        telegramUserId:String(from?.id),
        chatId:String(owner),
      });
      return formatArthurResponse(await gateway.arthur.handle(request));
    },
  });
}
module.exports={createOwnerMenuBridgeForGateway};
