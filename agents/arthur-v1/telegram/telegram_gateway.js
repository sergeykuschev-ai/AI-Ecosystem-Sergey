'use strict';

const crypto = require('node:crypto');

const { createArthurV1 } = require('../index');
const { generateCorrelationId } = require('../context/arthur_context');
const { createLogger } = require('../logging/logger');
const { createYandexMailSkillFromConfig } = require('../skills/mail/mail_runtime');
const { loadConfig, validateConfig } = require('./config');
const { createTelegramClient } = require('./telegram_client');

const COMMANDS = {
  START: '/start',
  HELP: '/help',
  STATUS: '/status',
};

const AI_PROVIDER_ERROR_CODES = Object.freeze([
  'OMNIROUTE_REQUEST_FAILED',
  'OMNIROUTE_UNAUTHORIZED',
  'OMNIROUTE_RATE_LIMITED',
  'OMNIROUTE_CONFIG_ERROR',
  'OMNIROUTE_INVALID_RESPONSE',
  'NOT_IMPLEMENTED',
  'PROVIDER_NOT_FOUND',
]);

function isAIProviderError(error) {
  if (!error || !error.code) return false;
  return AI_PROVIDER_ERROR_CODES.some(code =>
    error.code === code || error.code.startsWith('OMNIROUTE_HTTP_')
  );
}

function formatErrorResponse(error) {
  if (isAIProviderError(error)) {
    return 'Глубокий AI-анализ сейчас недоступен. Детерминированные команды (/status, /help) продолжают работать.';
  }
  return 'Артур временно недоступен. Попробую снова позже.';
}

const HELP_TEXT = `Привет, я Артур — AI-ассистент бизнеса.

Сейчас я умею читать и искать почту, управлять внутренними задачами и отвечать на запросы по закупкам:
• «Что важного в почте по Миске сегодня?»
• «Пришёл ответ от Валты?»
• «Покажи письма от Premium Pet.»
• «Позвонить поставщику завтра.»
• «Я позвонил поставщику.»
• «Отмени задачу проверить отчёт.»
• «Перенеси задачу позвонить поставщику на пятницу.»
• «Что у меня по задачам?»
• «Что у меня сегодня?»
• «Что сейчас с закупщиком?»
• «Покажи спорные позиции.»
• «Какой последний заказ?»
• «Что мы решили по матрицам?»

Команды:
/start — приветствие
/help — эта справка
/status — статус Gateway и Артура`;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatArthurResponse(response) {
  const text = response?.answer?.text || 'Нет данных для ответа.';
  const status = response?.status || 'unknown';

  if (status === 'failed') {
    if (response?.answer?.safeUserFacingError === true) {
      return text;
    }
    return 'Артур временно недоступен. Попробуй позже.';
  }

  if (status === 'partial') {
    return `Ответ составлен на основе частичных данных:\n\n${text}`;
  }

  return text;
}

function createTelegramConversationId(chatId) {
  const normalizedChatId = String(chatId || '').trim();
  if (!normalizedChatId) {
    throw new TypeError('Telegram chat ID is required');
  }
  const digest = crypto.createHash('sha256').update(normalizedChatId).digest('hex');
  return `telegram-${digest}`;
}

function buildArthurRequest({
  update,
  userId,
  telegramUserId,
  chatId,
  correlationId = generateCorrelationId(),
  conversationId = createTelegramConversationId(chatId),
}) {
  const message = update.message || update.edited_message;
  const text = message?.text || '';

  return {
    message: text,
    userId,
    channel: 'telegram',
    correlationId,
    conversationId,
    transport: {
      type: 'telegram',
      metadata: {
        userId: telegramUserId ?? String(message?.from?.id),
        chatId,
        messageId: message?.message_id,
        updateId: update.update_id,
      },
    },
    metadata: {
      source: 'telegram',
    },
  };
}

class ArthurTelegramGateway {
  constructor(options = {}) {
    this.config = options.config || loadConfig();
    this.logger = options.logger || createLogger({ level: this.config.logLevel });
    this.telegram = options.telegramClient || createTelegramClient({
      token: this.config.token,
      apiBaseUrl: this.config.apiBaseUrl,
      timeoutMs: this.config.requestTimeoutMs,
      maxRetries: this.config.maxRetries,
      retryDelayMs: this.config.retryDelayMs,
      logger: this.logger,
    });
    const mailSkill = options.mailSkill === undefined
      ? createYandexMailSkillFromConfig(this.config.yandexMail)
      : options.mailSkill;
    this.arthur = options.arthur || createArthurV1({
      logger: this.logger,
      mailSkill,
      coreConfig: {
        baseUrl: this.config.coreBaseUrl,
        token: this.config.coreToken,
        timeoutMs: this.config.coreTimeoutMs,
        ownerProfileId: this.config.ownerProfileId,
      },
    });
    this.running = false;
    this.shutdownRequested = false;
    this.offset = 0;
    this.startedAt = null;
    this.processedUpdates = 0;
    this.lastError = null;
  }

  async start() {
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      validation.errors.forEach(error => this.logger.error('gateway_config_invalid', null, { error }));
      throw new Error(`Invalid gateway configuration: ${validation.errors.join('; ')}`);
    }

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.logger.info('gateway_started', null, {
      allowedUserCount: this.config.allowedUserIds.size,
      pollTimeoutMs: this.config.pollTimeoutMs,
      telegramProxyEnabled: this.telegram.proxyEnabled,
    });

    while (this.running && !this.shutdownRequested) {
      try {
        const result = await this.telegram.getUpdates(this.offset, 100, this.config.pollTimeoutMs);
        const updates = result?.result || [];

        for (const update of updates) {
          await this.handleUpdate(update);
          if (update.update_id >= this.offset) {
            this.offset = update.update_id + 1;
          }
        }

        this.lastError = null;
      } catch (error) {
        this.lastError = {
          code: error.code || error.name,
          message: error.message,
          timestamp: new Date().toISOString(),
        };
        this.logger.error('gateway_poll_error', null, {
          errorCode: error.code || error.name,
          errorMessage: error.message,
        });

        if (!this.shutdownRequested) {
          await this.sleep(5000);
        }
      }
    }

    this.running = false;
    this.logger.info('gateway_stopped', null, {});
  }

  async handleUpdate(update) {
    const message = update.message || update.edited_message;
    if (!message || !message.text) {
      return;
    }

    const telegramUserId = String(message.from?.id);
    const chatId = String(message.chat?.id);
    const username = message.from?.username || null;

    const correlationId = generateCorrelationId();
    const conversationId = createTelegramConversationId(chatId);

    this.logger.info('telegram_update_received', { correlationId, conversationId, channel: 'telegram' }, {
      transport: {
        type: 'telegram',
        userId: telegramUserId,
        chatId,
        updateId: update.update_id,
        messageId: message.message_id,
        username,
      },
      textLength: message.text.length,
    });

    if (!this.config.allowedUserIds.has(telegramUserId)) {
      this.logger.warn('telegram_user_rejected', { correlationId, conversationId, channel: 'telegram' }, {
        transport: {
          type: 'telegram',
          userId: telegramUserId,
          chatId,
          username,
        },
      });
      await this.sendText(chatId, 'Доступ запрещён. Обратитесь к администратору.', correlationId);
      return;
    }

    try {
      const text = message.text.trim();
      let responseText;

      if (text === COMMANDS.START) {
        responseText = HELP_TEXT;
      } else if (text === COMMANDS.HELP) {
        responseText = HELP_TEXT;
      } else if (text === COMMANDS.STATUS) {
        responseText = await this.buildStatusText();
      } else {
        const arthurRequest = buildArthurRequest({
          update,
          userId: this.config.ownerProfileId,
          telegramUserId,
          chatId,
          correlationId,
          conversationId,
        });
        const arthurResponse = await this.arthur.handle(arthurRequest);
        responseText = formatArthurResponse(arthurResponse);
      }

      await this.sendText(chatId, responseText, correlationId);
      this.processedUpdates += 1;
    } catch (error) {
      this.logger.error('gateway_request_failed', {
        correlationId,
        conversationId,
        userId: this.config.ownerProfileId,
        channel: 'telegram',
      }, {
        transport: { type: 'telegram', userId: telegramUserId, chatId },
        errorCode: error.code || error.name,
        errorMessage: error.message,
      });
      await this.sendText(chatId, formatErrorResponse(error), correlationId);
    }
  }

  async sendText(chatId, text, correlationId) {
    try {
      await this.telegram.sendMessage(chatId, text);
      this.logger.info('telegram_message_sent', { correlationId, channel: 'telegram' }, {
        transport: { type: 'telegram', chatId },
        textLength: text.length,
      });
    } catch (error) {
      this.logger.error('telegram_send_failed', { correlationId, channel: 'telegram' }, {
        transport: { type: 'telegram', chatId },
        errorCode: error.code || error.name,
        errorMessage: error.message,
      });
    }
  }

  async buildStatusText() {
    const now = new Date().toISOString();
    let aiStatus = 'unknown';
    try {
      const diagnostics = await this.arthur.getDiagnostics();
      const fastModel = diagnostics.models?.fast || '—';
      aiStatus = `${diagnostics.provider} (${diagnostics.status}) / ${fastModel}`;
    } catch (error) {
      aiStatus = 'unavailable';
    }

    const lines = [
      '<b>Статус Артура</b>',
      '',
      `Gateway: ${this.running ? 'работает' : 'остановлен'}`,
      `AI provider: ${escapeHtml(aiStatus)}`,
      `Proxy: ${this.telegram.proxyEnabled ? 'включён' : 'выключен'}`,
      `Запущен: ${this.startedAt ? escapeHtml(this.startedAt) : '—'}`,
      `Обработано сообщений: ${this.processedUpdates}`,
      `Последняя ошибка: ${this.lastError ? escapeHtml(this.lastError.message) : 'нет'}`,
      `Время: ${escapeHtml(now)}`,
    ];
    return lines.join('\n');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    this.shutdownRequested = true;
    this.logger.info('gateway_shutdown_requested', null, {});

    const deadline = Date.now() + 10000;
    while (this.running && Date.now() < deadline) {
      await this.sleep(100);
    }

    if (this.running) {
      this.logger.warn('gateway_shutdown_forced', null, {});
      this.running = false;
    }
  }

  getHealth() {
    return {
      status: this.running ? 'healthy' : 'stopped',
      startedAt: this.startedAt,
      processedUpdates: this.processedUpdates,
      lastError: this.lastError,
      configValid: validateConfig(this.config).valid,
    };
  }
}

function createTelegramGateway(options = {}) {
  return new ArthurTelegramGateway(options);
}

module.exports = {
  ArthurTelegramGateway,
  createTelegramGateway,
  buildArthurRequest,
  createTelegramConversationId,
  formatArthurResponse,
  HELP_TEXT,
};
