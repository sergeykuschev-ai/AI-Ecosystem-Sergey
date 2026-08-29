'use strict';

/**
 * Production-safe KPI alert dedup verification.
 *
 * Connects to the real Business KPI source but uses an in-memory state store,
 * so no Telegram messages are sent and no production dedup state is mutated.
 *
 * Exits with code 0 only if:
 *   first evaluation => would send
 *   second identical evaluation => suppressed
 *   restart simulation (new automation seeded with persisted state) => suppressed
 */

const { loadConfig } = require('../../agents/arthur-v1/telegram/config');
const { createBusinessKpiClient } = require('../../agents/arthur-v1/skills/business_kpi/business_kpi_client');
const { createBusinessKpiSkill } = require('../../agents/arthur-v1/skills/business_kpi/business_kpi_skill');
const { createKpiAutomation } = require('../../agents/arthur-v1/skills/business_kpi/kpi_automation');

function createMemoryStateStore() {
  const states = new Map();
  return {
    getAlertState: async (ownerId, alertType, entityId) =>
      states.get(`${ownerId}:${alertType}:${entityId}`) || null,
    upsertAlertState: async (state) => {
      states.set(`${state.ownerId}:${state.alertType}:${state.entityId}`, state);
    },
    resolveAlertState: async (ownerId, alertType, entityId) => {
      const key = `${ownerId}:${alertType}:${entityId}`;
      if (states.has(key)) states.get(key).state = 'ok';
    },
    recordRun: async () => {},
    getLastRun: async () => null,
    listRecentAlertStates: async () => Array.from(states.values()),
    _states: states,
  };
}

function cloneStateStore(source) {
  const clone = createMemoryStateStore();
  for (const [key, value] of source._states.entries()) {
    clone._states.set(key, { ...value });
  }
  return clone;
}

async function main() {
  const config = loadConfig();
  if (!config.businessKpi.enabled) {
    throw new Error('Business KPI is not configured');
  }
  if (config.allowedUserIds.size !== 1) {
    throw new Error('Exactly one allowed Telegram user ID is required');
  }

  const ownerId = config.ownerProfileId;
  const storeId = process.env.BUSINESS_KPI_DEFAULT_STORE_ID || '';
  const timezone = config.kpiAutomation.timezone || 'Asia/Vladivostok';

  const businessKpiSkill = createBusinessKpiSkill({
    client: createBusinessKpiClient({
      baseUrl: config.businessKpi.baseUrl,
      serviceKeys: config.businessKpi.serviceKeys,
      serviceId: config.businessKpi.serviceId,
      timeoutMs: config.businessKpi.timeoutMs,
    }),
  });

  const memoryStore = createMemoryStateStore();
  const automation = createKpiAutomation(businessKpiSkill, memoryStore);

  const first = await automation.evaluateAlerts({
    storeId,
    timezone,
    ownerId,
    cooldownMinutes: config.kpiAutomation.alerts.intervalMinutes || 60,
  });

  const second = await automation.evaluateAlerts({
    storeId,
    timezone,
    ownerId,
    cooldownMinutes: config.kpiAutomation.alerts.intervalMinutes || 60,
  });

  // Restart simulation: new automation instance with state cloned from memoryStore.
  const restartedStore = cloneStateStore(memoryStore);
  const restartedAutomation = createKpiAutomation(businessKpiSkill, restartedStore);
  const afterRestart = await restartedAutomation.evaluateAlerts({
    storeId,
    timezone,
    ownerId,
    cooldownMinutes: config.kpiAutomation.alerts.intervalMinutes || 60,
  });

  const results = {
    firstEvaluation: {
      wouldSendCount: first.alertsSent.length,
      sampleMessages: first.messages.slice(0, 3),
    },
    secondEvaluation: {
      wouldSendCount: second.alertsSent.length,
      suppressed: second.alertsSent.length === 0 && second.messages.length === 0,
    },
    afterRestart: {
      wouldSendCount: afterRestart.alertsSent.length,
      suppressed: afterRestart.alertsSent.length === 0 && afterRestart.messages.length === 0,
    },
  };

  console.log(JSON.stringify(results, null, 2));

  const pass =
    first.alertsSent.length > 0 &&
    second.alertsSent.length === 0 &&
    afterRestart.alertsSent.length === 0;

  if (!pass) {
    console.error('FAIL: dedup verification did not pass');
    process.exit(1);
  }

  console.log('PASS: first evaluation would send, identical repeats are suppressed');
}

main().catch((error) => {
  console.error('Verification failed:', error.message);
  process.exit(1);
});
