'use strict';

const test = require('node:test');
const assert = require('node:assert');
const config = require('../config');
const { assessKimiUsage } = require('../kimiUsage');
const { chooseAgent } = require('../agent');

const quietLog = { info() {}, warn() {} };

function usage({ weeklyUsed = 40, fiveHourUsed = 50 } = {}) {
  return {
    kind: 'ok',
    summary: { window: { duration: 1, unit: 'week' }, used: weeklyUsed, limit: 100, reset_at: '2026-09-13T00:00:00Z' },
    limits: [{ window: { duration: 5, unit: 'hour' }, used: fiveHourUsed, limit: 100, reset_at: '2026-09-10T20:00:00Z' }],
  };
}

test('Kimi remains usable when every window is above the protected reserve', () => {
  const q = assessKimiUsage(usage({ weeklyUsed: 40, fiveHourUsed: 75 }), 10);
  assert.equal(q.usable, true);
  assert.equal(q.minRemainingPercent, 25);
});

test('weekly quota at 96% used switches away from Kimi with a 10% reserve', () => {
  const q = assessKimiUsage(usage({ weeklyUsed: 96, fiveHourUsed: 75 }), 10);
  assert.equal(q.usable, false);
  assert.equal(q.reason, 'reserve-protected');
  assert.equal(q.minRemainingPercent, 4);
});

test('five-hour window can independently trigger the reserve', () => {
  const q = assessKimiUsage(usage({ weeklyUsed: 20, fiveHourUsed: 95 }), 10);
  assert.equal(q.usable, false);
  assert.equal(q.minRemainingPercent, 5);
});

test('auto mode selects Codex when Kimi reserve is reached', async () => {
  const oldMode = config.agent.mode;
  const oldReserve = config.agent.kimiReservePercent;
  config.agent.mode = 'auto';
  config.agent.kimiReservePercent = 10;
  try {
    const selected = await chooseAgent(quietLog, { fetchUsage: async () => usage({ weeklyUsed: 96 }) });
    assert.equal(selected.agent, 'codex');
  } finally {
    config.agent.mode = oldMode;
    config.agent.kimiReservePercent = oldReserve;
  }
});

test('auto mode preserves Kimi quota and selects Codex if usage probe fails', async () => {
  const oldMode = config.agent.mode;
  config.agent.mode = 'auto';
  try {
    const selected = await chooseAgent(quietLog, { fetchUsage: async () => { throw new Error('offline'); } });
    assert.equal(selected.agent, 'codex');
    assert.equal(selected.reason, 'quota-probe-failed');
  } finally {
    config.agent.mode = oldMode;
  }
});
