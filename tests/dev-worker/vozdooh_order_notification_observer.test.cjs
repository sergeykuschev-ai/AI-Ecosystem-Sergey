'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {audit}=require('./arthur-vozdooh-notification-observer.cjs');

function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vozdooh-notification-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const orders=path.join(root,'orders'),outbox=path.join(root,'outbox');
 fs.mkdirSync(orders);fs.mkdirSync(outbox);
 const env={
  ORDER_REQUEST_STORE_PATH:orders,
  ARTHUR_NOTIFICATION_OUTBOX_PATH:outbox,
  ARTHUR_ORDER_NOTIFICATIONS_STARTED_AT:'2026-10-09T00:00:00.000Z',
  ARTHUR_VOZDOOH_NOTIFICATIONS_URL:'http://127.0.0.1:8788/internal/vozdooh/order-notification',
  ARTHUR_VOZDOOH_NOTIFICATION_SECRET_FILE:'/tmp/testing-only-no-key-read',
 };
 return {env,orders,outbox};
}
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const name=id+'.json';
const now=Date.parse('2026-10-09T10:00:00.000Z');
test('reports healthy empty outbox without pretending delivery verified',t=>{
 const p=setup(t);
 const x=audit({env:p.env,nowMs:now});
 assert.equal(x.state,'ok');
 assert.equal(x.upstreamAckRecorded,false);
 assert.equal(x.eligiblePaid,0);
 assert.equal(x.ordersTotal,0);
});
test('paid order older than grace is flagged until notification outbox exists',t=>{
 const p=setup(t);
 const order={id,payment:{status:'PAID',paidAt:'2026-10-09T09:00:00.000Z'},
  input:{contact:{name:'PRIVATE_CUSTOMER',phone:'PRIVATE_PHONE'}}};
 fs.writeFileSync(path.join(p.orders,name),JSON.stringify(order));
 const before=audit({env:p.env,nowMs:now});
 assert.equal(before.state,'attention');
 assert.equal(before.eligiblePaid,1);
 assert.equal(before.eligibleMissingNotifications,1);
 assert.ok(before.warnings.includes('ELIGIBLE_PAYMENT_WITHOUT_NOTIFICATION'));
 assert.doesNotMatch(JSON.stringify(before),/PRIVATE_CUSTOMER|PRIVATE_PHONE/);
 const event={version:1,eventId:'example',orderId:id,event:'payment_confirmed',
  status:'pending',createdAt:'2026-10-09T09:59:00.000Z'};
 fs.writeFileSync(path.join(p.outbox,id+'.payment_confirmed.json'),JSON.stringify(event));
 const after=audit({env:p.env,nowMs:now});
 assert.equal(after.state,'ok');
 assert.equal(after.eligibleMissingNotifications,0);
 assert.equal(after.outbox.pending,1);
});
test('old retries trigger backlog without secrets, sent is verified historically',t=>{
 const p=setup(t);
 const file=path.join(p.outbox,id+'.payment_confirmed.json');
 const event={version:1,orderId:id,event:'payment_confirmed',status:'retry',
  createdAt:'2026-10-09T08:00:00.000Z',lastError:'TOP_SECRET_NOT_LOGGED'};
 fs.writeFileSync(file,JSON.stringify(event));
 const x=audit({env:p.env,nowMs:now});
 assert.equal(x.overdueRetry,1);
 assert.equal(x.state,'attention');
 assert.doesNotMatch(JSON.stringify(x),/TOP_SECRET_NOT_LOGGED/);
 event.status='sent';
 fs.writeFileSync(file,JSON.stringify(event));
 const sent=audit({env:p.env,nowMs:now});
 assert.equal(sent.upstreamAckRecorded,true);
 assert.equal(sent.state,'ok');
});
