'use strict';

// Telegram owner menu. 'om1:' is reserved only for this navigation.
// Reminder 'ar1:' and Harness 'am1:' belong to different handlers.
const LABELS = Object.freeze({
  home: '🏠 Меню',
  tasks: '📋 Задачи',
  agents: '🤖 Агенты',
  approval: '✅ Согласования',
  business: '📊 Бизнес',
  development: '🛠 Разработка',
  status: '🩺 Статус',
});

const KEYBOARD = Object.freeze({
  keyboard: [
    [{ text: LABELS.tasks }, { text: LABELS.agents }],
    [{ text: LABELS.approval }, { text: LABELS.business }],
    [{ text: LABELS.development }, { text: LABELS.status }],
    [{ text: LABELS.home }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Выбери раздел или напиши Артуру',
});

const CODE = Object.freeze({
  root: 'om1:root',
  tasks: 'om1:tasks',
  agents: 'om1:agents',
  approval: 'om1:approval',
  business: 'om1:business',
  development: 'om1:development',
  status: 'om1:status',
  today: 'om1:tasks:today',
  all: 'om1:tasks:all',
  overdue: 'om1:tasks:overdue',
  repeats: 'om1:tasks:repeats',
  newTask: 'om1:tasks:create',
  doneTask: 'om1:tasks:complete',
  moveTask: 'om1:tasks:move',
  miska: 'om1:business:miska',
  amper: 'om1:business:amper',
  ventil: 'om1:business:ventil',
  metiz: 'om1:business:metiz',
  purchasing: 'om1:business:purchasing',
  vozdooh: 'om1:business:vozdooh',
});

function button(label, data) {
  if (!Object.values(CODE).includes(data) || Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error('Unrecognized or oversize Telegram callback');
  }
  return { text: label, callback_data: data };
}

function inline(rows) { return { inline_keyboard: rows }; }
function backToRoot() { return [button('🏠 Главное меню', CODE.root)]; }
function backToTasks() { return [button('⬅️ К задачам', CODE.tasks)]; }
function backToBusiness() { return [button('⬅️ К бизнесу', CODE.business)]; }
function message(text, replyMarkup) {
  return { handled: true, kind: 'message', text, ...(replyMarkup ? { replyMarkup } : {}) };
}
function delegated(query, back) {
  return { handled: true, kind: 'delegate', query,
    replyMarkup: inline([back]) };
}

function createOwnerMenu({ ownerTelegramId } = {}) {
  const owner = String(ownerTelegramId || '').trim();
  if (!/^[0-9]+$/.test(owner)) throw new Error('Trusted Telegram owner ID required');

  function authorized(userId, chatId) {
    return String(userId||'')===owner && String(chatId||'')===owner;
  }

  function view(code) {
    switch (code) {
      case CODE.root:
        return message('Артур: главное меню. Выбери раздел или просто напиши мне.', KEYBOARD);
      case CODE.tasks:
        return message('📋 Задачи. Что нужно сделать?', inline([
          [button('📅 Сегодня', CODE.today), button('🗂 Все задачи', CODE.all)],
          [button('⏰ Просроченные', CODE.overdue), button('🔁 Повторяющиеся', CODE.repeats)],
          [button('➕ Создать', CODE.newTask), button('✅ Выполнить', CODE.doneTask)],
          [button('🕘 Перенести', CODE.moveTask)],
          backToRoot(),
        ]));
      case CODE.today: return delegated('Что у меня сегодня?', backToTasks());
      case CODE.all: return delegated('Что у меня по задачам?', backToTasks());
      case CODE.overdue: return delegated('Какие задачи у меня просрочены?', backToTasks());
      case CODE.repeats: return delegated('Какие у меня повторяющиеся задачи?', backToTasks());
      case CODE.newTask:
        return message('Чтобы создать задачу, напиши Артуру, например: «Запиши на сегодня: позвонить поставщику» или «Напомни завтра в 15:00 проверить заказ».', inline([backToTasks()]));
      case CODE.doneTask:
        return message('Чтобы выполнить задачу, напиши Артуру: «Я выполнил задачу позвонить поставщику». Под напоминаниями также есть кнопка «Выполнено».', inline([backToTasks()]));
      case CODE.moveTask:
        return message('Чтобы перенести задачу, напиши Артуру: «Перенеси задачу позвонить поставщику на пятницу».', inline([backToTasks()]));
      case CODE.agents:
        return message('🤖 Агенты Артура: DeepSeek и GLM помогают с анализом. Разработку через Codex ведём отдельно в ChatGPT. Нажми «Статус», чтобы проверить текущий AI-провайдер. Автозапуск Codex здесь недоступен.', inline([
          [button('🩺 Проверить статус', CODE.status)],
          backToRoot(),
        ]));
      case CODE.approval:
        return message('✅ Согласования Harness пока не активированы. Эта кнопка ничего не подтверждает. Письма, публикации, покупки и изменения в бизнес-системах требуют отдельного согласования.', inline([backToRoot()]));
      case CODE.business:
        return message('📊 Бизнес. Выбери направление. Показатели выводятся только при доступности источника; отсутствие свежих данных нельзя считать нулевой выручкой.', inline([
          [button('🐾 Миска', CODE.miska), button('⚡ Ампер', CODE.amper)],
          [button('🚰 Вентиль', CODE.ventil), button('🔩 Метиз Маркет', CODE.metiz)],
          [button('📦 Закупщик', CODE.purchasing), button('🌿 VOZDOOH', CODE.vozdooh)],
          backToRoot(),
        ]));
      case CODE.miska: return delegated('Как дела у Миски?', backToBusiness());
      case CODE.amper: return delegated('Как дела у Ампера?', backToBusiness());
      case CODE.ventil: return delegated('Как дела у Вентиля?', backToBusiness());
      case CODE.metiz: return delegated('Как дела у Метиз Маркета?', backToBusiness());
      case CODE.purchasing: return delegated('Что сейчас с закупщиком?', backToBusiness());
      case CODE.vozdooh:
        return message('🌿 VOZDOOH: актуальные заказы и остатки показываются только после проверки интеграции с магазином. Сейчас не выдаю сохранённые показатели за текущие.', inline([backToBusiness()]));
      case CODE.development:
        return message('🛠 Разработка: задачи и PR ведём в GitHub, Codex запускаем отдельно из ChatGPT. Эта кнопка не запускает Windows Codex worker и ничего не развёртывает.', {
          inline_keyboard: [
            [{ text: '📌 Задача №254', url: 'https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/issues/254' }],
            [{ text: '🔧 PR №255', url: 'https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/pull/255' }],
            backToRoot(),
          ],
        });
      case CODE.status:
        return { handled: true, kind: 'status', replyMarkup: inline([backToRoot()]) };
      default:
        return message('Кнопка устарела. Открой /menu.', inline([backToRoot()]));
    }
  }

  const textCommands = new Map(Object.entries(LABELS).map(([section, label]) =>
    [label, section === 'home' ? CODE.root : CODE[section]]
  ));

  function routeText({ text, userId, chatId } = {}) {
    const msg = String(text || '').trim();
    const code = msg === '/menu' ? CODE.root : textCommands.get(msg);
    if (!code) return { handled: false };
    if (!authorized(userId, chatId)) return { handled: true, denied: true };
    return view(code);
  }

  function routeCallback({ data, userId, chatId } = {}) {
    const value = String(data || '');
    if (!value.startsWith('om1:')) return { handled: false };
    if (!authorized(userId, chatId)) return { handled: true, denied: true };
    return view(value);
  }

  return { routeText, routeCallback, labels: LABELS };
}

module.exports = { createOwnerMenu, LABELS };
