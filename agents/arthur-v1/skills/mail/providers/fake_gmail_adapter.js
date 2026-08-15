'use strict';

const { FakeMailAdapter } = require('./fake_mail_adapter');

class FakeGmailAdapter extends FakeMailAdapter {
  constructor(options = {}) {
    super({ ...options, provider: 'gmail' });
  }
}

function createFakeGmailAdapter(options = {}) {
  return new FakeGmailAdapter(options);
}

module.exports = {
  FakeGmailAdapter,
  createFakeGmailAdapter,
};
