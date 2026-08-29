'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const {
  createKpiAutomation,
  buildDailyReport,
  buildWeeklyReport,
  evaluateAlerts,
  DEFAULT_TIMEZONE,
} = require('../skills/business_kpi/kpi_automation');

const FIXED_NOW = new Date('2026-08-28T10:00:00.000Z');

function normalizeSpaces(text) {
  return text.replace(/[\s\u00A0]/g, ' ');
}

function createFakeSkill(overrides = {}) {
  const defaults = {
    getStoreSummary: async () => ({
      revenueFormatted: '702 688 ₽',
      planFormatted: '745 000 ₽',
      planPercentFormatted: '94,3%',
      forecastFormatted: '806 790 ₽',
      remainingToPlan: 42_311.60,
      receipts: 653,
      averageCheckFormatted: '1 076 ₽',
      itemsPerCheckFormatted: '2,90',
      qrShareFormatted: '26,6%',
      shifts: 27,
      dataStatusLabel: 'частичные',
      revenue: 702_688.40,
      plan: 745_000,
      planCompletion: 0.943,
      forecast: 806_790.39,
      averageCheck: 1076.09,
      itemsPerCheck: 2.90,
      qrShare: 0.266,
      itemsCheckCoverage: '27/27',
      provenance: { retrievedAt: FIXED_NOW.toISOString() },
    }),
    getTodaySummary: async () => ({
      date: '2026-08-28',
      revenueFormatted: '28 500 ₽',
      receipts: 27,
      averageCheckFormatted: '1 055 ₽',
      itemsPerCheckFormatted: '2,85',
      qrShareFormatted: '25,0%',
      shifts: 2,
      dataStatusLabel: 'полные',
      dataStatus: 'COMPLETE',
      revenue: 28_500,
      averageCheck: 1055,
      itemsPerCheck: 2.85,
      qrShare: 0.25,
      provenance: { retrievedAt: FIXED_NOW.toISOString() },
    }),
    getSellerPerformance: async () => ({
      sellers: [
        {
          employeeId: '1',
          name: 'Капитанова',
          currentKpi: 88.57,
          previousKpi: 96.46,
          currentKpiFormatted: '88,57',
          averageCheckFormatted: '1 100 ₽',
          itemsPerCheckFormatted: '2,95',
          qrShareFormatted: '27,0%',
        },
        {
          employeeId: '2',
          name: 'Чередниченко',
          currentKpi: 93.44,
          previousKpi: 92.40,
          currentKpiFormatted: '93,44',
          averageCheckFormatted: '1 050 ₽',
          itemsPerCheckFormatted: '2,80',
          qrShareFormatted: '26,0%',
        },
        {
          employeeId: '3',
          name: 'Кущев',
          currentKpi: 90.00,
          previousKpi: 90.00,
          currentKpiFormatted: '90,00',
          averageCheckFormatted: '1 000 ₽',
          itemsPerCheckFormatted: '2,50',
          qrShareFormatted: '20,0%',
        },
      ],
      teamSignals: {},
    }),
    getShifts: async ({ dateFrom, dateTo }) => {
      const items = [];
      if (dateFrom <= '2026-08-28' && dateTo >= '2026-08-28') {
        items.push(
          { id: '1', date: '2026-08-28', employeeName: 'Капитанова', revenue: 15000, receipts: 14, itemsSold: 40, qr: 4000, kpi: 94.0 },
          { id: '2', date: '2026-08-28', employeeName: 'Чередниченко', revenue: 13500, receipts: 13, itemsSold: 37, qr: 3000, kpi: 93.0 }
        );
      }
      if (dateFrom <= '2026-08-27' && dateTo >= '2026-08-22') {
        items.push(
          { id: '3', date: '2026-08-27', employeeName: 'Капитанова', revenue: 16000, receipts: 15, itemsSold: 42, qr: 4500, kpi: 95.0 },
          { id: '4', date: '2026-08-26', employeeName: 'Чередниченко', revenue: 14000, receipts: 13, itemsSold: 38, qr: 3500, kpi: 94.0 },
          { id: '5', date: '2026-08-25', employeeName: 'Капитанова', revenue: 17000, receipts: 16, itemsSold: 45, qr: 4800, kpi: 96.0 },
          { id: '6', date: '2026-08-24', employeeName: 'Чередниченко', revenue: 13000, receipts: 12, itemsSold: 35, qr: 3200, kpi: 92.0 },
          { id: '7', date: '2026-08-23', employeeName: 'Капитанова', revenue: 15500, receipts: 14, itemsSold: 41, qr: 4200, kpi: 94.5 },
          { id: '8', date: '2026-08-22', employeeName: 'Чередниченко', revenue: 14500, receipts: 13, itemsSold: 36, qr: 3600, kpi: 93.5 }
        );
      }
      if (dateFrom <= '2026-08-21' && dateTo >= '2026-08-15') {
        items.push(
          { id: '9', date: '2026-08-21', employeeName: 'Капитанова', revenue: 18000, receipts: 16, itemsSold: 48, qr: 5000, kpi: 97.0 },
          { id: '10', date: '2026-08-20', employeeName: 'Чередниченко', revenue: 12000, receipts: 11, itemsSold: 33, qr: 2800, kpi: 91.0 },
          { id: '11', date: '2026-08-19', employeeName: 'Капитанова', revenue: 17500, receipts: 15, itemsSold: 46, qr: 4900, kpi: 96.5 },
          { id: '12', date: '2026-08-18', employeeName: 'Чередниченко', revenue: 12500, receipts: 12, itemsSold: 34, qr: 2900, kpi: 91.5 },
          { id: '13', date: '2026-08-17', employeeName: 'Капитанова', revenue: 16500, receipts: 14, itemsSold: 43, qr: 4600, kpi: 95.5 },
          { id: '14', date: '2026-08-16', employeeName: 'Чередниченко', revenue: 13500, receipts: 13, itemsSold: 36, qr: 3100, kpi: 92.5 },
          { id: '15', date: '2026-08-15', employeeName: 'Капитанова', revenue: 17000, receipts: 15, itemsSold: 44, qr: 4700, kpi: 96.0 }
        );
      }
      return { shifts: items, count: items.length };
    },
    getSettings: async () => ({
      found: true,
      version: 1,
      effectiveFrom: '2026-08-01',
      settings: {
        targets: {
          averageCheck: 1100,
          itemsPerReceipt: 3.0,
          qrShare: 0.30,
          sellerShifts: 14,
        },
      },
    }),
    getDataQuality: async () => ({
      dataStatus: 'PARTIAL',
      dataStatusLabel: 'частичные',
      itemsCheckCoverage: '26/27',
      incompleteSellers: [{ name: 'Капитанова', missingFields: ['itemsSold'] }],
    }),
  };

  const handlers = { ...defaults, ...overrides };

  return {
    execute: async ({ operation, parameters }) => {
      const handler = handlers[operation];
      if (!handler) {
        throw new Error(`Unsupported operation: ${operation}`);
      }
      const data = await handler(parameters);
      return { status: 'success', data, responseText: '', metadata: { operation } };
    },
  };
}

function createFakeStateStore() {
  const states = new Map();
  const runs = [];
  return {
    getAlertState: async (ownerId, alertType, entityId) => {
      return states.get(`${ownerId}:${alertType}:${entityId}`) || null;
    },
    upsertAlertState: async (state) => {
      const key = `${state.ownerId}:${state.alertType}:${state.entityId}`;
      const upserted = {
        ...state,
        state: state.state,
        sentCount: (states.get(key)?.sentCount || 0) + 1,
      };
      states.set(key, upserted);
      return upserted;
    },
    resolveAlertState: async (ownerId, alertType, entityId) => {
      const key = `${ownerId}:${alertType}:${entityId}`;
      const existing = states.get(key);
      if (existing) {
        existing.state = 'ok';
        existing.resolvedAt = FIXED_NOW.toISOString();
      }
    },
    recordRun: async (run) => {
      runs.push(run);
    },
    getLastRun: async () => null,
    listRecentAlertStates: async () => Array.from(states.values()),
    _states: states,
    _runs: runs,
  };
}

describe('KpiAutomation daily report', () => {
  test('builds daily report excluding owner from sellers', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildDailyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('📊 Миска — итоги дня'));
    assert.ok(normalizeSpaces(report.text).includes('28 500 ₽'));
    assert.ok(report.text.includes('Капитанова'));
    assert.ok(report.text.includes('Чередниченко'));
    assert.ok(!report.text.includes('Кущев'));
  });

  test('reports partial data status', async () => {
    const skill = createFakeSkill({
      getTodaySummary: async () => ({
        date: '2026-08-28',
        dataStatus: 'PARTIAL',
        dataStatusLabel: 'частичные',
        revenue: 28_500,
        receipts: 27,
        averageCheck: 1055,
        itemsPerCheck: 2.85,
        qrShare: 0.25,
      }),
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildDailyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('предварительные итоги дня'), `expected preliminary title, got: ${report.text}`);
    assert.ok(report.text.includes('Данные: частичные'), `expected partial label, got: ${report.text}`);
    assert.ok(report.text.includes('Данные за сегодня частичные'), `expected partial note, got: ${report.text}`);
  });
});

describe('KpiAutomation weekly report', () => {
  test('compares last 7 days vs previous 7 days and excludes owner', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('📈 Миска — итоги недели'));
    assert.ok(report.text.includes('Капитанова'));
    assert.ok(report.text.includes('Чередниченко'));
    assert.ok(!report.text.includes('Кущев'));
    assert.ok(report.text.includes('План месяца'));
    assert.ok(report.text.includes('Динамика магазина'));
  });

  test('ranks best seller by KPI', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('🥇 Лучший результат недели'));
  });
});

describe('KpiAutomation alerts', () => {
  test('sends plan risk alert when forecast below plan', async () => {
    const skill = createFakeSkill({
      getStoreSummary: async () => ({
        revenue: 400_000,
        plan: 745_000,
        planCompletion: 0.53,
        forecast: 600_000,
        remainingToPlan: 345_000,
        revenueFormatted: '400 000 ₽',
        planFormatted: '745 000 ₽',
        forecastFormatted: '600 000 ₽',
        planPercentFormatted: '53,0%',
        dataStatusLabel: 'частичные',
        itemsPerCheckFormatted: '2,90',
        qrShareFormatted: '26,6%',
        averageCheckFormatted: '1 076 ₽',
        qrShare: 0.266,
        itemsPerCheck: 2.90,
        averageCheck: 1076.09,
        itemsCheckCoverage: '20/27',
      }),
    });
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: DEFAULT_TIMEZONE,
      ownerId: 'owner',
      cooldownMinutes: 60,
      now: FIXED_NOW,
    });

    const planRisk = result.alertsSent.find(a => a.alertType === 'plan_risk');
    assert.ok(planRisk, 'expected plan risk alert');
    assert.ok(result.messages.some(m => m.includes('риск невыполнения плана')));
  });

  test('sends seller KPI drop alert on significant decrease', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: DEFAULT_TIMEZONE,
      ownerId: 'owner',
      cooldownMinutes: 60,
      now: FIXED_NOW,
    });

    const sellerDrop = result.alertsSent.find(a => a.alertType === 'seller_kpi_drop' && a.entityId === 'Капитанова');
    assert.ok(sellerDrop, 'expected seller KPI drop alert for Капитанова');
  });

  test('does not duplicate alerts within cooldown', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });
    const second = await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    assert.equal(second.alertsSent.length, 0);
    assert.equal(second.noActionReason, 'no_conditions_met');
  });

  test('sends first identical alert and suppresses immediate duplicate', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    const first = await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });
    const second = await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    assert.ok(first.alertsSent.length > 0, 'expected first evaluation to send');
    assert.equal(second.alertsSent.length, 0, 'expected identical second evaluation to be suppressed');
    assert.equal(second.noActionReason, 'no_conditions_met');
  });

  test('suppresses identical alert after restart using persisted digest state', async () => {
    const skill = createFakeSkill();
    const firstStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, firstStore);
    const first = await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    // Simulate restart: new state store instance seeded with persisted state.
    const restartedStore = createFakeStateStore();
    for (const [key, value] of firstStore._states.entries()) {
      restartedStore._states.set(key, { ...value });
    }
    const restartedAutomation = createKpiAutomation(skill, restartedStore);
    const afterRestart = await restartedAutomation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    assert.ok(first.alertsSent.length > 0, 'expected first evaluation to send');
    assert.equal(afterRestart.alertsSent.length, 0, 'expected identical evaluation after restart to be suppressed');
  });

  test('sends alert on meaningful deterioration even within cooldown', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    const worseSkill = createFakeSkill({
      getStoreSummary: async () => ({
        revenue: 702_688.40,
        plan: 745_000,
        planCompletion: 0.943,
        forecast: 806_790.39,
        remainingToPlan: 42_311.60,
        revenueFormatted: '702 688 ₽',
        planFormatted: '745 000 ₽',
        forecastFormatted: '806 790 ₽',
        planPercentFormatted: '94,3%',
        dataStatusLabel: 'частичные',
        itemsPerCheckFormatted: '2,90',
        qrShareFormatted: '26,6%',
        averageCheckFormatted: '1 000 ₽',
        qrShare: 0.266,
        itemsPerCheck: 2.90,
        averageCheck: 1000, // dropped from 1076
        itemsCheckCoverage: '27/27',
      }),
    });
    const worseAutomation = createKpiAutomation(worseSkill, stateStore);
    const result = await worseAutomation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    const averageCheckAlert = result.alertsSent.find(a => a.alertType === 'average_check');
    assert.ok(averageCheckAlert, 'expected new average_check alert after meaningful deterioration');
  });

  test('recovery transitions state to ok and dryRun does not mutate state', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    const normalSkill = createFakeSkill({
      getSellerPerformance: async () => ({
        sellers: [
          { employeeId: '1', name: 'Капитанова', currentKpi: 95.00, previousKpi: 94.50, currentKpiFormatted: '95,00' },
          { employeeId: '2', name: 'Чередниченко', currentKpi: 94.00, previousKpi: 93.00, currentKpiFormatted: '94,00' },
        ],
        teamSignals: {},
      }),
      getStoreSummary: async () => ({
        revenue: 750_000,
        plan: 745_000,
        planCompletion: 1.01,
        forecast: 800_000,
        remainingToPlan: -5_000,
        revenueFormatted: '750 000 ₽',
        planFormatted: '745 000 ₽',
        forecastFormatted: '800 000 ₽',
        planPercentFormatted: '101,0%',
        dataStatusLabel: 'полные',
        itemsPerCheckFormatted: '3,10',
        qrShareFormatted: '31,0%',
        averageCheckFormatted: '1 120 ₽',
        qrShare: 0.31,
        itemsPerCheck: 3.10,
        averageCheck: 1120,
        itemsCheckCoverage: '27/27',
      }),
      getTodaySummary: async () => ({
        date: '2026-08-28',
        revenueFormatted: '30 000 ₽',
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        revenue: 30_000,
      }),
      getDataQuality: async () => ({
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        itemsCheckCoverage: '27/27',
        incompleteSellers: [],
      }),
    });
    const normalAutomation = createKpiAutomation(normalSkill, stateStore);
    const recoveryResult = await normalAutomation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    assert.ok(recoveryResult.messages.some(m => m.includes('восстановился') || m.includes('восстановилась')), 'expected recovery message');
    const sellerState = await stateStore.getAlertState('owner', 'seller_kpi_drop', 'Капитанова');
    assert.equal(sellerState.state, 'ok', 'expected seller_kpi_drop alert resolved to ok');

    const dryRunResult = await normalAutomation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW, dryRun: true });
    assert.equal(dryRunResult.alertsSent.length, 0, 'dryRun must not return alertsSent');
    assert.ok(dryRunResult.wouldSend.length === 0, 'expected no would-send alerts in stable state');
    assert.equal(dryRunResult.dryRun, true);
  });

  test('sends new deterioration alert after recovery', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);

    // First deterioration
    const first = await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });
    assert.ok(first.alertsSent.some(a => a.alertType === 'seller_kpi_drop' && a.entityId === 'Капитанова'));

    // Recovery
    const normalSkill = createFakeSkill({
      getSellerPerformance: async () => ({
        sellers: [
          { employeeId: '1', name: 'Капитанова', currentKpi: 95.00, previousKpi: 94.50, currentKpiFormatted: '95,00' },
          { employeeId: '2', name: 'Чередниченко', currentKpi: 94.00, previousKpi: 93.00, currentKpiFormatted: '94,00' },
        ],
        teamSignals: {},
      }),
      getStoreSummary: async () => ({
        revenue: 750_000,
        plan: 745_000,
        planCompletion: 1.01,
        forecast: 800_000,
        remainingToPlan: -5_000,
        averageCheck: 1120,
        itemsPerCheck: 3.10,
        qrShare: 0.31,
        itemsCheckCoverage: '27/27',
      }),
      getDataQuality: async () => ({
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        itemsCheckCoverage: '27/27',
        incompleteSellers: [],
      }),
    });
    await createKpiAutomation(normalSkill, stateStore).evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    // New deterioration after recovery
    const newDeterioration = await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });
    assert.ok(newDeterioration.alertsSent.some(a => a.alertType === 'seller_kpi_drop' && a.entityId === 'Капитанова'), 'expected seller KPI drop alert after recovery');
  });

  test('recovers alert when metric returns to normal', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    await automation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    const normalSkill = createFakeSkill({
      getSellerPerformance: async () => ({
        sellers: [
          { employeeId: '1', name: 'Капитанова', currentKpi: 95.00, previousKpi: 94.50, currentKpiFormatted: '95,00' },
          { employeeId: '2', name: 'Чередниченко', currentKpi: 94.00, previousKpi: 93.00, currentKpiFormatted: '94,00' },
        ],
        teamSignals: {},
      }),
      getStoreSummary: async () => ({
        revenue: 750_000,
        plan: 745_000,
        planCompletion: 1.01,
        forecast: 800_000,
        remainingToPlan: -5_000,
        revenueFormatted: '750 000 ₽',
        planFormatted: '745 000 ₽',
        forecastFormatted: '800 000 ₽',
        planPercentFormatted: '101,0%',
        dataStatusLabel: 'полные',
        itemsPerCheckFormatted: '3,10',
        qrShareFormatted: '31,0%',
        averageCheckFormatted: '1 120 ₽',
        qrShare: 0.31,
        itemsPerCheck: 3.10,
        averageCheck: 1120,
        itemsCheckCoverage: '27/27',
      }),
      getTodaySummary: async () => ({
        date: '2026-08-28',
        revenueFormatted: '30 000 ₽',
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        revenue: 30_000,
      }),
      getDataQuality: async () => ({
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        itemsCheckCoverage: '27/27',
        incompleteSellers: [],
      }),
    });
    const normalAutomation = createKpiAutomation(normalSkill, stateStore);
    const result = await normalAutomation.evaluateAlerts({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, ownerId: 'owner', cooldownMinutes: 60, now: FIXED_NOW });

    assert.ok(result.messages.some(m => m.includes('восстановился') || m.includes('восстановилась')));
  });

  test('data quality alert on partial data', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: DEFAULT_TIMEZONE,
      ownerId: 'owner',
      cooldownMinutes: 60,
      now: FIXED_NOW,
    });

    const dataQuality = result.alertsSent.find(a => a.alertType === 'data_quality');
    assert.ok(dataQuality, 'expected data quality alert');
  });

  test('does not raise data quality alert for intraday partial data when coverage is full', async () => {
    const skill = createFakeSkill({
      getDataQuality: async () => ({
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        itemsCheckCoverage: '27/27',
        incompleteSellers: [],
      }),
      getTodaySummary: async () => ({
        date: '2026-08-28',
        revenueFormatted: '28 500 ₽',
        receipts: 27,
        averageCheckFormatted: '1 055 ₽',
        itemsPerCheckFormatted: '2,85',
        qrShareFormatted: '25,0%',
        shifts: 2,
        dataStatusLabel: 'частичные',
        dataStatus: 'PARTIAL',
        revenue: 28_500,
        averageCheck: 1055,
        itemsPerCheck: 2.85,
        qrShare: 0.25,
        provenance: { retrievedAt: FIXED_NOW.toISOString() },
      }),
    });
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: DEFAULT_TIMEZONE,
      ownerId: 'owner',
      cooldownMinutes: 60,
      now: FIXED_NOW,
    });

    const dataQuality = result.alertsSent.find(a => a.alertType === 'data_quality');
    assert.ok(!dataQuality, 'expected no data quality alert for full coverage intraday');
  });
});

describe('KpiAutomation formatting regressions', () => {
  test('shows seller KPI as score, not multiplied percent', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(report.text.includes('KPI 93,44'), `report should include KPI score, got: ${report.text}`);
    assert.ok(!report.text.includes('9 344%'), `report should not multiply KPI by 100, got: ${report.text}`);
    assert.ok(!report.text.includes('93,44%'), `report should not append percent to KPI score, got: ${report.text}`);
  });

  test('shows seller KPI delta in points', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(report.text.includes('KPI снизился на 7,89 пункта.'), `expected points delta, got: ${report.text}`);
    assert.ok(report.text.includes('(-7,89 п.)'), `expected signed points delta in summary, got: ${report.text}`);
  });

  test('alert message shows KPI delta in points', async () => {
    const skill = createFakeSkill();
    const stateStore = createFakeStateStore();
    const automation = createKpiAutomation(skill, stateStore);
    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: DEFAULT_TIMEZONE,
      ownerId: 'owner',
      cooldownMinutes: 60,
      now: FIXED_NOW,
    });

    const message = result.messages.find(m => m.includes('Капитанова'));
    assert.ok(message, 'expected seller KPI drop message');
    assert.ok(message.includes('изменение: -7,89 п.'), `expected points delta in alert, got: ${message}`);
    assert.ok(!message.includes('%'), `alert delta should not use percent, got: ${message}`);
  });

  test('negative delta narrative has no plus sign', async () => {
    const skill = createFakeSkill({
      getShifts: async ({ dateFrom, dateTo }) => {
        const items = [];
        // last 7 days (21–27 Aug for FIXED_NOW)
        if (dateFrom <= '2026-08-27' && dateTo >= '2026-08-21') {
          items.push(
            { id: 'l1', date: '2026-08-21', employeeName: 'Капитанова', revenue: 10000, receipts: 10, itemsSold: 25, qr: 1000, kpi: 90 },
            { id: 'l2', date: '2026-08-22', employeeName: 'Чередниченко', revenue: 10000, receipts: 10, itemsSold: 25, qr: 1000, kpi: 90 }
          );
        }
        // previous 7 days (14–20 Aug)
        if (dateFrom <= '2026-08-20' && dateTo >= '2026-08-14') {
          items.push(
            { id: 'p1', date: '2026-08-15', employeeName: 'Капитанова', revenue: 20000, receipts: 10, itemsSold: 25, qr: 1000, kpi: 90 },
            { id: 'p2', date: '2026-08-16', employeeName: 'Чередниченко', revenue: 20000, receipts: 10, itemsSold: 25, qr: 1000, kpi: 90 }
          );
        }
        return { shifts: items, count: items.length };
      },
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(report.text.includes('Выручка снизилась на'), `expected revenue decline narrative, got: ${report.text}`);
    assert.ok(!normalizeSpaces(report.text).includes('снизилась на +'), `negative narrative should not contain plus, got: ${report.text}`);
  });

  test('uses safe seller attention wording', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(report.text.includes('Проверить показатели продавца:'), `expected safe wording, got: ${report.text}`);
    assert.ok(!report.text.includes('Проверить работу'), `should not use unreliable inflection, got: ${report.text}`);
  });

  test('formats money without kopecks in management reports', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(!report.text.includes(',00 ₽'), `management report should not show kopecks, got: ${report.text}`);
  });
});

describe('KpiAutomation weekly period semantics', () => {
  test('mid-day preview excludes current day and shows preliminary note', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    // 2026-08-29 00:00 UTC = 10:00 Asia/Vladivostok (before 20:30 cutoff)
    const now = new Date('2026-08-29T00:00:00.000Z');
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now });

    assert.ok(report.text.includes('22–28 августа 2026'), `expected period ending yesterday, got: ${report.text}`);
    assert.ok(report.text.includes('Сегодняшний день ещё не завершён'), `expected preliminary note, got: ${report.text}`);
  });

  test('Sunday 20:30 production run includes current day', async () => {
    const skill = createFakeSkill();
    const automation = createKpiAutomation(skill, createFakeStateStore());
    // 2026-08-29 10:30 UTC = 20:30 Asia/Vladivostok
    const now = new Date('2026-08-29T10:30:00.000Z');
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now });

    assert.ok(report.text.includes('23–29 августа 2026'), `expected period ending today, got: ${report.text}`);
    assert.ok(!report.text.includes('Сегодняшний день ещё не завершён'), `should not warn at production time, got: ${report.text}`);
  });
});

describe('KpiAutomation daily data status', () => {
  test('NO_DATA does not show zero sales', async () => {
    const skill = createFakeSkill({
      getTodaySummary: async () => ({
        date: '2026-08-29',
        dataStatus: 'NO_DATA',
        dataStatusLabel: 'нет данных',
        revenue: null,
        receipts: null,
        averageCheck: null,
        itemsPerCheck: null,
        qrShare: null,
      }),
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildDailyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('предварительные итоги дня'), `expected preliminary title, got: ${report.text}`);
    assert.ok(report.text.includes('Данные сегодняшней смены ещё не загружены'), `expected no-data message, got: ${report.text}`);
    assert.ok(!report.text.includes('• Выручка: 0 ₽'), `should not render zero revenue, got: ${report.text}`);
    assert.ok(!report.text.includes('• Чеков: 0'), `should not render zero receipts, got: ${report.text}`);
    assert.ok(report.text.includes('Месяц:'), `should still show month block, got: ${report.text}`);
  });

  test('today sellers are built only from today shifts', async () => {
    const skill = createFakeSkill({
      getTodaySummary: async () => ({
        date: '2026-08-28',
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        revenue: 15000,
        receipts: 14,
        averageCheck: 1071.43,
        itemsPerCheck: 2.86,
        qrShare: 0.267,
      }),
      getShifts: async ({ dateFrom, dateTo }) => {
        const items = [];
        if (dateFrom <= '2026-08-28' && dateTo >= '2026-08-28') {
          items.push(
            { id: '1', date: '2026-08-28', employeeName: 'Капитанова', revenue: 15000, receipts: 14, itemsSold: 40, qr: 4000, kpi: 94.0 },
          );
        }
        if (dateFrom <= '2026-08-27' && dateTo >= '2026-08-27') {
          items.push(
            { id: '2', date: '2026-08-27', employeeName: 'Чередниченко', revenue: 20000, receipts: 18, itemsSold: 50, qr: 5000, kpi: 95.0 },
          );
        }
        return { shifts: items, count: items.length };
      },
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildDailyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('Капитанова'), `expected Капитанова from today shift, got: ${report.text}`);
    assert.ok(!report.text.includes('Чередниченко'), `should not include yesterday shift seller, got: ${report.text}`);
  });

  test('real zero-revenue shift shows zero sales', async () => {
    const skill = createFakeSkill({
      getTodaySummary: async () => ({
        date: '2026-08-28',
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        revenue: 0,
        receipts: 0,
        averageCheck: null,
        itemsPerCheck: null,
        qrShare: null,
      }),
      getShifts: async () => ({ shifts: [{ id: '1', date: '2026-08-28', employeeName: 'Капитанова', revenue: 0, receipts: 0, itemsSold: 0, qr: 0, kpi: 0 }], count: 1 }),
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildDailyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(report.text.includes('• Выручка: 0 ₽'), `expected zero revenue, got: ${report.text}`);
    assert.ok(report.text.includes('• Чеков: 0'), `expected zero receipts, got: ${report.text}`);
  });

  test('empty seller rows are not rendered', async () => {
    const skill = createFakeSkill({
      getTodaySummary: async () => ({
        date: '2026-08-28',
        dataStatus: 'COMPLETE',
        dataStatusLabel: 'полные',
        revenue: 15000,
        receipts: 14,
        averageCheck: 1071.43,
        itemsPerCheck: 2.86,
        qrShare: 0.267,
      }),
      getShifts: async () => ({ shifts: [{ id: '1', date: '2026-08-28', employeeName: 'Капитанова', revenue: null, receipts: null, itemsSold: null, qr: null, kpi: null }], count: 1 }),
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildDailyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE });

    assert.ok(!report.text.includes('Капитанова'), `should not render seller without metrics, got: ${report.text}`);
    assert.ok(!report.text.match(/•\s*\n/), `should not render empty bullet, got: ${report.text}`);
  });
});

describe('KpiAutomation QR share delta', () => {
  test('shows QR share delta in percentage points', async () => {
    const skill = createFakeSkill({
      getShifts: async ({ dateFrom, dateTo }) => {
        const items = [];
        // last 7 days (21–27 Aug)
        if (dateFrom <= '2026-08-27' && dateTo >= '2026-08-21') {
          items.push(
            { id: 'l1', date: '2026-08-21', employeeName: 'Капитанова', revenue: 10000, receipts: 10, itemsSold: 25, qr: 2950, kpi: 90 },
            { id: 'l2', date: '2026-08-22', employeeName: 'Чередниченко', revenue: 10000, receipts: 10, itemsSold: 25, qr: 2950, kpi: 90 },
          );
        }
        // previous 7 days (14–20 Aug)
        if (dateFrom <= '2026-08-20' && dateTo >= '2026-08-14') {
          items.push(
            { id: 'p1', date: '2026-08-15', employeeName: 'Капитанова', revenue: 10000, receipts: 10, itemsSold: 25, qr: 2400, kpi: 90 },
            { id: 'p2', date: '2026-08-16', employeeName: 'Чередниченко', revenue: 10000, receipts: 10, itemsSold: 25, qr: 2400, kpi: 90 },
          );
        }
        return { shifts: items, count: items.length };
      },
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(report.text.includes('(+5,5 п.п.)'), `expected QR delta in percentage points, got: ${report.text}`);
    assert.ok(report.text.includes('Доля QR выросла на 5,5 п.п.'), `expected QR narrative in pp, got: ${report.text}`);
    assert.ok(!report.text.includes('(+22,9%)'), `should not use relative percent for QR share, got: ${report.text}`);
  });

  test('shows negative QR share delta in percentage points', async () => {
    const skill = createFakeSkill({
      getShifts: async ({ dateFrom, dateTo }) => {
        const items = [];
        if (dateFrom <= '2026-08-27' && dateTo >= '2026-08-21') {
          items.push(
            { id: 'l1', date: '2026-08-21', employeeName: 'Капитанова', revenue: 10000, receipts: 10, itemsSold: 25, qr: 2400, kpi: 90 },
          );
        }
        if (dateFrom <= '2026-08-20' && dateTo >= '2026-08-14') {
          items.push(
            { id: 'p1', date: '2026-08-15', employeeName: 'Капитанова', revenue: 10000, receipts: 10, itemsSold: 25, qr: 2950, kpi: 90 },
          );
        }
        return { shifts: items, count: items.length };
      },
    });
    const automation = createKpiAutomation(skill, createFakeStateStore());
    const report = await automation.buildWeeklyReport({ storeId: 'miska', timezone: DEFAULT_TIMEZONE, now: FIXED_NOW });

    assert.ok(report.text.includes('(-5,5 п.п.)'), `expected negative QR delta in pp, got: ${report.text}`);
  });
});
