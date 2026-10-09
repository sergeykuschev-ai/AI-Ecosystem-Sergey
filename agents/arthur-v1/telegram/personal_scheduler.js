'use strict';

const { createPersonalNotificationStore } = require('../../arthur-core/services/personal-notification-store');

function localTime(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(date));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

function timeMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function isQuiet(minute, start, end) {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeTitle(text, maxLength) {
  let result = '';
  for (const char of String(text)) {
    const escaped = escapeHtml(char);
    if (result.length + escaped.length > maxLength) return result + '…';
    result += escaped;
  }
  return result;
}

function briefText(tasks, now, timezone, evening) {
  const today = localTime(now, timezone).day;
  const dated = tasks.filter(task => task.dueAt && localTime(task.dueAt, timezone).day <= today);
  const waiting = tasks.filter(task => task.status === 'waiting' && task.nextCheckAt
    && Date.parse(task.nextCheckAt) <= now.getTime() && !dated.some(item => item.id === task.id));
  const unscheduled = tasks.filter(task => !task.dueAt && task.status !== 'waiting');
  const sections = [
    [evening ? 'Остались на сегодня и просрочены' : 'Сегодня и просрочены', dated],
    ['Пора проверить ожидания', waiting],
    ['Без срока', unscheduled],
  ];
  const lines = [evening ? '<b>Личные дела — вечерний обзор</b>' : '<b>Личные дела — план дня</b>', today];
  let shown = 0;
  for (const [title, items] of sections) {
    if (!items.length) continue;
    lines.push('', title + ':');
    for (const task of items) {
      if (shown >= 20) break;
      const overdue = task.dueAt && Date.parse(task.dueAt) < now.getTime() ? ' (просрочено)' : '';
      lines.push(`• ${safeTitle(task.title, 120)}${overdue}`);
      shown += 1;
    }
  }
  const count = dated.length + waiting.length + unscheduled.length;
  if (!count) lines.push('', 'Дел на сегодня и просроченных задач нет.');
  if (count > shown) lines.push('', `Ещё ${count - shown}. Спроси: «Что у меня по задачам?»`);
  if (evening && count) lines.push('', 'Скажи, что выполнено или что перенести.');
  return lines.join('\n');
}

class PersonalScheduler {
  constructor({ config, pool, store, telegram, ownerId, chatId, logger, clock = () => new Date() }) {
    Object.assign(this, { config, telegram, ownerId, chatId, logger, clock });
    this.store = store || createPersonalNotificationStore(pool);
    this.timer = null;
    this.runningTick = null;
    this.lastError = null;
    this.lastTick = null;
  }

  async initialize() {
    const profile = await this.store.initialize(this.ownerId);
    this.timezone = profile.timezone;
    localTime(this.clock(), this.timezone);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 60000);
    this.timer.unref?.();
    void this.tick();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.runningTick) await this.runningTick;
  }

  async deliver(key, text, now) {
    const claimId = await this.store.claim(this.ownerId, key, now.toISOString());
    if (!claimId) return;
    try {
      const result = await this.telegram.sendMessage(this.chatId, text);
      if (result?.ok !== true) throw new Error('Telegram did not confirm personal delivery');
      await this.store.finish(this.ownerId, key, claimId, this.clock().toISOString(), result.result?.message_id);
    } catch (error) {
      await this.store.retry(this.ownerId, key, claimId, this.clock().toISOString());
      throw error;
    }
  }

  tick() {
    if (this.runningTick) return this.runningTick;
    this.runningTick = this.runTick().catch(error => {
      this.lastError = error.code || error.name;
      this.logger?.error('personal_scheduler_tick_failed', null, { errorCode: this.lastError });
    }).finally(() => { this.runningTick = null; });
    return this.runningTick;
  }

  async runTick() {
    const now = this.clock();
    const local = localTime(now, this.timezone);
    this.lastTick = now.toISOString();
    if (isQuiet(local.minute, timeMinutes(this.config.quietStart), timeMinutes(this.config.quietEnd))) return;
    const tasks = await this.store.listTasks(this.ownerId);
    const errors = [];
    if (this.config.reminders) {
      // Catch up after downtime/quiet hours; completed and cancelled tasks are excluded by the store.
      const due = tasks.filter(task => task.remindAt && Date.parse(task.remindAt) <= now.getTime());
      for (const task of due) {
        const key = `reminder:${task.id}:${new Date(task.remindAt).toISOString()}`;
        const when = new Intl.DateTimeFormat('ru-RU', {
          timeZone: this.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(task.remindAt));
        try {
          await this.deliver(key, `<b>Напоминание</b> · ${when}\n${safeTitle(task.title, 2000)}`, now);
        } catch (error) { errors.push(error); }
      }
    }
    for (const kind of ['morning', 'evening']) {
      if (!this.config[kind].enabled || local.minute < timeMinutes(this.config[kind].time)) continue;
      // Morning catch-up must not arrive after the evening briefing window.
      if (kind === 'morning' && local.minute >= timeMinutes(this.config.evening.time)) continue;
      try {
        await this.deliver(`${kind}:${local.day}`, briefText(tasks, now, this.timezone, kind === 'evening'), now);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
    this.lastError = null;
  }

  getHealth() {
    return { running: Boolean(this.timer), timezone: this.timezone, lastTick: this.lastTick, lastError: this.lastError };
  }
}

module.exports = { PersonalScheduler, briefText, localTime, isQuiet };
