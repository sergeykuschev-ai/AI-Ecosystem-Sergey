'use strict';

class OwnerNotificationClient {
  constructor(options = {}) {
    if (!options.url) throw new Error('OwnerNotificationClient requires url.');
    if (!options.serviceKey) throw new Error('OwnerNotificationClient requires serviceKey.');
    this.url = options.url;
    this.serviceKey = options.serviceKey;
    this.timeoutMs = options.timeoutMs || 5000;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async sendLearningAttempt(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + this.serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'SELLER_LEARNING_ATTEMPT',
          ...payload,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          'Owner notification gateway returned HTTP ' + response.status +
          (body ? ': ' + body.slice(0, 300) : '')
        );
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  OwnerNotificationClient,
};
