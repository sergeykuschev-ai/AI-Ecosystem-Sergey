'use strict';

const crypto = require('node:crypto');

const { createArthurV1 } = require('../index');
const { generateCorrelationId } = require('../context/arthur_context');
const { createLogger } = require('../logging/logger');
const { createYandexMailSkillFromConfig } = require('../skills/mail/mail_runtime');
const { createBusinessKpiClient } = require('../skills/business_kpi/business_kpi_client');
const { createBusinessKpiSkill } = require('../skills/business_kpi/business_kpi_skill');
const { createKpiScheduler } = require('./kpi_scheduler');
const { PersonalScheduler } = require('./personal_scheduler');
const { createReminderStore, parseReminder, parseTimeReply, formatReminder } = require('./personal_reminder_commands');
const { TelegramVoiceTranscriber, VoiceTranscriptionError } = require('./telegram_voice');
const { parseRecurringRequest } = require('./personal_recurrence');
const { createRecurringStore } = require('./personal_recurrence_store');
const { buildPoolConfig } = require('../../arthur-core/runtime/create-runtime');
const { loadConfig, validateConfig } = require('./config');
const { createTelegramClient } = require('./telegram_client');
const {loadProjectStatus,formatProjectStatus}=require('./project_health_reader');
const {checkAndNotify}=require('./project_alert_notifier');

const COMMANDS = {
  START: '/start',
  HELP: '/help',
  STATUS: '/status',
  PROJECTS: '/projects',
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

const HELP_TEXT = `Привет, я Артур — личный и бизнес-помощник.

Сейчас я умею отвечать на вопросы по Business KPI магазина «Миска», читать и искать почту, управлять внутренними задачами и отвечать на запросы по закупкам:
• «Как дела у Миски?»
• «Кто сейчас лучше работает?»
• «Какая премия у Капитановой?»
• «Сколько осталось до плана?»
• «Что важного в почте по Миске сегодня?»
• «Пришёл ответ от Валты?»
• «Покажи письма от Premium Pet.»
• «Позвонить поставщику завтра.»
• «Запиши на сегодня: забрать заказ.»
• «Напомни сегодня в 16:00 забрать заказ.» (при включённых напоминаниях)
• «Английский каждый день в 20:00.»
• «Спортзал по понедельникам, средам и пятницам в 19:00.»
• Кнопки под напоминанием: «Выполнено», «Отложить» (на час), «Отменить».
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
/status — статус Gateway и Артура
/projects — статус пяти бизнес-проектов (только просмотр)`;

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
    this.projectStatusReader=options.projectStatusReader || (()=>{
      const snapshot=loadProjectStatus({
        directory:process.env.ARTHUR_DEV_WORKER_REPORT_DIR,
      });
      return formatProjectStatus(snapshot);
    });
    this.projectAlertNotifier=options.projectAlertNotifier || (
      process.env.ARTHUR_PROJECT_ALERT_STATE_DIR &&
      process.env.ARTHUR_DEV_WORKER_REPORT_DIR &&
      this.config.allowedUserIds?.size === 1
        ? ()=>checkAndNotify({
          directory:process.env.ARTHUR_DEV_WORKER_REPORT_DIR,
          stateDirectory:process.env.ARTHUR_PROJECT_ALERT_STATE_DIR,
          chatId:Array.from(this.config.allowedUserIds)[0],
          telegram:this.telegram,
        })
        : null
    );
    this.nextProjectAlertCheck=0;
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
    const businessKpiConfig = this.config.businessKpi;
    this.businessKpiSkill = options.businessKpiSkill === undefined && businessKpiConfig.enabled
      ? createBusinessKpiSkill({
          client: createBusinessKpiClient({
            baseUrl: businessKpiConfig.baseUrl,
            serviceKeys: businessKpiConfig.serviceKeys,
            serviceId: businessKpiConfig.serviceId,
            timeoutMs: businessKpiConfig.timeoutMs,
          }),
          clock: options.clock,
        })
      : options.businessKpiSkill;
    this.arthur = options.arthur || createArthurV1({
      logger: this.logger,
      mailSkill,
      businessKpiSkill: this.businessKpiSkill,
      coreConfig: {
        baseUrl: this.config.coreBaseUrl,
        token: this.config.coreToken,
        timeoutMs: this.config.coreTimeoutMs,
        ownerProfileId: this.config.ownerProfileId,
        personalMemoryEnabled: this.config.personalMemoryEnabled,
        remindersEnabled: this.config.personalAutomation?.enabled === true
          && this.config.personalAutomation.reminders === true,
      },
    });
    const voiceEndpoint = process.env.ARTHUR_VOICE_ASR_URL || '';
    this.voiceTranscriber = options.voiceTranscriber || (voiceEndpoint
      ? new TelegramVoiceTranscriber({ telegram: this.telegram, endpoint: voiceEndpoint })
      : null);
    this.scheduler = options.kpiScheduler || null;
    this.personalScheduler = options.personalScheduler || null;
    this.recurringStore = options.recurringStore || null;
    this.oneOffReminderStore = options.oneOffReminderStore || null;
    this.personalSchedulerError = null;
    this.dbPool = options.dbPool || null;
    this.running = false;
    this.shutdownRequested = false;
    this.offset = 0;
    this.startedAt = null;
    this.processedUpdates = 0;
    this.lastError = null;
  }

  async initializeScheduler() {
    const kpiConfig = this.config.kpiAutomation;
    const anyEnabled = kpiConfig.daily.enabled || kpiConfig.weekly.enabled || kpiConfig.alerts.enabled;
    if (!anyEnabled || !this.config.businessKpi.enabled) {
      this.logger.info('kpi_scheduler_skipped', null, { anyEnabled, businessKpiEnabled: this.config.businessKpi.enabled });
      return;
    }

    try {
      const { Pool } = require('pg');
      this.dbPool = this.dbPool || new Pool({
        connectionString: process.env.ARTHUR_DATABASE_URL,
        max: 2,
      });
      const ownerChatId = this.config.allowedUserIds.size === 1
        ? Array.from(this.config.allowedUserIds)[0]
        : null;
      if (!ownerChatId) {
        throw new Error('KPI automation requires exactly one allowed Telegram user ID');
      }
      this.scheduler = createKpiScheduler({
        config: kpiConfig,
        logger: this.logger,
        telegramClient: this.telegram,
        businessKpiSkill: this.businessKpiSkill,
        ownerChatId,
        ownerId: this.config.ownerProfileId,
        storeId: process.env.BUSINESS_KPI_DEFAULT_STORE_ID || '',
        timezone: kpiConfig.timezone,
        pool: this.dbPool,
      });
      await this.scheduler.initialize();
      this.scheduler.start();
    } catch (error) {
      this.logger.error('kpi_scheduler_init_failed', null, {
        errorCode: error.code || error.name,
        errorMessage: error.message,
      });
      this.scheduler = null;
    }
  }

  async initializePersonalScheduler() {
    if (!this.config.personalAutomation?.enabled) return;
    try {
      if (!this.dbPool) {
        const { Pool } = require('pg');
        this.dbPool = new Pool({ ...buildPoolConfig(process.env), max: 2 });
      }
      if (!this.recurringStore && typeof this.dbPool.query === 'function') {
        this.recurringStore = createRecurringStore(this.dbPool);
      }
      this.personalScheduler = this.personalScheduler || new PersonalScheduler({
        config: this.config.personalAutomation, pool: this.dbPool, recurrenceStore: this.recurringStore,
        telegram: this.telegram, ownerId: this.config.ownerProfileId,
        chatId: Array.from(this.config.allowedUserIds)[0], logger: this.logger,
      });
      await this.personalScheduler.initialize();
      if (!this.oneOffReminderStore && typeof this.dbPool?.query === 'function') {
        this.oneOffReminderStore = createReminderStore(this.dbPool);
      }
      if (this.oneOffReminderStore) await this.oneOffReminderStore.initialize(this.config.ownerProfileId);
      this.personalScheduler.start();
      this.personalSchedulerError = null;
    } catch (error) {
      this.personalScheduler = null;
      this.personalSchedulerError = error.code || error.name;
      this.logger.error('personal_scheduler_init_failed', null, { errorCode: this.personalSchedulerError });
      // A configured but broken reminder scheduler must not accept new reminders.
      throw new Error('Personal scheduler initialization failed', { cause: error });
    }
  }

  async start() {
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      validation.errors.forEach(error => this.logger.error('gateway_config_invalid', null, { error }));
      throw new Error(`Invalid gateway configuration: ${validation.errors.join('; ')}`);
    }

    await this.initializePersonalScheduler();
    await this.initializeScheduler();

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.logger.info('gateway_started', null, {
      allowedUserCount: this.config.allowedUserIds.size,
      pollTimeoutMs: this.config.pollTimeoutMs,
      telegramProxyEnabled: this.telegram.proxyEnabled,
      kpiAutomation: this.scheduler ? this.scheduler.getHealth().automations : { daily: false, weekly: false, alerts: false },
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

        if (this.projectAlertNotifier && Date.now()>=this.nextProjectAlertCheck){
          this.nextProjectAlertCheck=Date.now()+5*60*1000;
          try{
            const monitor=await this.projectAlertNotifier();
            if(monitor?.sent?.length) this.logger.warn('project_health_alert_sent',null,{
              projects:monitor.sent,
            });
            if(monitor?.status==='delivery_unknown')this.logger.error(
              'project_health_alert_delivery_unknown',null,{
                project:monitor.unknown,errorCode:monitor.reason,
              });
          }catch(error){
            this.logger.warn('project_health_alert_check_failed',null,{
              errorCode:error?.code||'PROJECT_ALERT_CHECK_FAILED',
            });
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

  async handleReminderCallback(callback) {
    const userId = String(callback.from?.id || '');
    const chatId = String(callback.message?.chat?.id || '');
    const isOwner = this.config.allowedUserIds.has(userId) && chatId === userId;
    const matched = String(callback.data || '').match(
      /^ar1:([tr]):([dsc]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-z]+)$/i);
    let answer = 'Неизвестная или устаревшая кнопка.';
    let updated = false;
    try {
      if (!isOwner) answer = 'Доступ запрещён.';
      else if (!this.recurringStore) answer = 'Напоминания временно недоступны.';
      else if (matched) {
        const [,kind,action,id,version] = matched;
        const seq = parseInt(version,36);
        const result = Number.isSafeInteger(seq) && seq >= 0
          ? (kind === 't'
            ? await this.recurringStore.actTask(this.config.ownerProfileId,id,seq,action,new Date().toISOString())
            : await this.recurringStore.actRepeat(this.config.ownerProfileId,id,seq,action,new Date().toISOString()))
          : {status:'stale'};
        updated = result.status === 'updated';
        if (updated) answer = action === 'd' ? '✅ Выполнено' :
          action === 's' ? '⏰ Отложено на 1 час' :
          kind === 'r' ? '✅ Повторы остановлены' : '✅ Напоминание отменено';
        else answer = 'Уже обработано или кнопка устарела.';
      }
      await this.telegram.call('answerCallbackQuery',{
        callback_query_id:callback.id,text:answer,show_alert:false
      });
      if (updated && callback.message?.message_id) {
        try {
          await this.telegram.call('editMessageReplyMarkup',{
            chat_id:chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}
          });
        } catch (error) { this.logger.warn('reminder_button_cleanup_failed',null,{errorCode:error.code||error.name}); }
      }
      this.processedUpdates++;
    } catch (error) {
      this.logger.error('reminder_button_failed',null,{errorCode:error.code||error.name});
      try {await this.telegram.call('answerCallbackQuery',{callback_query_id:callback.id,text:'Не удалось выполнить действие.'});} catch {}
    }
  }

  async handleUpdate(update) {
    if (update.callback_query) {
      await this.handleReminderCallback(update.callback_query);
      return;
    }
    const message = update.message || update.edited_message;
    if (!message || (!message.text && !message.voice)) {
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
      textLength: message.text?.length || 0,
      isVoice: Boolean(message.voice && !message.text),
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
      const isVoice = Boolean(message.voice && !message.text);
      if (isVoice && !this.voiceTranscriber) {
        await this.sendText(chatId, 'Голосовые команды пока не подключены. Напиши задачу текстом.', correlationId);
        this.processedUpdates += 1;
        return;
      }
      let text;
      try {
        text = isVoice ? await this.voiceTranscriber.transcribe(message.voice) : message.text.trim();
      } catch (error) {
        if (error instanceof VoiceTranscriptionError) {
          await this.sendText(chatId, error.userMessage, correlationId);
          this.processedUpdates += 1;
          return;
        }
        throw error;
      }
      const normalizedUpdate = isVoice ? { ...update, message: { ...message, text } } : update;
      const recurrence = parseRecurringRequest(text,{
        now:new Date(), timezone:this.personalScheduler?.timezone || 'Asia/Vladivostok',
      });
      const oneOff = recurrence ? null : parseReminder(text,{
        now:new Date(),timezone:this.personalScheduler?.timezone || 'Asia/Vladivostok',
      });
      const timeReply = !recurrence && !oneOff ? parseTimeReply(text) : null;
      let responseText;
      if (recurrence) {
        if (!recurrence.ok) responseText = recurrence.responseText;
        else if (!this.recurringStore || !this.config.personalAutomation?.reminders) {
          responseText = 'Повторяющиеся напоминания сейчас недоступны.';
        } else {
          const saved = await this.recurringStore.create(this.config.ownerProfileId, recurrence,
            'telegram-update:' + update.update_id);
          if (saved.status === 'not_found') throw new Error('Owner profile missing for recurrence');
          const date = new Intl.DateTimeFormat('ru-RU',{timeZone:recurrence.timezone,
            day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(recurrence.nextAt));
          responseText = (saved.status === 'created' ? '✅ Повтор создан: ' : 'Повтор уже сохранён: ') +
            escapeHtml(recurrence.title) + '. Ближайшее напоминание: ' + date + '.';
        }
      } else if (oneOff) {
        if (oneOff.error) responseText = oneOff.error;
        else if (!this.oneOffReminderStore || !this.config.personalAutomation?.reminders) {
          responseText = 'Личные напоминания временно недоступны.';
        } else {
          const saved = await this.oneOffReminderStore.create(this.config.ownerProfileId,oneOff,update.update_id);
          responseText = oneOff.time ?
            '✅ Напоминание ' + (saved.created ? 'создано' : 'уже сохранено') + ': ' +
            escapeHtml(saved.row.title) + '. ' + formatReminder(oneOff.day,oneOff.time,oneOff.timezone) + '.' :
            '📝 Сохранил дело: ' + escapeHtml(saved.row.title) + '. Дата: ' +
            formatReminder(oneOff.day,null,oneOff.timezone) +
            '. Во сколько напомнить? Ответь, например: 15:00.';
        }
      } else if (timeReply && this.oneOffReminderStore) {
        const pending = await this.oneOffReminderStore.pending(this.config.ownerProfileId);
        if (pending.length > 1) responseText = 'Есть несколько дел без времени. Укажи дату и время вместе с названием дела.';
        else if (pending.length === 1) {
          const done = await this.oneOffReminderStore.setTime(this.config.ownerProfileId,pending[0].id,timeReply);
          responseText = done.error || ('✅ Напоминание создано: ' + escapeHtml(done.row.title) +
            '. ' + formatReminder(done.day,done.time,done.timezone) + '.');
        } else {
          const arthurRequest = buildArthurRequest({update: normalizedUpdate, userId:this.config.ownerProfileId,
            telegramUserId,chatId,correlationId,conversationId});
          responseText = formatArthurResponse(await this.arthur.handle(arthurRequest));
        }
      } else if (text === COMMANDS.START) {
        responseText = HELP_TEXT;
      } else if (text === COMMANDS.HELP) {
        responseText = HELP_TEXT;
      } else if (text === COMMANDS.STATUS) {
        responseText = await this.buildStatusText();
      } else if (text === COMMANDS.PROJECTS || /^статус проектов[.!?]?$/iu.test(text)) {
        responseText = await this.projectStatusReader();
      } else {
        const arthurRequest = buildArthurRequest({
          update: normalizedUpdate,
          userId: this.config.ownerProfileId,
          telegramUserId,
          chatId,
          correlationId,
          conversationId,
        });
        const arthurResponse = await this.arthur.handle(arthurRequest);
        responseText = formatArthurResponse(arthurResponse);
      }

      if (isVoice) responseText = '<b>🎤 Распознано:</b> ' +
        escapeHtml(text.slice(0, 750)) + '\n\n' + responseText;
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

  async sendLearningNotification(input = {}) {
    const ownerChatId = this.config.allowedUserIds.size === 1
      ? Array.from(this.config.allowedUserIds)[0]
      : null;
    if (!ownerChatId) {
      throw new Error('Learning notifications require exactly one owner Telegram user ID');
    }

    const employeeName = escapeHtml(String(input.employeeName || 'Продавец'));
    const storeName = escapeHtml(String(input.storeName || '—'));
    const testTitle = escapeHtml(String(input.testTitle || input.moduleCode || 'Тест'));
    const moduleCode = input.moduleCode
      ? ' (' + escapeHtml(String(input.moduleCode)) + ')'
      : '';
    const score = Number(input.score);
    const total = Number(input.total);
    const percent = Number(input.percent);
    const passed = input.passed === true;
    const status = passed ? '✅ пройден' : '❌ не пройден';
    const result = Number.isFinite(score) && Number.isFinite(total)
      ? score + '/' + total
      : '—';
    const percentText = Number.isFinite(percent)
      ? ' — ' + Math.round(percent) + '%'
      : '';

    const text = [
      '<b>Обучение продавца</b>',
      '',
      'Продавец: <b>' + employeeName + '</b>',
      'Магазин: ' + storeName,
      'Тест: ' + testTitle + moduleCode,
      'Результат: <b>' + result + percentText + '</b>',
      'Статус: <b>' + status + '</b>',
    ].join('\n');

    const correlationId = String(input.attemptId || generateCorrelationId());
    await this.telegram.sendMessage(ownerChatId, text);
    this.logger.info('seller_learning_notification_sent', {
      correlationId,
      channel: 'telegram',
    }, {
      attemptId: input.attemptId || null,
      employeeName: String(input.employeeName || ''),
      moduleCode: input.moduleCode || null,
      passed,
    });
    return { delivered: true };
  }

  async sendLearningOverdueNotification(input = {}) {
    const ownerChatId = this.config.allowedUserIds.size === 1
      ? Array.from(this.config.allowedUserIds)[0]
      : null;
    if (!ownerChatId) {
      throw new Error('Learning notifications require exactly one owner Telegram user ID');
    }

    const employeeName = escapeHtml(String(input.employeeName || 'Продавец'));
    const storeName = escapeHtml(String(input.storeName || '—'));
    const testTitle = escapeHtml(String(input.testTitle || input.moduleCode || 'Тест'));
    const moduleCode = input.moduleCode
      ? ' (' + escapeHtml(String(input.moduleCode)) + ')'
      : '';
    const assignedDateRaw = String(input.assignedDate || '');
    const assignedDate = /^\d{4}-\d{2}-\d{2}$/.test(assignedDateRaw)
      ? assignedDateRaw.slice(8, 10) + '.' + assignedDateRaw.slice(5, 7) + '.' + assignedDateRaw.slice(0, 4)
      : (assignedDateRaw || '—');
    const daysWaiting = Math.max(0, Number(input.daysWaiting) || 0);

    const text = [
      '<b>⚠️ Тест не пройден в срок</b>',
      '',
      'Продавец: <b>' + employeeName + '</b>',
      'Магазин: ' + storeName,
      'Тест: ' + testTitle + moduleCode,
      'Назначен: <b>' + escapeHtml(assignedDate) + '</b>',
      'Прошло: <b>' + daysWaiting + ' дн.</b>',
      'Статус: <b>не пройден</b>',
    ].join('\n');

    const correlationId = String(input.notificationId || generateCorrelationId());
    await this.telegram.sendMessage(ownerChatId, text);
    this.logger.info('seller_learning_overdue_notification_sent', {
      correlationId,
      channel: 'telegram',
    }, {
      notificationId: input.notificationId || null,
      employeeName: String(input.employeeName || ''),
      moduleCode: input.moduleCode || null,
      assignedDate: assignedDateRaw || null,
      daysWaiting,
    });
    return { delivered: true };
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
    if (this.personalScheduler) await this.personalScheduler.stop();

    try {
      if (this.scheduler) {
        this.scheduler.stop();
      }
    } catch (error) {
      this.logger.error('kpi_scheduler_stop_failed', null, {
        errorCode: error.code || error.name,
        errorMessage: error.message,
      });
    }

    try {
      if (this.dbPool) {
        await this.dbPool.end();
      }
    } catch (error) {
      this.logger.error('kpi_scheduler_pool_close_failed', null, {
        errorCode: error.code || error.name,
        errorMessage: error.message,
      });
    }

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
      kpiScheduler: this.scheduler ? this.scheduler.getHealth() : { running: false, automations: { daily: false, weekly: false, alerts: false } },
      personalScheduler: this.personalScheduler ? this.personalScheduler.getHealth()
        : { running: false, error: this.personalSchedulerError },
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
