'use strict';

// Read-only observer for VOZDOOH payment-confirmation notifications.
// Prints aggregate statistics only: never emit order IDs, customer details or HMAC keys.
const fs = require('node:fs');
const path = require('node:path');

const MAX_ORDER_FILES = 15000;
const ORDER_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
const EVENT_FILE = /^[0-9a-f-]{36}\.(payment_confirmed|delivery_created|delivery_failed)\.json$/i;
const ALLOWED_STATUS = new Set(['pending', 'retry', 'sent', 'skipped']);
const PAYMENT_STATUS = new Set(['PAID','PAYMENT_NEW','PAYMENT_FAILED','PAYMENT_CANCELLED','none','other']);
const ALLOWED_EVENT = new Set(['payment_confirmed','delivery_created','delivery_failed']);
const PENDING_GRACE_MS = 15 * 60 * 1000;
const ELIGIBLE_GRACE_MS = 10 * 60 * 1000;

function safeReadDirectory(dir, pattern) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('NOTIFICATION_STORAGE_NOT_CONFIGURED');
  const files = fs.readdirSync(dir).filter(n => pattern.test(n));
  if (files.length > MAX_ORDER_FILES) throw new Error('NOTIFICATION_STORAGE_TOO_LARGE');
  return files;
}
function readJSON(dir, file) {
  const p = path.join(dir,file);
  const info = fs.lstatSync(p);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 512*1024)
    throw new Error('BAD_NOTIFICATION_RECORD');
  return JSON.parse(fs.readFileSync(p,'utf8'));
}
function audit({env=process.env, nowMs=Date.now()}={}) {
  const ordersDir = env.ORDER_REQUEST_STORE_PATH;
  const outboxDir = env.ARTHUR_NOTIFICATION_OUTBOX_PATH;
  const enabledAt = Date.parse(env.ARTHUR_ORDER_NOTIFICATIONS_STARTED_AT || '');
  const orders = safeReadDirectory(ordersDir, ORDER_FILE);
  const notifications = safeReadDirectory(outboxDir, EVENT_FILE);
  const payment = {PAID:0,PAYMENT_NEW:0,PAYMENT_FAILED:0,PAYMENT_CANCELLED:0,none:0,other:0};
  const outbox = {pending:0,retry:0,sent:0,skipped:0,invalid:0};
  const events = {payment_confirmed:0,delivery_created:0,delivery_failed:0};
  let malformedOrders=0,eligiblePaid=0,eligibleMissingNotifications=0,
      overduePending=0,overdueRetry=0;
  const confirmedNotifications = new Set();
  for (const filename of notifications) {
    try {
      const record = readJSON(outboxDir,filename);
      const event = String(record.event || '');
      const status = String(record.status || '');
      if (!ALLOWED_EVENT.has(event) || !ALLOWED_STATUS.has(status) ||
          record.orderId + '.' + event + '.json' !== filename)
        throw new Error('BAD_EVENT');
      outbox[status]++;events[event]++;
      if (event === 'payment_confirmed') confirmedNotifications.add(record.orderId);
      const created = Date.parse(record.createdAt || '');
      if ((status === 'pending' || status === 'retry') &&
          Number.isFinite(created) && nowMs - created > PENDING_GRACE_MS) {
        if (status === 'pending') overduePending++;
        else overdueRetry++;
      }
    } catch {outbox.invalid++;}
  }
  for (const filename of orders) {
    try {
      const record = readJSON(ordersDir,filename);
      const state=String(record?.payment?.status || 'none');
      payment[PAYMENT_STATUS.has(state)?state:'other']++;
      const paidTime=Date.parse(record?.payment?.paidAt || '');
      if (state==='PAID' && Number.isFinite(enabledAt) && Number.isFinite(paidTime)
          && paidTime>=enabledAt) {
        eligiblePaid++;
        if (nowMs-paidTime>ELIGIBLE_GRACE_MS &&
            !confirmedNotifications.has(record.id))eligibleMissingNotifications++;
      }
    } catch {malformedOrders++;}
  }
  const warnings=[];
  if (!Number.isFinite(enabledAt))warnings.push('NOTIFICATION_START_DATE_MISSING');
  if (!env.ARTHUR_VOZDOOH_NOTIFICATIONS_URL)warnings.push('NOTIFICATION_DESTINATION_MISSING');
  if (!env.ARTHUR_VOZDOOH_NOTIFICATION_SECRET_FILE)warnings.push('NOTIFICATION_SIGNING_KEY_NOT_CONFIGURED');
  if (outbox.invalid || malformedOrders)warnings.push('MALFORMED_RECORDS');
  if (overduePending || overdueRetry)warnings.push('DELIVERY_BACKLOG');
  if (eligibleMissingNotifications)warnings.push('ELIGIBLE_PAYMENT_WITHOUT_NOTIFICATION');
  return {
    schemaVersion:1,checkedAt:new Date(nowMs).toISOString(),
    state:warnings.length?'attention':'ok',
    notificationPipelineConfigured:Number.isFinite(enabledAt)&&Boolean(env.ARTHUR_VOZDOOH_NOTIFICATIONS_URL)&&Boolean(env.ARTHUR_VOZDOOH_NOTIFICATION_SECRET_FILE),
    upstreamAckRecorded:outbox.sent>0,
    ordersTotal:orders.length,paymentStates:payment,
    eligiblePaid,eligibleMissingNotifications,
    outboxTotal:notifications.length,outbox,events,
    overduePending,overdueRetry,malformedOrders,warnings,
    caveat:'Observer does not send notifications, verify Telegram receipt, or create orders/payments.',
  };
}

if (require.main === module || process.argv[1] === '-') {
  try {console.log(JSON.stringify(audit()));}
  catch(e) {
    console.log(JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),
      state:'not_checked',reason:String(e.code||e.message||'AUDIT_UNAVAILABLE').slice(0,70)}));
    process.exitCode=2;
  }
}
module.exports={audit};
