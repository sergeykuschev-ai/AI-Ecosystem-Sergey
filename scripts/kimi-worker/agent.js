'use strict';

const config = require('./config');
const { fetchKimiUsage, assessKimiUsage } = require('./kimiUsage');

function pct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'unknown';
}

async function chooseAgent(log, { fetchUsage = fetchKimiUsage } = {}) {
  const mode = config.agent.mode;
  if (mode === 'kimi' || mode === 'codex') {
    log.info(`Agent mode forced: ${mode}`);
    return { agent: mode, reason: 'forced' };
  }
  if (mode !== 'auto') throw new Error(`Invalid AIKIMI_AGENT_MODE: ${mode}`);

  try {
    const data = await fetchUsage();
    const quota = assessKimiUsage(data, config.agent.kimiReservePercent);
    const windows = quota.windows.map((w) => `${w.duration}${w.unit}: ${pct(w.remainingPercent)} left`).join(', ');
    log.info(`Kimi quota: ${windows || 'unavailable'}; protected reserve ${config.agent.kimiReservePercent}%`);
    if (quota.usable) return { agent: 'kimi', reason: quota.reason, quota };
    log.warn(`Kimi protected reserve reached; switching this task to Codex (${pct(quota.minRemainingPercent)} minimum remaining).`);
    return { agent: 'codex', reason: quota.reason, quota };
  } catch (err) {
    log.warn(`Kimi quota probe failed (${err.message}); preserving Kimi quota and switching this task to Codex.`);
    return { agent: 'codex', reason: 'quota-probe-failed', error: err.message };
  }
}

module.exports = { chooseAgent };
