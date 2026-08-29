'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { createKpiAutomation } = require('../skills/business_kpi/kpi_automation');
const { createKpiAutomationStateStore } = require('../skills/business_kpi/kpi_automation_state');

const FIXED_NOW = new Date('2026-08-28T10:00:00.000Z');

function createFakeSkill(overrides = {}) {
  const defaults = {
    getStoreSummary: async () => ({
      revenue: 702_688.40,
      plan: 745_000,
      planCompletion: 0.943,
      forecast: 806_790.39,
      remainingToPlan: 42_311.60,
      averageCheck: 1073.195633187773,
      itemsPerCheck: 2.90,
      qrShare: 0.266,
      itemsCheckCoverage: '27/27',
    }),
    getTodaySummary: async () => ({
      date: '2026-08-28',
      dataStatus: 'COMPLETE',
      revenue: 28_500,
      averageCheck: 1055,
      itemsPerCheck: 2.85,
      qrShare: 0.25,
    }),
    getSellerPerformance: async () => ({
      sellers: [
        {
          employeeId: '1',
          name: 'Капитанова',
          currentKpi: 93.57236367472731,
          previousKpi: 96.46169088280473,
        },
      ],
      teamSignals: {},
    }),
    getShifts: async () => ({ shifts: [], count: 0 }),
    getSettings: async () => ({
      found: true,
      settings: { targets: { averageCheck: 1200, itemsPerReceipt: 3.0, qrShare: 0.30 } },
    }),
    getDataQuality: async () => ({
      dataStatus: 'COMPLETE',
      itemsCheckCoverage: '27/27',
      incompleteSellers: [],
    }),
  };
  const handlers = { ...defaults, ...overrides };
  return {
    execute: async ({ operation }) => {
      const handler = handlers[operation];
      if (!handler) throw new Error(`Unsupported operation: ${operation}`);
      return { status: 'success', data: await handler(), responseText: '', metadata: { operation } };
    },
  };
}

class FakePersistentClient {
  constructor() {
    this.states = new Map();
    this.runs = [];
  }

  toKey(ownerId, alertType, entityId) {
    return `${ownerId}:${alertType}:${entityId}`;
  }

  rowToDb(key, state) {
    return {
      id: `id-${key}`,
      owner_id: state.ownerId,
      alert_type: state.alertType,
      entity_id: state.entityId,
      state: state.state,
      last_value: state.lastValue ?? null,
      last_value_text: state.lastValueText ?? null,
      first_seen_at: state.firstSeenAt ? new Date(state.firstSeenAt) : new Date(),
      last_sent_at: state.lastSentAt ? new Date(state.lastSentAt) : null,
      last_alert_digest: state.lastAlertDigest ?? null,
      resolved_at: state.resolvedAt ? new Date(state.resolvedAt) : null,
      sent_count: state.sentCount ?? 0,
      metadata_json: state.metadata || {},
      created_at: state.createdAt ? new Date(state.createdAt) : new Date(),
      updated_at: state.updatedAt ? new Date(state.updatedAt) : new Date(),
    };
  }

  upsertState(state) {
    const key = this.toKey(state.ownerId, state.alertType, state.entityId);
    const existing = this.states.get(key);
    if (!existing) {
      this.states.set(key, {
        ...state,
        sentCount: 1,
        firstSeenAt: state.firstSeenAt || new Date().toISOString(),
      });
    } else {
      this.states.set(key, {
        ...existing,
        ...state,
        sentCount: (existing.sentCount || 0) + 1,
      });
    }
  }

  resolveState(ownerId, alertType, entityId) {
    const key = this.toKey(ownerId, alertType, entityId);
    const existing = this.states.get(key);
    if (existing) {
      existing.state = 'ok';
      existing.resolvedAt = new Date().toISOString();
    }
  }

  async query(text, values = []) {
    if (text.includes('SELECT * FROM arthur_automation_alert_state')) {
      const [ownerId, alertType, entityId] = values.slice(-3);
      const key = this.toKey(ownerId, alertType, entityId);
      const state = this.states.get(key);
      return { rows: state ? [this.rowToDb(key, state)] : [] };
    }

    if (text.includes('INSERT INTO arthur_automation_alert_state') && text.includes('ON CONFLICT')) {
      const [ownerId, alertType, entityId, state, lastValue, lastValueText, lastSentAt, lastAlertDigest, metadataJson] = values;
      this.upsertState({
        ownerId,
        alertType,
        entityId,
        state,
        lastValue,
        lastValueText,
        lastSentAt,
        lastAlertDigest,
        metadata: typeof metadataJson === 'string' ? JSON.parse(metadataJson) : metadataJson,
      });
      const key = this.toKey(ownerId, alertType, entityId);
      return { rows: [this.rowToDb(key, this.states.get(key))] };
    }

    if (text.includes('UPDATE arthur_automation_alert_state')) {
      const [ownerId, alertType, entityId] = values;
      this.resolveState(ownerId, alertType, entityId);
      const key = this.toKey(ownerId, alertType, entityId);
      const state = this.states.get(key);
      return { rows: state ? [this.rowToDb(key, state)] : [] };
    }

    if (text.includes('INSERT INTO arthur_automation_runs')) {
      this.runs.push(values);
      return { rows: [] };
    }

    if (text.includes('FROM arthur_automation_runs')) {
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function createPersistentStateStore() {
  return createKpiAutomationStateStore(new FakePersistentClient());
}

describe('KpiAutomation persistent state integration', () => {
  test('first alert sends and persists state', async () => {
    const skill = createFakeSkill();
    const stateStore = createPersistentStateStore();
    const automation = createKpiAutomation(skill, stateStore);

    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: 'Asia/Vladivostok',
      ownerId: 'sergey',
      now: FIXED_NOW,
    });

    assert.ok(result.alertsSent.length > 0, 'expected first evaluation to send alerts');

    const sellerState = await stateStore.getAlertState('sergey', 'seller_kpi_drop', 'Капитанова');
    assert.equal(sellerState.state, 'warning');
    assert.ok(sellerState.lastSentAt, 'expected last_sent_at to be set');
    assert.ok(sellerState.lastAlertDigest, 'expected digest to be set');
  });

  test('second identical evaluation is suppressed using persisted state', async () => {
    const skill = createFakeSkill();
    const stateStore = createPersistentStateStore();
    const automation = createKpiAutomation(skill, stateStore);

    const first = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: 'Asia/Vladivostok',
      ownerId: 'sergey',
      now: FIXED_NOW,
    });
    assert.ok(first.alertsSent.length > 0);

    const second = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: 'Asia/Vladivostok',
      ownerId: 'sergey',
      now: FIXED_NOW,
    });

    assert.equal(second.alertsSent.length, 0, 'expected second identical evaluation to be suppressed');
    assert.equal(second.messages.length, 0);
  });

  test('third identical evaluation in fresh process is suppressed', async () => {
    const skill = createFakeSkill();
    const stateStore = createPersistentStateStore();
    const automation = createKpiAutomation(skill, stateStore);

    await automation.evaluateAlerts({ storeId: 'miska', timezone: 'Asia/Vladivostok', ownerId: 'sergey', now: FIXED_NOW });
    await automation.evaluateAlerts({ storeId: 'miska', timezone: 'Asia/Vladivostok', ownerId: 'sergey', now: FIXED_NOW });

    // Fresh process: new automation instance, same persistent state store.
    const freshAutomation = createKpiAutomation(skill, stateStore);
    const third = await freshAutomation.evaluateAlerts({
      storeId: 'miska',
      timezone: 'Asia/Vladivostok',
      ownerId: 'sergey',
      now: FIXED_NOW,
    });

    assert.equal(third.alertsSent.length, 0, 'expected third identical evaluation in fresh process to be suppressed');
  });

  test('legacy row without digest suppresses identical alert by comparing data', async () => {
    const skill = createFakeSkill();
    const client = new FakePersistentClient();
    const stateStore = createKpiAutomationStateStore(client);

    // Seed a legacy row as if created by the pre-digest code.
    client.upsertState({
      ownerId: 'sergey',
      alertType: 'seller_kpi_drop',
      entityId: 'Капитанова',
      state: 'warning',
      lastValue: 93.57236367472731,
      lastValueText: '93,57',
      lastSentAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000).toISOString(),
      lastAlertDigest: null,
      metadata: { current: 93.57236367472731, previous: 96.46169088280473 },
      sentCount: 1,
      firstSeenAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000).toISOString(),
    });

    const automation = createKpiAutomation(skill, stateStore);
    const result = await automation.evaluateAlerts({
      storeId: 'miska',
      timezone: 'Asia/Vladivostok',
      ownerId: 'sergey',
      now: FIXED_NOW,
    });

    const sellerSent = result.alertsSent.find(a => a.alertType === 'seller_kpi_drop' && a.entityId === 'Капитанова');
    assert.ok(!sellerSent, 'expected identical legacy-row seller_kpi_drop alert to be suppressed');

    const sellerState = await stateStore.getAlertState('sergey', 'seller_kpi_drop', 'Капитанова');
    assert.ok(sellerState.lastAlertDigest, 'expected digest to be set after suppression');
  });

  test('changed data sends even with stored digest', async () => {
    const skill = createFakeSkill();
    const stateStore = createPersistentStateStore();
    const automation = createKpiAutomation(skill, stateStore);

    await automation.evaluateAlerts({ storeId: 'miska', timezone: 'Asia/Vladivostok', ownerId: 'sergey', now: FIXED_NOW });

    const worseSkill = createFakeSkill({
      getStoreSummary: async () => ({
        revenue: 702_688.40,
        plan: 745_000,
        planCompletion: 0.943,
        forecast: 806_790.39,
        remainingToPlan: 42_311.60,
        averageCheck: 1000,
        itemsPerCheck: 2.90,
        qrShare: 0.266,
        itemsCheckCoverage: '27/27',
      }),
    });
    const worseAutomation = createKpiAutomation(worseSkill, stateStore);
    const result = await worseAutomation.evaluateAlerts({
      storeId: 'miska',
      timezone: 'Asia/Vladivostok',
      ownerId: 'sergey',
      now: FIXED_NOW,
    });

    const averageCheckAlert = result.alertsSent.find(a => a.alertType === 'average_check');
    assert.ok(averageCheckAlert, 'expected alert when underlying data changed');
  });
});
