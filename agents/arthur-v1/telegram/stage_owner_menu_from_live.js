'use strict';

// OFFLINE-ONLY deployment preparation helper. This script NEVER modifies source.
// It can only stage an additional candidate file for an administrator to review.
// Rollout/restart is a separate, authorized operation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERIFIED_LIVE_SHA256='be9cfe6f8adf4ea9c1f00e7baea6ab0757471574dcbf7af2a0aa44cef680f049';
const IMPORT_LINE="const { createOwnerMenuBridgeForGateway } = require('./owner_menu_gateway_adapter');";
const HOOK_LINE="    if (this.ownerMenuBridge && await this.ownerMenuBridge.handle(update)) {";
const CONFIG_LINE="    this.ownerMenuBridge = createOwnerMenuBridgeForGateway({";
function sha256(s){return crypto.createHash('sha256').update(s,'utf8').digest('hex')}

function replaceExactlyOne(source,anchor,addition,where='before'){
  const first=source.indexOf(anchor);
  if(first<0 || source.indexOf(anchor,first+anchor.length)>=0)throw Error('Unexpected or repeated anchor; abort staging');
  return where==='before'
    ? source.slice(0,first)+addition+source.slice(first)
    : source.slice(0,first+anchor.length)+addition+source.slice(first+anchor.length);
}

function stageOwnerMenuFromLive({source,expectedSha256=VERIFIED_LIVE_SHA256}={}){
  if(typeof source!=='string')throw new TypeError('Expected gateway UTF-8 source');
  const beforeSha=sha256(source);
  if(beforeSha!==expectedSha256)throw Error('Live Gateway SHA-256 mismatch; stage refused');
  if(!source.includes('handleReminderCallback(callback)') || !source.includes('ar1:') ||
     !source.includes('this.handleReminderCallback(update.callback_query)')){
    throw Error('Legacy reminder callbacks absent; stage refused');
  }
  if(source.includes('ownerMenuBridge')||source.includes('createOwnerMenuBridgeForGateway')){
    throw Error('Menu already integrated or source changed; stage refused');
  }
  let staged=replaceExactlyOne(
    source,
    "const { createArthurV1 } = require('../index');",
    '\n'+IMPORT_LINE,
    'after'
  );
  const constructorAnchor="    const voiceEndpoint = process.env.ARTHUR_VOICE_ASR_URL || '';";
  const bridgeConfig=[
    '    // Owner-only opt-in, preserving the original ar1 reminder handler.',
    CONFIG_LINE,
    '      gateway: this, buildArthurRequest, formatArthurResponse,',
    "      helpText: HELP_TEXT, enabled: process.env.ARTHUR_TELEGRAM_MENU_ENABLED === '1',",
    '    });',
    ''
  ].join('\n');
  staged=replaceExactlyOne(staged,constructorAnchor,bridgeConfig);
  const handlerAnchor='  async handleUpdate(update) {\n';
  const hook=[
    '    // Handle only om1:; ar1: and am1: continue through existing routes.',
    HOOK_LINE,
    '      this.processedUpdates += 1;',
    '      return;',
    '    }',
    ''
  ].join('\n');
  staged=replaceExactlyOne(staged,handlerAnchor,hook,'after');
  // Insert-only patch with the exact expected number of additions.
  const additions=['\n'+IMPORT_LINE,bridgeConfig,hook];
  if(additions.reduce((n,v)=>n+v.length,0)!==staged.length-source.length)
    throw Error('Patch changed pre-existing characters');
  for(const marker of ['handleReminderCallback(callback)','this.handleReminderCallback(update.callback_query)','ar1:']){
    if(!staged.includes(marker))throw Error('Legacy reminder behavior lost');
  }
  return {source:staged,originSha256:beforeSha,candidateSha256:sha256(staged)};
}

if(require.main===module){
  const [sourcePath,outputPath]=process.argv.slice(2);
  if(!sourcePath || !outputPath){
    console.error('Usage: node stage_owner_menu_from_live.js <read-only-original-gateway.js> <NEW-candidate-gateway.js>');
    process.exitCode=2;
  } else {
    try {
      const original=path.resolve(sourcePath),output=path.resolve(outputPath);
      if(original===output)throw Error('Refusing in-place replacement');
      // A destination must not already exist: never clobber an existing candidate.
      if(fs.existsSync(output))throw Error('Destination exists; refusing overwrite');
      const result=stageOwnerMenuFromLive({source:fs.readFileSync(original,'utf8')});
      fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.writeFileSync(output,result.source,{encoding:'utf8',flag:'wx'});
      console.log(JSON.stringify({status:'STAGED_ONLY_NOT_DEPLOYED',
        output,originSha256:result.originSha256,candidateSha256:result.candidateSha256,
        featureFlag:'OFF_BY_DEFAULT'}));
    }catch(error){console.error('STAGE_REFUSED '+error.message);process.exitCode=2}
  }
}
module.exports={stageOwnerMenuFromLive,sha256,VERIFIED_LIVE_SHA256};
