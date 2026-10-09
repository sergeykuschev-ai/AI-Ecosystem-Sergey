'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loadConfig,validateConfig,loadAdvertisingLeadsConfig,loadVozdoohNotificationsConfig}=require('../telegram/config');

const base={
 TELEGRAM_BOT_TOKEN:'11111:testing-not-real',
 TELEGRAM_ALLOWED_USER_IDS:'22222',
 ARTHUR_OWNER_PROFILE_ID:'test-owner',
};
test('both channels disabled by default and do not require secrets',()=>{
 const c=loadConfig(base);
 assert.equal(c.advertisingLeads.enabled,false);
 assert.equal(c.vozdoohNotifications.enabled,false);
 assert.equal(validateConfig(c).valid,true);
});
test('enabled inbound event channels must have their own signed secrets',()=>{
 const c=loadConfig({...base,ARTHUR_ADVERTISING_LEADS_ENABLED:'true',ARTHUR_VOZDOOH_NOTIFICATIONS_ENABLED:'true'});
 const v=validateConfig(c);
 assert.equal(v.valid,false);
 assert.ok(v.errors.some(x=>/Advertising notification secret/.test(x)));
 assert.ok(v.errors.some(x=>/VOZDOOH notification secret/.test(x)));
});
test('isolated file-based secrets load and are only kept within runtime config',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-config-notifs-'));
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const p1=path.join(dir,'first'),p2=path.join(dir,'second');
 fs.writeFileSync(p1,'example-ad-signing-key-1234\n');
 fs.writeFileSync(p2,'example-order-signing-key-5678\n');
 const c=loadConfig({...base,
  ARTHUR_ADVERTISING_LEADS_ENABLED:'true',
  ARTHUR_ADVERTISING_LEAD_SECRET_FILE:p1,
  ARTHUR_VOZDOOH_NOTIFICATIONS_ENABLED:'true',
  ARTHUR_VOZDOOH_NOTIFICATION_SECRET_FILE:p2,
 });
 assert.equal(c.advertisingLeads.enabled,true);
 assert.equal(c.vozdoohNotifications.enabled,true);
 assert.equal(c.advertisingLeads.secret,'example-ad-signing-key-1234');
 assert.equal(c.vozdoohNotifications.secret,'example-order-signing-key-5678');
 assert.equal(validateConfig(c).valid,true);
});
test('missing secret file fails closed without disclosing its filesystem path',()=>{
 const p='/nonexistent/signing-secret';
 assert.throws(()=>loadAdvertisingLeadsConfig({
  ARTHUR_ADVERTISING_LEADS_ENABLED:'true',ARTHUR_ADVERTISING_LEAD_SECRET_FILE:p,
 }),e=>e.code==='ARTHUR_ADVERTISING_LEAD_SECRET_READ_FAILED'&&!e.message.includes(p));
 assert.throws(()=>loadVozdoohNotificationsConfig({
  ARTHUR_VOZDOOH_NOTIFICATIONS_ENABLED:'true',ARTHUR_VOZDOOH_NOTIFICATION_SECRET_FILE:p,
 }),e=>e.code==='ARTHUR_VOZDOOH_NOTIFICATION_SECRET_READ_FAILED'&&!e.message.includes(p));
});
