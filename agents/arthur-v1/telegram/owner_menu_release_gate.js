'use strict';
// Read-only source preflight. Do not infer a passing *production* canary from source alone.
// A checkout of the historic GitHub main gateway must fail this gate because it lacks ar1 handlers.
const fs=require('node:fs');
const path=require('node:path');
function inspectOwnerMenuRelease({gatewaySource,menuSource,bridgeSource,testsPassed=false,ownerCanaryPassed=false,rollbackVerified=false}={}){
  const gw=String(gatewaySource||''),menu=String(menuSource||''),bridge=String(bridgeSource||'');
  const checks={
    legacy_reminder_handler: gw.includes('handleReminderCallback(callback)'),
    legacy_ar1_parser: gw.includes('ar1:')&&gw.includes('handleReminderCallback('),
    legacy_callbacks_preserved: gw.includes('this.handleReminderCallback(update.callback_query)'),
    new_menu_opt_in: gw.includes('ARTHUR_TELEGRAM_MENU_ENABLED')&&gw.includes("=== '1'"),
    menu_owner_authorization: menu.includes('String(userId||\'\')===owner')&&menu.includes('String(chatId||\'\')===owner'),
    menu_callback_namespace_isolated: menu.includes("startsWith('om1:')") && !menu.includes("startsWith('am1:')"),
    menu_callback_wired: gw.includes('this.ownerMenuBridge.handle(update)') && bridge.includes('menu.routeCallback('),
    menu_text_wired: gw.includes('createOwnerMenuBridgeForGateway(') && bridge.includes('menu.routeText('),
    menu_reply_markup: bridge.includes('result.replyMarkup') && bridge.includes('telegram.sendMessage('),
    menu_not_running_codex: !menu.includes('codexSkill.execute(')&&!menu.includes('child_process'),
    old_reminder_tests_passed:testsPassed===true,
    owner_private_chat_canary:ownerCanaryPassed===true,
    rollback_verified:rollbackVerified===true,
  };
  return {ready:Object.values(checks).every(Boolean),checks,
    blockers:Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name)};
}
if(require.main===module){
  const gatewayPath=process.argv[2],menuPath=process.argv[3],bridgePath=process.argv[4];
  if(!gatewayPath||!menuPath||!bridgePath){
    console.error('Usage: node owner_menu_release_gate.js <gateway.js> <owner_menu.js> <owner_menu_bridge.js> [--tests-pass] [--canary-pass] [--rollback-verified]');
    process.exitCode=2;
  }else{
    try{
      const flags=new Set(process.argv.slice(5));
      const report=inspectOwnerMenuRelease({
        gatewaySource:fs.readFileSync(path.resolve(gatewayPath),'utf8'),
        menuSource:fs.readFileSync(path.resolve(menuPath),'utf8'),
        bridgeSource:fs.readFileSync(path.resolve(bridgePath),'utf8'),
        testsPassed:flags.has('--tests-pass'),
        ownerCanaryPassed:flags.has('--canary-pass'),
        rollbackVerified:flags.has('--rollback-verified'),
      });
      console.log(JSON.stringify(report,null,2));
      process.exitCode=report.ready?0:2;
    }catch(e){console.error('Release preflight input unavailable: '+e.code);process.exitCode=2}
  }
}
module.exports={inspectOwnerMenuRelease};
