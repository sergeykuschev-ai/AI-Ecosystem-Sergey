'use strict';

const cron = require('node-cron');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createKpiAutomationStateStore } = require('../skills/business_kpi/kpi_automation_state');
const { createKpiAutomation } = require('../skills/business_kpi/kpi_automation');

const DEFAULT_TIMEZONE = 'Asia/Vladivostok';

function generateCorrelationId() {
  return crypto.randomUUID();
}

function parseTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

function cronExpression({ minute, hour, dayOfWeek = '*' }) {
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

function validateTask(task) {
  if (!cron.validate(task.cron)) {
    throw new Error(`Invalid cron expression: ${task.cron}`);
  }
}

function createSchedulerLogger(logger, correlationId) {
  const log = (event, meta = {}) => logger.info(event, { correlationId }, meta);
  log.info = (event, meta = {}) => logger.info(event, { correlationId }, meta);
  log.warn = (event, meta = {}) => logger.warn(event, { correlationId }, meta);
  log.error = (event, meta = {}) => logger.error(event, { correlationId }, meta);
  return log;
}

class KpiScheduler {
  constructor(options = {}) {
    this.config = options.config || {};
    this.logger = options.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this.telegram = options.telegramClient;
    this.skill = options.businessKpiSkill;
    this.ownerChatId = options.ownerChatId;
    this.ownerId = options.ownerId || options.ownerChatId;
    this.storeId = options.storeId;
    this.timezone = options.timezone || DEFAULT_TIMEZONE;
    this.pool = options.pool || null;
    this.stateStore = options.stateStore || null;
    this.automation = options.automation || null;
    this.tasks = [];
    this.running = false;
    this.lastRun = null;
    this.lastError = null;
  }

  async initialize() {
    if (!this.pool && !this.stateStore) {
      const connectionString = process.env.ARTHUR_DATABASE_URL;
      if (!connectionString) {
        throw new Error('KPI scheduler requires ARTHUR_DATABASE_URL');
      }
      this.pool = new Pool({ connectionString, max: 2 });
    }
    if (!this.stateStore) {
      this.stateStore = createKpiAutomationStateStore(this.pool);
    }
    if (!this.automation) {
      this.automation = createKpiAutomation(this.skill, this.stateStore);
    }
  }

  async close() {
    if (this.pool && this.pool.end) {
      await this.pool.end();
    }
  }

  start() {
    if (this.running) {
      this.logger.warn('kpi_scheduler_already_running', null, {});
      return;
    }
    if (!this.config || (!this.config.daily?.enabled && !this.config.weekly?.enabled && !this.config.alerts?.enabled)) {
      this.logger.info('kpi_scheduler_disabled', null, {});
      return;
    }

    this.running = true;
    this.tasks = this.buildTasks().filter(t => t.enabled);
    for (const task of this.tasks) {
      validateTask(task);
      task.cronJob = cron.schedule(task.cron, task.handler, {
        scheduled: true,
        timezone: this.timezone,
      });
      this.logger.info('kpi_task_scheduled', null, {
        runType: task.runType,
        cron: task.cron,
        timezone: this.timezone,
      });
    }
    this.logger.info('kpi_scheduler_started', null, {
      taskCount: this.tasks.length,
      timezone: this.timezone,
    });
  }

  stop() {
    if (!this.running) return;
    for (const task of this.tasks) {
      if (task.cronJob) task.cronJob.stop();
    }
    this.tasks = [];
    this.running = false;
    this.logger.info('kpi_scheduler_stopped', null, {});
  }

  buildTasks() {
    const tasks = [];

    if (this.config.daily?.enabled) {
      const { hour, minute } = parseTime(this.config.daily.time);
      tasks.push({
        runType: 'daily',
        enabled: true,
        cron: cronExpression({ hour, minute }),
        handler: () => this.runDaily(),
      });
    }

    if (this.config.weekly?.enabled) {
      const { hour, minute } = parseTime(this.config.weekly.time);
      tasks.push({
        runType: 'weekly',
        enabled: true,
        cron: cronExpression({ hour, minute, dayOfWeek: this.config.weekly.day }),
        handler: () => this.runWeekly(),
      });
    }

    if (this.config.alerts?.enabled) {
      const intervalMinutes = this.config.alerts.intervalMinutes || 60;
      tasks.push({
        runType: 'alert_evaluation',
        enabled: true,
        cron: `*/${intervalMinutes} * * * *`,
        handler: () => this.runAlerts(),
      });
    }

    return tasks;
  }

  async runDaily(options = {}) {
    const correlationId = generateCorrelationId();
    const log = createSchedulerLogger(this.logger, correlationId);
    const scheduledFor = new Date().toISOString();

    log('kpi_daily_started', { storeId: this.storeId, ownerChatId: this.ownerChatId });
    try {
      const report = await this.automation.buildDailyReport({
        storeId: this.storeId,
        timezone: this.timezone,
      });

      const testLabel = typeof options.test === 'string' ? options.test : (options.test ? 'ТЕСТ' : '');
      const prefix = testLabel ? `🧪 ${testLabel} — ежедневный KPI-отчёт\n\n` : '';
      const text = `${prefix}${report.text}`;

      await this.sendToOwner(text, correlationId);
      await this.recordRun({
        ownerId: this.ownerId,
        runType: 'daily',
        scheduledFor,
        correlationId,
        result: 'success',
        metadata: { storeId: this.storeId, messageLength: text.length },
      });
      this.lastRun = { runType: 'daily', scheduledFor, result: 'success', correlationId };
      log('kpi_daily_completed', { messageLength: text.length });
      return { success: true, text };
    } catch (error) {
      this.lastError = { runType: 'daily', error: error.message, timestamp: new Date().toISOString() };
      await this.recordRun({
        ownerId: this.ownerId,
        runType: 'daily',
        scheduledFor,
        correlationId,
        result: 'failure',
        errorCode: error.code || 'UNKNOWN',
        errorMessage: error.message,
      });
      const failureText = options.test
        ? '🧪 ТЕСТ — ежедневный KPI-отчёт\n\n⚠️ Артур не смог получить актуальные данные «Миски».\nПоследние сохранённые показатели не выдаю за текущие.\nПричина: Business KPI недоступен.'
        : '⚠️ Артур не смог получить актуальные данные «Миски».\nПоследние сохранённые показатели не выдаю за текущие.\nПричина: Business KPI недоступен.';
      await this.sendToOwner(failureText, correlationId);
      log('kpi_daily_failed', { errorCode: error.code || 'UNKNOWN', errorMessage: error.message });
      return { success: false, error: error.message };
    }
  }

  async runWeekly(options = {}) {
    const correlationId = generateCorrelationId();
    const log = createSchedulerLogger(this.logger, correlationId);
    const scheduledFor = new Date().toISOString();

    log('kpi_weekly_started', { storeId: this.storeId, ownerChatId: this.ownerChatId });
    try {
      const report = await this.automation.buildWeeklyReport({
        storeId: this.storeId,
        timezone: this.timezone,
      });

      const testLabel = typeof options.test === 'string' ? options.test : (options.test ? 'ТЕСТ' : '');
      const prefix = testLabel ? `🧪 ${testLabel} — недельный KPI-отчёт\n\n` : '';
      const text = `${prefix}${report.text}`;

      await this.sendToOwner(text, correlationId);
      await this.recordRun({
        ownerId: this.ownerId,
        runType: 'weekly',
        scheduledFor,
        correlationId,
        result: 'success',
        metadata: { storeId: this.storeId, messageLength: text.length },
      });
      this.lastRun = { runType: 'weekly', scheduledFor, result: 'success', correlationId };
      log('kpi_weekly_completed', { messageLength: text.length });
      return { success: true, text };
    } catch (error) {
      this.lastError = { runType: 'weekly', error: error.message, timestamp: new Date().toISOString() };
      await this.recordRun({
        ownerId: this.ownerId,
        runType: 'weekly',
        scheduledFor,
        correlationId,
        result: 'failure',
        errorCode: error.code || 'UNKNOWN',
        errorMessage: error.message,
      });
      const failureText = options.test
        ? '🧪 ТЕСТ — недельный KPI-отчёт\n\n⚠️ Артур не смог получить актуальные данные «Миски».\nПоследние сохранённые показатели не выдаю за текущие.\nПричина: Business KPI недоступен.'
        : '⚠️ Артур не смог получить актуальные данные «Миски».\nПоследние сохранённые показатели не выдаю за текущие.\nПричина: Business KPI недоступен.';
      await this.sendToOwner(failureText, correlationId);
      log('kpi_weekly_failed', { errorCode: error.code || 'UNKNOWN', errorMessage: error.message });
      return { success: false, error: error.message };
    }
  }

  async runAlerts(options = {}) {
    const correlationId = generateCorrelationId();
    const log = createSchedulerLogger(this.logger, correlationId);
    const scheduledFor = new Date().toISOString();

    log('kpi_alerts_started', { storeId: this.storeId, ownerChatId: this.ownerChatId });
    try {
      const evaluation = await this.automation.evaluateAlerts({
        storeId: this.storeId,
        timezone: this.timezone,
        ownerId: this.ownerId,
        cooldownMinutes: this.config.alerts?.intervalMinutes || 60,
        logger: log,
        runId: correlationId,
      });

      const messages = [];
      const alertTestLabel = typeof options.test === 'string' ? options.test : (options.test ? 'ТЕСТ' : '');
      for (const message of evaluation.messages) {
        const text = alertTestLabel ? `🧪 ${alertTestLabel} — KPI alert\n\n${message}` : message;
        messages.push(text);
        await this.sendToOwner(text, correlationId);
      }

      const result = messages.length > 0 ? 'success' : 'no_action';
      await this.recordRun({
        ownerId: this.ownerId,
        runType: 'alert_evaluation',
        scheduledFor,
        correlationId,
        result,
        metadata: { storeId: this.storeId, alertCount: messages.length },
      });
      this.lastRun = { runType: 'alert_evaluation', scheduledFor, result, correlationId };
      log('kpi_alerts_completed', { alertCount: messages.length });
      return { success: true, messages, alertCount: messages.length };
    } catch (error) {
      this.lastError = { runType: 'alert_evaluation', error: error.message, timestamp: new Date().toISOString() };
      await this.recordRun({
        ownerId: this.ownerId,
        runType: 'alert_evaluation',
        scheduledFor,
        correlationId,
        result: 'failure',
        errorCode: error.code || 'UNKNOWN',
        errorMessage: error.message,
      });
      log('kpi_alerts_failed', { errorCode: error.code || 'UNKNOWN', errorMessage: error.message });
      return { success: false, error: error.message };
    }
  }

  async sendToOwner(text, correlationId) {
    if (!this.telegram || !this.ownerChatId) {
      throw new Error('Telegram client or owner chat ID not configured');
    }
    await this.telegram.sendMessage(this.ownerChatId, text);
    this.logger.info('kpi_automation_message_sent', { correlationId }, {
      runType: 'automation',
      chatId: this.ownerChatId,
      textLength: text.length,
    });
  }

  async recordRun(run) {
    if (!this.stateStore) return;
    await this.stateStore.recordRun(run);
  }

  getHealth() {
    return {
      running: this.running,
      taskCount: this.tasks.length,
      lastRun: this.lastRun,
      lastError: this.lastError,
      timezone: this.timezone,
      automations: {
        daily: this.config?.daily?.enabled || false,
        weekly: this.config?.weekly?.enabled || false,
        alerts: this.config?.alerts?.enabled || false,
      },
    };
  }
}

function createKpiScheduler(options = {}) {
  return new KpiScheduler(options);
}

module.exports = {
  KpiScheduler,
  createKpiScheduler,
  DEFAULT_TIMEZONE,
};
