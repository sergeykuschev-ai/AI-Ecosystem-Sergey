'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { createKpiScheduler } = require('../telegram/kpi_scheduler');

function createFakeTelegram() {
  const messages = [];
  return {
    messages,
    sendMessage: async (chatId, text) => {
      messages.push({ chatId, text });
    },
  };
}

function createFakeSkill() {
  return {
    execute: async ({ operation }) => {
      if (operation === 'getStoreSummary') {
        return {
          status: 'success',
          data: {
            revenue: 100_000,
            plan: 200_000,
            forecast: 180_000,
            remainingToPlan: 100_000,
            planCompletion: 0.5,
            qrShare: 0.25,
            itemsPerCheck: 2.5,
            averageCheck: 1000,
            dataStatusLabel: 'частичные',
            revenueFormatted: '100 000 ₽',
            planFormatted: '200 000 ₽',
            forecastFormatted: '180 000 ₽',
            planPercentFormatted: '50,0%',
            itemsPerCheckFormatted: '2,50',
            qrShareFormatted: '25,0%',
            averageCheckFormatted: '1 000 ₽',
          },
        };
      }
      if (operation === 'getTodaySummary') {
        return {
          status: 'success',
          data: {
            date: '2026-08-28',
            revenue: 10_000,
            receipts: 10,
            averageCheck: 1000,
            itemsPerCheck: 2.5,
            qrShare: 0.25,
            shifts: 1,
            dataStatus: 'PARTIAL',
            dataStatusLabel: 'частичные',
            revenueFormatted: '10 000 ₽',
            averageCheckFormatted: '1 000 ₽',
            itemsPerCheckFormatted: '2,50',
            qrShareFormatted: '25,0%',
          },
        };
      }
      if (operation === 'getSellerPerformance') {
        return {
          status: 'success',
          data: {
            sellers: [
              { name: 'Капитанова', currentKpi: 0.90, previousKpi: 0.95, currentKpiFormatted: '90,00%' },
              { name: 'Чередниченко', currentKpi: 0.92, previousKpi: 0.91, currentKpiFormatted: '92,00%' },
            ],
            teamSignals: {},
          },
        };
      }
      if (operation === 'getShifts') {
        return { status: 'success', data: { shifts: [] } };
      }
      if (operation === 'getSettings') {
        return {
          status: 'success',
          data: {
            found: true,
            settings: { targets: { averageCheck: 1100, itemsPerReceipt: 3.0, qrShare: 0.30 } },
          },
        };
      }
      if (operation === 'getDataQuality') {
        return { status: 'success', data: { dataStatusLabel: 'частичные', itemsCheckCoverage: '1/1', incompleteSellers: [] } };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  };
}

function createFakeStateStore() {
  const states = new Map();
  const runs = [];
  return {
    getAlertState: async (ownerId, alertType, entityId) => states.get(`${ownerId}:${alertType}:${entityId}`) || null,
    upsertAlertState: async (state) => {
      const key = `${state.ownerId}:${state.alertType}:${state.entityId}`;
      states.set(key, state);
      return state;
    },
    resolveAlertState: async (ownerId, alertType, entityId) => {
      const key = `${ownerId}:${alertType}:${entityId}`;
      if (states.has(key)) states.get(key).state = 'ok';
    },
    recordRun: async (run) => runs.push(run),
    getLastRun: async () => null,
    listRecentAlertStates: async () => Array.from(states.values()),
  };
}

function createLogger() {
  const logs = [];
  return {
    logs,
    info: (event, ctx, meta) => logs.push({ level: 'info', event, ctx, meta }),
    warn: (event, ctx, meta) => logs.push({ level: 'warn', event, ctx, meta }),
    error: (event, ctx, meta) => logs.push({ level: 'error', event, ctx, meta }),
  };
}

describe('KpiScheduler configuration', () => {
  test('throws without database URL', async () => {
    const scheduler = createKpiScheduler({
      config: { daily: { enabled: true, time: '20:15' } },
      logger: createLogger(),
      telegramClient: createFakeTelegram(),
      businessKpiSkill: createFakeSkill(),
      ownerChatId: '123',
      storeId: 'miska',
    });
    await assert.rejects(scheduler.initialize(), /ARTHUR_DATABASE_URL/);
  });

  test('builds daily and weekly cron tasks', () => {
    const scheduler = createKpiScheduler({
      config: {
        daily: { enabled: true, time: '20:15' },
        weekly: { enabled: true, time: '20:30', day: 0 },
        alerts: { enabled: false },
      },
      logger: createLogger(),
      telegramClient: createFakeTelegram(),
      businessKpiSkill: createFakeSkill(),
      ownerChatId: '123',
      storeId: 'miska',
      stateStore: createFakeStateStore(),
      automation: { buildDailyReport: async () => ({ text: 'daily' }), buildWeeklyReport: async () => ({ text: 'weekly' }), evaluateAlerts: async () => ({ messages: [] }) },
    });
    scheduler.start();
    const health = scheduler.getHealth();
    assert.equal(health.running, true);
    assert.equal(health.taskCount, 2);
    assert.equal(health.automations.daily, true);
    assert.equal(health.automations.weekly, true);
    assert.equal(health.automations.alerts, false);
    scheduler.stop();
  });

  test('does not start when all automations disabled', () => {
    const scheduler = createKpiScheduler({
      config: { daily: { enabled: false }, weekly: { enabled: false }, alerts: { enabled: false } },
      logger: createLogger(),
    });
    scheduler.start();
    assert.equal(scheduler.getHealth().taskCount, 0);
    scheduler.stop();
  });
});

describe('KpiScheduler runs', () => {
  test('runDaily sends daily report to owner', async () => {
    const telegram = createFakeTelegram();
    const scheduler = createKpiScheduler({
      config: { daily: { enabled: true, time: '20:15' } },
      logger: createLogger(),
      telegramClient: telegram,
      businessKpiSkill: createFakeSkill(),
      ownerChatId: '123',
      storeId: 'miska',
      stateStore: createFakeStateStore(),
    });

    await scheduler.initialize();
    const result = await scheduler.runDaily();

    assert.equal(result.success, true);
    assert.equal(telegram.messages.length, 1);
    assert.equal(telegram.messages[0].chatId, '123');
    assert.ok(telegram.messages[0].text.includes('📊 Миска'));
    scheduler.stop();
    await scheduler.close();
  });

  test('runDaily with test flag prefixes message', async () => {
    const telegram = createFakeTelegram();
    const scheduler = createKpiScheduler({
      config: { daily: { enabled: true, time: '20:15' } },
      logger: createLogger(),
      telegramClient: telegram,
      businessKpiSkill: createFakeSkill(),
      ownerChatId: '123',
      storeId: 'miska',
      stateStore: createFakeStateStore(),
    });

    await scheduler.initialize();
    await scheduler.runDaily({ test: true });

    assert.ok(telegram.messages[0].text.includes('🧪 ТЕСТ'));
    scheduler.stop();
    await scheduler.close();
  });

  test('runWeekly sends weekly report to owner', async () => {
    const telegram = createFakeTelegram();
    const scheduler = createKpiScheduler({
      config: { weekly: { enabled: true, time: '20:30', day: 0 } },
      logger: createLogger(),
      telegramClient: telegram,
      businessKpiSkill: createFakeSkill(),
      ownerChatId: '123',
      storeId: 'miska',
      stateStore: createFakeStateStore(),
    });

    await scheduler.initialize();
    const result = await scheduler.runWeekly();

    assert.equal(result.success, true);
    assert.equal(telegram.messages.length, 1);
    assert.ok(telegram.messages[0].text.includes('📈 Миска'));
    scheduler.stop();
    await scheduler.close();
  });

  test('runAlerts sends alert messages', async () => {
    const telegram = createFakeTelegram();
    const scheduler = createKpiScheduler({
      config: { alerts: { enabled: true, intervalMinutes: 60 } },
      logger: createLogger(),
      telegramClient: telegram,
      businessKpiSkill: createFakeSkill(),
      ownerChatId: '123',
      storeId: 'miska',
      stateStore: createFakeStateStore(),
    });

    await scheduler.initialize();
    const result = await scheduler.runAlerts();

    assert.equal(result.success, true);
    assert.ok(result.messages.length > 0);
    assert.equal(telegram.messages.length, result.messages.length);
    scheduler.stop();
    await scheduler.close();
  });

  test('runDaily sends failure message on skill error', async () => {
    const telegram = createFakeTelegram();
    const badSkill = {
      execute: async () => { throw new Error('Business KPI down'); },
    };
    const scheduler = createKpiScheduler({
      config: { daily: { enabled: true, time: '20:15' } },
      logger: createLogger(),
      telegramClient: telegram,
      businessKpiSkill: badSkill,
      ownerChatId: '123',
      storeId: 'miska',
      stateStore: createFakeStateStore(),
    });

    await scheduler.initialize();
    const result = await scheduler.runDaily();

    assert.equal(result.success, false);
    assert.equal(telegram.messages.length, 1);
    assert.ok(telegram.messages[0].text.includes('не смог получить актуальные данные'));
    scheduler.stop();
    await scheduler.close();
  });
});
