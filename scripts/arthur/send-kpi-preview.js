'use strict';

/**
 * Send preview KPI automation messages to the configured OWNER Telegram chat.
 *
 * This script is meant for manual OWNER approval smoke tests. It does not
 * enable the cron scheduler. Daily/weekly runs are recorded in the production
 * audit table; alert evaluation uses an in-memory state store so it cannot
 * affect real alert deduplication state.
 */

const { Pool } = require('pg');
const { loadConfig } = require('../../agents/arthur-v1/telegram/config');
const { createTelegramClient } = require('../../agents/arthur-v1/telegram/telegram_client');
const { createBusinessKpiClient } = require('../../agents/arthur-v1/skills/business_kpi/business_kpi_client');
const { createBusinessKpiSkill } = require('../../agents/arthur-v1/skills/business_kpi/business_kpi_skill');
const { createKpiScheduler } = require('../../agents/arthur-v1/telegram/kpi_scheduler');
const { createKpiAutomation } = require('../../agents/arthur-v1/skills/business_kpi/kpi_automation');
const { createLogger } = require('../../agents/arthur-v1/logging/logger');

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  if (!config.businessKpi.enabled) {
    throw new Error('Business KPI is not configured');
  }
  if (config.allowedUserIds.size !== 1) {
    throw new Error('Exactly one allowed Telegram user ID is required');
  }

  const ownerChatId = Array.from(config.allowedUserIds)[0];
  const storeId = process.env.BUSINESS_KPI_DEFAULT_STORE_ID || '';
  const timezone = config.kpiAutomation.timezone || 'Asia/Vladivostok';

  const telegram = createTelegramClient({
    token: config.token,
    apiBaseUrl: config.apiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    logger,
  });

  const businessKpiSkill = createBusinessKpiSkill({
    client: createBusinessKpiClient({
      baseUrl: config.businessKpi.baseUrl,
      serviceKeys: config.businessKpi.serviceKeys,
      serviceId: config.businessKpi.serviceId,
      timeoutMs: config.businessKpi.timeoutMs,
    }),
  });

  const pool = new Pool({
    connectionString: process.env.ARTHUR_DATABASE_URL,
    max: 2,
  });

  const { createKpiAutomationStateStore } = require('../../agents/arthur-v1/skills/business_kpi/kpi_automation_state');
  const realStateStore = createKpiAutomationStateStore(pool);

  // In-memory state store for test alerts so we do not mutate real alert state.
  const memoryStates = new Map();
  const memoryRuns = [];
  const fakeStateStore = {
    getAlertState: async (ownerId, alertType, entityId) =>
      memoryStates.get(`${ownerId}:${alertType}:${entityId}`) || null,
    upsertAlertState: async (state) => {
      memoryStates.set(`${state.ownerId}:${state.alertType}:${state.entityId}`, state);
    },
    resolveAlertState: async (ownerId, alertType, entityId) => {
      const key = `${ownerId}:${alertType}:${entityId}`;
      if (memoryStates.has(key)) memoryStates.get(key).state = 'ok';
    },
    recordRun: async (run) => memoryRuns.push(run),
    getLastRun: async () => null,
    listRecentAlertStates: async () => Array.from(memoryStates.values()),
  };

  try {
    const realScheduler = createKpiScheduler({
      config: config.kpiAutomation,
      logger,
      telegramClient: telegram,
      businessKpiSkill,
      ownerChatId,
      ownerId: config.ownerProfileId,
      storeId,
      timezone,
      pool,
      stateStore: realStateStore,
    });
    await realScheduler.initialize();

    console.log('Sending daily preview...');
    const daily = await realScheduler.runDaily({ test: 'ТЕСТ 3' });
    console.log('Daily:', daily.success ? 'sent' : daily.error);

    console.log('Sending weekly preview...');
    const weekly = await realScheduler.runWeekly({ test: 'ТЕСТ 3' });
    console.log('Weekly:', weekly.success ? 'sent' : weekly.error);

    await realScheduler.close();

    const alertAutomation = createKpiAutomation(businessKpiSkill, fakeStateStore);
    const alertScheduler = createKpiScheduler({
      config: { daily: { enabled: false }, weekly: { enabled: false }, alerts: { enabled: false } },
      logger,
      telegramClient: telegram,
      automation: alertAutomation,
      ownerChatId,
      storeId,
      timezone,
      stateStore: fakeStateStore,
    });
    console.log('Sending alert preview...');
    const alerts = await alertScheduler.runAlerts({ test: 'ТЕСТ 3' });
    console.log('Alerts:', alerts.success ? `sent ${alerts.messages.length}` : alerts.error);

    console.log('Preview messages sent.');
  } finally {
    try { await pool.end(); } catch { /* already closed */ }
  }
}

main().catch((error) => {
  console.error('Preview failed:', error.message);
  process.exit(1);
});
