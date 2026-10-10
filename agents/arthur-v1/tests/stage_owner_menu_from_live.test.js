'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {stageOwnerMenuFromLive,sha256,VERIFIED_LIVE_SHA256}=
  require('../telegram/stage_owner_menu_from_live');

const fixture=[
  "'use strict';",
  "const { createArthurV1 } = require('../index');",
  "const HELP_TEXT = 'test';",
  'function buildArthurRequest(x){return x}',
  'function formatArthurResponse(x){return x}',
  'class Gateway {',
  '  constructor(){',
  '    this.arthur = createArthurV1();',
  '    this.processedUpdates = 0;',
  "    const voiceEndpoint = process.env.ARTHUR_VOICE_ASR_URL || '';",
  '    this.voiceEndpoint=voiceEndpoint;',
  '  }',
  '  async handleReminderCallback(callback) {',
  "    const cb=/^ar1:/.test(callback.data||'');",
  '    return cb;',
  '  }',
  '  async handleUpdate(update) {',
  '    if (update.callback_query) {',
  '      await this.handleReminderCallback(update.callback_query);',
  '      return;',
  '    }',
  "    return update.message?.text;",
  '  }',
  '}',
  ''
].join('\n');

test('real production fingerprint remains pinned and cannot be overridden from CLI',()=>{
  assert.equal(VERIFIED_LIVE_SHA256,
    'be9cfe6f8adf4ea9c1f00e7baea6ab0757471574dcbf7af2a0aa44cef680f049');
  assert.throws(()=>stageOwnerMenuFromLive({source:fixture}),/SHA-256 mismatch/);
});

test('stage-only integration inserts exactly three hooks, preserves legacy callbacks',()=>{
  const result=stageOwnerMenuFromLive({source:fixture,expectedSha256:sha256(fixture)});
  assert.equal(result.originSha256,sha256(fixture));
  assert.equal(result.candidateSha256,sha256(result.source));
  assert.notEqual(result.candidateSha256,result.originSha256);
  assert.ok(result.source.includes("require('../index');\nconst { createOwnerMenuBridgeForGateway }"));
  assert.ok(result.source.includes("this.handleReminderCallback(update.callback_query)"));
  assert.ok(result.source.includes("const cb=/^ar1:/"));
  assert.ok(result.source.includes("enabled: process.env.ARTHUR_TELEGRAM_MENU_ENABLED === '1'"));
  assert.ok(result.source.includes("this.ownerMenuBridge && await this.ownerMenuBridge.handle(update)"));
  assert.ok(result.source.indexOf('this.ownerMenuBridge.handle(update)') <
    result.source.indexOf('this.handleReminderCallback(update.callback_query)'));
  // Existing bytes must remain in the original order and unmodified.
  const cleanup=result.source
    .replace("\nconst { createOwnerMenuBridgeForGateway } = require('./owner_menu_gateway_adapter');",'')
    .replace(/    \/\/ Owner-only opt-in, preserving the original ar1 reminder handler\.\n    this\.ownerMenuBridge = createOwnerMenuBridgeForGateway\(\{\n      gateway: this, buildArthurRequest, formatArthurResponse,\n      helpText: HELP_TEXT, enabled: process\.env\.ARTHUR_TELEGRAM_MENU_ENABLED === '1',\n    \}\);\n/,'')
    .replace(/    \/\/ Handle only om1:; ar1: and am1: continue through existing routes\.\n    if \(this\.ownerMenuBridge && await this\.ownerMenuBridge\.handle\(update\)\) \{\n      this\.processedUpdates \+= 1;\n      return;\n    \}\n/,'');
  assert.equal(cleanup,fixture);
});

test('stage-only patch rejects missing legacy handler',()=>{
 const content=fixture.replace('handleReminderCallback(callback)','oldCallback(callback)');
 assert.throws(()=>stageOwnerMenuFromLive({source:content,expectedSha256:sha256(content)}),
   /Legacy reminder callbacks absent/);
});

test('stage-only patch rejects unexpected live source layout',()=>{
 const content=fixture.replace("    const voiceEndpoint = process.env.ARTHUR_VOICE_ASR_URL || '';",
   "    const renamedVoiceEndpoint = 'changed';");
 assert.throws(()=>stageOwnerMenuFromLive({source:content,expectedSha256:sha256(content)}),
   /Unexpected or repeated anchor/);
});

test('stage-only patch refuses already integrated gateway',()=>{
 const once=stageOwnerMenuFromLive({source:fixture,expectedSha256:sha256(fixture)});
 assert.throws(()=>stageOwnerMenuFromLive({source:once.source,expectedSha256:sha256(once.source)}),
   /already integrated/);
});

test('stage-only patch rejects repeated anchors instead of guessing',()=>{
 const content=fixture.replace("  async handleUpdate(update) {",
  "  async handleUpdate(update) {\n  async handleUpdate(update) {");
 assert.throws(()=>stageOwnerMenuFromLive({source:content,expectedSha256:sha256(content)}),
   /Unexpected or repeated anchor/);
});
