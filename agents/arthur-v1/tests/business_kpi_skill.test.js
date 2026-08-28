'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const { createBusinessKpiSkill } = require('../skills/business_kpi/business_kpi_skill');
const { UnsupportedOperationError } = require('../errors/arthur_errors');

const FIXED_NOW = new Date('2026-08-27T12:00:00.000Z');

function createFakeClient(overrides = {}) {
  return {
    baseUrl: 'http://localhost:3000',
    serviceId: 'arthur.analytics',
    health: overrides.health || (async () => ({ ok: true })),
    getDashboard: overrides.getDashboard || (async () => ({ month: {}, sellers: [] })),
    getToday: overrides.getToday || (async () => ({ aggregate: {} })),
    getSellers: overrides.getSellers || (async () => ({ items: [] })),
    getSellerPerformance: overrides.getSellerPerformance || (async () => ({ items: [], teamSignals: {} })),
    getShifts: overrides.getShifts || (async () => ({ items: [] })),
    getShift: overrides.getShift || (async () => ({})),
    getBonuses: overrides.getBonuses || (async () => ({ items: [] })),
    getMonths: overrides.getMonths || (async () => []),
  };
}

function createTestSkill(client) {
  return createBusinessKpiSkill({ client, clock: () => FIXED_NOW });
}

describe('BusinessKpiSkill configuration', () => {
  test('throws without client', () => {
    assert.throws(() => createBusinessKpiSkill({}), TypeError);
  });

  test('exposes read-only capabilities', () => {
    const skill = createTestSkill(createFakeClient());
    assert.equal(skill.id, 'business_kpi');
    assert.equal(skill.readOnly, true);
    assert.ok(skill.capabilities.every(cap => cap.readOnly));
    assert.ok(skill.capabilities.some(cap => cap.id === 'getStoreSummary'));
  });

  test('health returns healthy when client health succeeds', async () => {
    const skill = createTestSkill(createFakeClient());
    const result = await skill.health();
    assert.equal(result.healthy, true);
    assert.equal(result.skill, 'business_kpi');
  });

  test('health returns unhealthy when client fails', async () => {
    const skill = createTestSkill(createFakeClient({
      health: async () => { throw new Error('down'); },
    }));
    const result = await skill.health();
    assert.equal(result.healthy, false);
  });

  test('execute rejects unsupported operation', async () => {
    const skill = createTestSkill(createFakeClient());
    await assert.rejects(skill.execute({ operation: 'deleteShift' }), UnsupportedOperationError);
  });
});

describe('BusinessKpiSkill store summary', () => {
  test('formats dashboard into compact structured result and response text', async () => {
    const client = createFakeClient({
      getDashboard: async () => ({
        month: {
          year: 2026,
          month: 8,
          revenue: 702688.40,
          plan: 750000,
          planCompletion: 0.9369,
          forecast: { projectedRevenue: 780000, remainingToPlan: 47311.60 },
          receipts: 653,
          averageCheck: 1076.09,
          itemsSold: 1894,
          itemsPerReceipt: 2.9004,
          qr: 123456,
          qrShare: 0.1757,
          shiftsCount: 27,
          dataStatus: 'COMPLETE',
          itemsCheckCoverage: { shiftsWithItems: 27, totalShifts: 27 },
        },
      }),
    });
    const skill = createTestSkill(client);
    const result = await skill.execute({ operation: 'getStoreSummary', parameters: { year: 2026, month: 8 } });

    assert.equal(result.status, 'success');
    assert.equal(result.data.revenue, 702688.40);
    assert.match(result.data.revenueFormatted, /702[\s\u00A0]688,40\s*₽/);
    assert.equal(result.data.itemsPerCheckFormatted, '2,90');
    assert.equal(result.data.itemsCheckCoverage, '27/27');
    assert.equal(result.data.dataStatusLabel, 'полные');
    assert.ok(result.responseText.includes('Миска'));
    assert.match(result.responseText, /702[\s\u00A0]688,40\s*₽/);
    assert.equal(result.data.provenance.source, 'Business KPI');
    assert.equal(result.data.provenance.retrievedAt, FIXED_NOW.toISOString());
  });

  test('renders null numeric values as null, not zero', async () => {
    const client = createFakeClient({
      getDashboard: async () => ({
        month: {
          revenue: null,
          receipts: null,
          itemsPerReceipt: null,
          qrShare: null,
          dataStatus: 'NO_DATA',
        },
      }),
    });
    const skill = createTestSkill(client);
    const result = await skill.execute({ operation: 'getStoreSummary' });
    assert.equal(result.data.revenue, null);
    assert.equal(result.data.revenueFormatted, null);
    assert.equal(result.data.itemsPerCheckFormatted, null);
    assert.equal(result.data.qrShareFormatted, null);
  });
});

describe('BusinessKpiSkill sellers', () => {
  test('finds seller by partial name match', async () => {
    const client = createFakeClient({
      getSellers: async () => ({
        items: [
          { employeeId: '1', employeeName: 'Капитанова', averageKpi: 0.9357, bonus: 4333, shiftsCount: 14 },
          { employeeId: '2', employeeName: 'Чередниченко', averageKpi: 0.9344, bonus: 2667, shiftsCount: 13 },
        ],
      }),
    });
    const skill = createTestSkill(client);
    const result = await skill.execute({ operation: 'getSeller', parameters: { name: 'капитан' } });
    assert.equal(result.data.found, true);
    assert.equal(result.data.seller.name, 'Капитанова');
    assert.equal(result.data.seller.kpiFormatted, '0,94');
    assert.match(result.data.seller.bonusFormatted, /4[\s\u00A0]333,00\s*₽/);
  });

  test('compares multiple sellers', async () => {
    const client = createFakeClient({
      getSellerPerformance: async () => ({
        items: [
          { employeeId: '1', employeeName: 'Капитанова', currentKpi: 0.9357 },
          { employeeId: '2', employeeName: 'Чередниченко', currentKpi: 0.9344 },
        ],
        teamSignals: {},
      }),
    });
    const skill = createTestSkill(client);
    const result = await skill.execute({ operation: 'compareSellers', parameters: { names: ['Капитанова', 'Чередниченко'] } });
    assert.equal(result.data.compared.length, 2);
    assert.equal(result.data.notFound.length, 0);
  });
});

describe('BusinessKpiSkill cache', () => {
  test('caches store summary and returns cached flag', async () => {
    let calls = 0;
    const client = createFakeClient({
      getDashboard: async () => {
        calls += 1;
        return { month: { revenue: 100 } };
      },
    });
    const skill = createTestSkill(client);
    await skill.execute({ operation: 'getStoreSummary' });
    const cached = await skill.execute({ operation: 'getStoreSummary' });
    assert.equal(calls, 1);
    assert.equal(cached.cached, true);
    assert.ok(cached.retrievedAt);
  });

  test('does not cache today summary', async () => {
    let calls = 0;
    const client = createFakeClient({
      getToday: async () => {
        calls += 1;
        return { aggregate: { revenue: 50 } };
      },
    });
    const skill = createTestSkill(client);
    await skill.execute({ operation: 'getTodaySummary' });
    await skill.execute({ operation: 'getTodaySummary' });
    assert.equal(calls, 2);
  });
});

describe('BusinessKpiSkill management signals', () => {
  test('surfaces attention signal and plan risk', async () => {
    const client = createFakeClient({
      getDashboard: async () => ({
        month: {
          revenue: 400000,
          plan: 750000,
          planCompletion: 0.53,
          forecast: { projectedRevenue: 600000, remainingToPlan: 150000 },
          dataStatus: 'COMPLETE',
        },
      }),
      getSellerPerformance: async () => ({
        items: [],
        teamSignals: {
          attention: { employeeName: 'Чередниченко', metric: { label: 'товаров/чек' }, severity: 'medium', confidence: 'FULL', explanation: 'Падение метрики' },
        },
      }),
    });
    const skill = createTestSkill(client);
    const result = await skill.execute({ operation: 'getManagementSignals' });
    assert.equal(result.data.signals.length, 2);
    assert.ok(result.responseText.includes('Что требует внимания'));
    assert.ok(result.responseText.includes('недобор'));
    assert.ok(result.responseText.includes('Падение метрики'));
  });

  test('labels missing data separately from bad metric', async () => {
    const client = createFakeClient({
      getDashboard: async () => ({
        month: { dataStatus: 'PARTIAL' },
        sellers: [
          { employeeId: '1', employeeName: 'Капитанова', missingFields: ['itemsSold'] },
        ],
      }),
    });
    const skill = createTestSkill(client);
    const result = await skill.execute({ operation: 'getDataQuality' });
    assert.equal(result.data.incompleteSellers.length, 1);
    assert.equal(result.data.incompleteSellers[0].name, 'Капитанова');
    assert.ok(result.responseText.includes('itemsSold'));
  });
});
