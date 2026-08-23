'use strict';

const {
  calculateKpiMetrics,
} = require('./services/calculate_kpi_metrics');
const {
  METRIC_CONTRACT_VERSION,
} = require('./rules/metric_contract');
const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('./rules/reference_settings');

function analyzeShift(input, options = {}) {
  const settings = options.settings || MISKA_AUGUST_2026_SETTINGS;
  return Object.freeze({
    contractVersion: METRIC_CONTRACT_VERSION,
    settingsVersion: settings.version,
    metrics: calculateKpiMetrics(input, settings),
  });
}

module.exports = {
  analyzeShift,
};
