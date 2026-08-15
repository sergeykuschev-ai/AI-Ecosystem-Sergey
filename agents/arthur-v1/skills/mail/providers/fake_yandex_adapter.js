'use strict';

const { FakeMailAdapter } = require('./fake_mail_adapter');

class FakeYandexAdapter extends FakeMailAdapter {
  constructor(options = {}) {
    super({ ...options, provider: 'yandex' });
  }
}

function createFakeYandexAdapter(options = {}) {
  return new FakeYandexAdapter(options);
}

module.exports = {
  FakeYandexAdapter,
  createFakeYandexAdapter,
};
