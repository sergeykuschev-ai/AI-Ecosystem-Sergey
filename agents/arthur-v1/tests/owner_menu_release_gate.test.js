'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {inspectOwnerMenuRelease}=require('../telegram/owner_menu_release_gate');
const gateway=fs.readFileSync(path.join(__dirname,'../telegram/telegram_gateway.js'),'utf8');
const menu=fs.readFileSync(path.join(__dirname,'../telegram/owner_menu.js'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'../telegram/owner_menu_bridge.js'),'utf8');

test('GitHub gateway cannot pass production release preflight without live ar1 callback reconciliation',()=>{
  const r=inspectOwnerMenuRelease({gatewaySource:gateway,menuSource:menu,bridgeSource:bridge,testsPassed:true,ownerCanaryPassed:true,rollbackVerified:true});
  assert.equal(r.ready,false);
  assert.deepEqual(r.blockers.filter(x=>x.startsWith('legacy_')).sort(),
    ['legacy_ar1_parser','legacy_callbacks_preserved','legacy_reminder_handler']);
  assert.equal(r.checks.new_menu_opt_in,true);
  assert.equal(r.checks.menu_owner_authorization,true);
  assert.equal(r.checks.menu_callback_namespace_isolated,true);
});

test('no production approval before real owner canary, regression, rollback checks',()=>{
 const liveFixture=gateway.replace('  async handleUpdate(update) {',
  "  async handleReminderCallback(callback) { /* ar1: persisted callbacks */ }\n  async handleUpdate(update) {\n    if (update.callback_query) await this.handleReminderCallback(update.callback_query);");
 const unverified=inspectOwnerMenuRelease({gatewaySource:liveFixture,menuSource:menu,bridgeSource:bridge});
 assert.equal(unverified.ready,false);
 for(const x of ['old_reminder_tests_passed','owner_private_chat_canary','rollback_verified'])assert.ok(unverified.blockers.includes(x));
 const approved=inspectOwnerMenuRelease({gatewaySource:liveFixture,menuSource:menu,bridgeSource:bridge,testsPassed:true,ownerCanaryPassed:true,rollbackVerified:true});
 assert.equal(approved.ready,true);
});

test('menu collision with future Harness am1 callbacks fails release gate',()=>{
 const contaminated=menu.replace("startsWith('om1:')","startsWith('am1:')");
 const r=inspectOwnerMenuRelease({gatewaySource:gateway,menuSource:contaminated,bridgeSource:bridge,testsPassed:true,ownerCanaryPassed:true,rollbackVerified:true});
 assert.equal(r.checks.menu_callback_namespace_isolated,false);
 assert.equal(r.ready,false);
});

test('we never treat an unrecognized menu version or disabled default as sufficient',()=>{
 const damaged=gateway.replace('ARTHUR_TELEGRAM_MENU_ENABLED','ARTHUR_TELEGRAM_MENU_ALWAYS_ON');
 const r=inspectOwnerMenuRelease({gatewaySource:damaged,menuSource:menu,bridgeSource:bridge,testsPassed:true,ownerCanaryPassed:true,rollbackVerified:true});
 assert.equal(r.checks.new_menu_opt_in,false);
 assert.equal(r.ready,false);
});
