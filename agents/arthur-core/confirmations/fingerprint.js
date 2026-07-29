'use strict';

const crypto = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function createPayloadFingerprint(payload) {
  const canonical = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function verifyPayloadFingerprint(payload, expectedFingerprint) {
  if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    return false;
  }
  const actual = createPayloadFingerprint(payload);
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedFingerprint, 'hex'));
}

module.exports = { canonicalize, createPayloadFingerprint, verifyPayloadFingerprint };
