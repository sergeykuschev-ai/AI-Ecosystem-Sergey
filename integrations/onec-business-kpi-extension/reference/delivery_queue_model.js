'use strict';

const crypto = require('node:crypto');
const { nextRetryDelaySeconds } = require('./aggregation_model');

class DeliveryQueueModel {
  constructor({ now = () => new Date(), makeId = () => crypto.randomUUID() } = {}) {
    this.now = now;
    this.makeId = makeId;
    this.pending = [];
    this.delivered = [];
  }

  enqueue({ sourceInstance, record, mode = 'shadow' }) {
    if (mode !== 'shadow') {
      throw new Error('Apply requires a separate explicit activation workflow.');
    }
    const payload = {
      contractVersion: '1.0',
      sourceInstance,
      batchId: this.makeId(),
      records: [structuredClone(record)],
    };
    const item = {
      mode,
      batchId: payload.batchId,
      payload,
      attempts: 0,
      nextAttemptAt: this.now().toISOString(),
      status: 'pending',
    };
    this.pending.push(item);
    return structuredClone(item);
  }

  async process(send) {
    for (const item of this.pending.filter(item =>
      item.status === 'pending' && item.nextAttemptAt <= this.now().toISOString()
    )) {
      try {
        await send({
          path: '/api/integration/1c/v1/daily-sales/shadow',
          idempotencyKey: item.batchId,
          payload: structuredClone(item.payload),
        });
        item.status = 'delivered';
        this.delivered.push(structuredClone(item));
      } catch {
        item.attempts += 1;
        item.nextAttemptAt = new Date(
          this.now().getTime() + nextRetryDelaySeconds(item.attempts) * 1000
        ).toISOString();
      }
    }
    this.pending = this.pending.filter(item => item.status === 'pending');
  }
}

module.exports = { DeliveryQueueModel };
