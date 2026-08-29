'use strict';

/**
 * Production-safe KPI alert dedup validation using the REAL persistent DB state store.
 *
 * IMPORTANT:
 * - Alerts must be OFF before running (TELEGRAM_KPI_ALERTS_ENABLED=false).
 * - This script does NOT send Telegram messages.
 * - It DOES read and write the production arthur_automation_alert_state table:
 *   it updates last_alert_digest, updated_at and sent_count for non-ok rows.
 *
 * Exits with code 0 only if:
 *   first evaluation => whatever the current condition dictates
 *   second identical evaluation => SUPPRESS (no new alerts)
 *   third evaluation in a fresh Node process => SUPPRESS
 */

const { Pool } = require('pg');
const { loadConfig } = require('../../agents/arthur-v1/telegram/config');
const { createBusinessKpiClient } = require('../../agents/arthur-v1/skills/business_kpi/business_kpi_client');
const { createBusinessKpiSkill } = require('../../agents/arthur-v1/skills/business_kpi/business_kpi_skill');
const { createKpiAutomation } = require('../../agents/arthur-v1/skills/business_kpi/kpi_automation');
const { createKpiAutomationStateStore } = require('../../agents/arthur-v1/skills/business_kpi/kpi_automation_state');

async function main() {
  const config = loadConfig();
  if (!config.businessKpi.enabled) {
    throw new Error('Business KPI is not configured');
  }
  if (config.allowedUserIds.size !== 1) {
    throw new Error('Exactly one allowed Telegram user ID is required');
  }
  if (config.kpiAutomation.alerts.enabled) {
    throw new Error('TELEGRAM_KPI_ALERTS_ENABLED must be false before running this validator');
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

  const pool = new Pool({
    connectionString: process.env.ARTHUR_DATABASE_URL,
    max: 2,
  });

  try {
    const stateStore = createKpiAutomationStateStore(pool);
    const automation = createKpiAutomation(businessKpiSkill, stateStore);

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

    // Restart simulation: new pool + new state store + new automation instance.
    const restartPool = new Pool({
      connectionString: process.env.ARTHUR_DATABASE_URL,
      max: 2,
    });
    try {
      const restartStateStore = createKpiAutomationStateStore(restartPool);
      const restartAutomation = createKpiAutomation(businessKpiSkill, restartStateStore);
      const afterRestart = await restartAutomation.evaluateAlerts({
        storeId,
        timezone,
        ownerId,
        cooldownMinutes: config.kpiAutomation.alerts.intervalMinutes || 60,
      });

      const results = {
        firstEvaluation: {
          alertsSentCount: first.alertsSent.length,
          sampleMessages: first.messages.slice(0, 3),
        },
        secondEvaluation: {
          alertsSentCount: second.alertsSent.length,
          suppressed: second.alertsSent.length === 0,
        },
        afterRestart: {
          alertsSentCount: afterRestart.alertsSent.length,
          suppressed: afterRestart.alertsSent.length === 0,
        },
      };

      console.log(JSON.stringify(results, null, 2));

      const pass = second.alertsSent.length === 0 && afterRestart.alertsSent.length === 0;
      if (!pass) {
        console.error('FAIL: identical alerts were not suppressed on the real persistent path');
        process.exit(1);
      }

      console.log('PASS: identical alerts suppressed on real persistent DB state');
    } finally {
      await restartPool.end();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Persistent validation failed:', error.message);
  process.exit(1);
});
