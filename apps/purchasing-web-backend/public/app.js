(function initializePurchasingFrontend(globalObject) {
  'use strict';

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const POLL_INTERVAL_MS = 1000;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000;
  const ALLOWED_FILE_PATTERN = /\.(xlsx|xls)$/i;
  const RUN_LINK_PATTERN =
    /^\/api\/v1\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/(?:summary|artifacts|items))?$/i;
  const ARTIFACT_LINK_PATTERN =
    /^\/api\/v1\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/artifacts\/[a-z0-9.-]+$/i;

  const ARTIFACTS = Object.freeze({
    result: Object.freeze({
      name: 'result.json',
      pathSuffix: '/artifacts/result.json',
    }),
    report: Object.freeze({
      name: 'report.txt',
      pathSuffix: '/artifacts/report.txt',
    }),
    'owner-review': Object.freeze({
      name: 'owner-review-report.md',
      pathSuffix: '/artifacts/owner-review-report.md',
    }),
    explanations: Object.freeze({
      name: 'recommendation-explanations-report.md',
      pathSuffix: '/artifacts/recommendation-explanations-report.md',
    }),
  });
  const ITEM_FILTERS = Object.freeze({
    all: Object.freeze({}),
    undecided: Object.freeze({
      owner_review: 'true',
      owner_decision: 'missing',
    }),
    deferred: Object.freeze({
      owner_review: 'true',
      owner_decision: 'DEFER',
    }),
    confirmed: Object.freeze({ owner_decision: 'BUY' }),
    skip: Object.freeze({ owner_decision: 'SKIP' }),
  });
  const ITEM_SORTS = Object.freeze([
    'source_row',
    'name',
    'recommended_quantity',
    'recommended_line_value',
    'free_stock',
    'sales_28_days',
  ]);

  const ERROR_MESSAGES = Object.freeze({
    FILE_REQUIRED: 'Выберите Excel-файл.',
    INVALID_FILE: 'Выберите файл в формате .xlsx или .xls.',
    UPLOAD_TOO_LARGE: 'Файл превышает допустимый размер 20 МБ.',
    UNSUPPORTED_FILE_TYPE: 'Формат файла не поддерживается.',
    INVALID_WORKBOOK:
      'Не удалось прочитать отчёт. Проверьте файл SmartZapas и повторите.',
    INPUT_CONTRACT_ERROR:
      'В отчёте не хватает обязательных данных для расчёта.',
    RUN_ALREADY_IN_PROGRESS:
      'Другой расчёт уже выполняется. Повторите запуск немного позже.',
    RUN_FAILED: 'Расчёт не завершён. Проверьте файл и попробуйте снова.',
    POLL_TIMEOUT:
      'Расчёт занимает больше 10 минут. Попробуйте повторить позже.',
    NETWORK_ERROR:
      'Нет связи с локальным сервером. Проверьте, что он запущен.',
    INVALID_OWNER_DECISION:
      'Проверьте количество и повторите сохранение решения.',
    OWNER_DECISION_STORAGE_ERROR:
      'Не удалось сохранить решение. Попробуйте ещё раз.',
    ITEM_DECISION_UNAVAILABLE:
      'Для этого товара решение сейчас недоступно.',
  });

  class FrontendError extends Error {
    constructor(code) {
      super(code);
      this.name = 'FrontendError';
      this.code = code;
    }
  }

  function formatRub(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function displayCount(value) {
    return Number.isInteger(value)
      ? new Intl.NumberFormat('ru-RU').format(value)
      : '—';
  }

  function decisionCounterView(summary, totalItems) {
    return {
      all: displayCount(totalItems),
      needsDecision: displayCount(summary?.needs_decision),
      confirmedBuy: displayCount(summary?.confirmed_buy),
      excluded: displayCount(summary?.excluded),
    };
  }

  function defaultDecisionFilter(summary) {
    return (summary?.needs_decision || 0) > 0 ? 'needs' : 'all';
  }

  function needsOwnerDecisionView(item) {
    const ownerDecision = item?.owner_decision?.decision || null;
    return item?.matrix?.owner_review_required === true &&
      (ownerDecision === null || ownerDecision === 'DEFER');
  }

  function itemMatchesDecisionFilter(item, filter) {
    const decision = item?.owner_decision?.decision || null;
    if (filter === 'needs') return needsOwnerDecisionView(item);
    if (filter === 'confirmed') return decision === 'BUY';
    if (filter === 'skip') return decision === 'SKIP';
    return true;
  }

  function formatQuantity(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function recommendedQuantity(item) {
    return item?.quantities?.approved_quantity ??
      item?.quantities?.provisional_quantity ??
      item?.quantities?.calculated_quantity ??
      null;
  }

  function recommendedLineValue(item) {
    return item?.amounts?.approved_line_value ??
      item?.amounts?.provisional_line_value ??
      null;
  }

  function itemStatusView(item) {
    if (item?.owner_decision?.decision) {
      return {
        label: 'Решение владельца сохранено',
        className: 'status-auto',
      };
    }
    const statuses = {
      auto_approved: ['Агент рекомендует заказать', 'status-auto'],
      pending_manual_review: ['Нужно решение владельца', 'status-pending'],
      no_order_action: ['Агент не рекомендует заказывать', 'status-skip'],
      confidently_excluded:
        ['Агент не рекомендует заказывать', 'status-skip'],
      postponed: ['Нужно решение владельца', 'status-pending'],
    };
    const exact = statuses[item?.workflow_status];
    if (exact) return { label: exact[0], className: exact[1] };
    if (['must_buy', 'recommended'].includes(item?.decision)) {
      return { label: 'Агент рекомендует заказать', className: 'status-buy' };
    }
    if (item?.decision === 'do_not_buy') {
      return {
        label: 'Агент не рекомендует заказывать',
        className: 'status-skip',
      };
    }
    if (item?.decision === 'manual_review') {
      return { label: 'Нужно решение владельца', className: 'status-pending' };
    }
    return { label: 'Без решения', className: 'status-skip' };
  }

  function matrixRoleLabel(role) {
    return {
      CORE: 'Основной ассортимент',
      IMPORTANT: 'Важный ассортимент',
      OPTIONAL: 'Дополнительный ассортимент',
      EXIT: 'Кандидат на вывод',
      UNCLASSIFIED: 'Роль требует уточнения',
    }[role] || 'Не определена';
  }

  function technicalExplanation(item) {
    const text = String(item?.explanation?.summary || '');
    if (!text) return 'Дополнительное техническое объяснение отсутствует.';
    return text
      .replace(/Purchasing Agent/gi, 'агент')
      .replace(/Matrix Builder/gi, 'анализ ассортимента')
      .replace(/\bmanual review\b/gi, 'решение владельца')
      .replace(/\boverlay\b/gi, 'управленческий слой')
      .replace(/\bDTO\b/gi, 'данные отчёта')
      .replace(/\bEXIT\b/g, 'кандидат на вывод')
      .replace(/\bCORE\b/g, 'основной ассортимент')
      .replace(/\bOPTIONAL\b/g, 'дополнительный ассортимент')
      .replace(/\bUNCLASSIFIED\b/g, 'роль требует уточнения');
  }

  function ownerDecisionView(item) {
    const decision = item?.owner_decision?.decision;
    if (decision === 'BUY') {
      return {
        label: `Заказать ${formatQuantity(
          item.owner_decision.quantity
        )} шт.`,
        className: 'decision-buy',
      };
    }
    if (decision === 'SKIP') {
      return { label: 'Не заказывать', className: 'decision-skip' };
    }
    if (decision === 'DEFER') {
      return { label: 'Отложено', className: 'decision-defer' };
    }
    if (item?.owner_decision?.status === 'active') {
      return {
        label: 'Есть решение по ассортименту',
        className: 'decision-none',
      };
    }
    return { label: 'Решение не принято', className: 'decision-none' };
  }

  function plainReason(item) {
    const codes = new Set([
      ...(item?.matrix?.reason_codes || []),
      ...(item?.explanation?.reason_codes || []),
    ]);
    const missing = new Set(item?.matrix?.missing_fields || []);
    const reasons = [];
    const technicalText = String(item?.explanation?.summary || '');
    if (
      missing.has('free_stock') ||
      /отсутств.*(?:остат|склад)|нет достоверн.*остат/i.test(technicalText)
    ) {
      reasons.push(
        'В отчёте нет остатка. Проверьте наличие товара в магазине.'
      );
    }
    if (
      codes.has('possible_exit_candidate') ||
      item?.matrix?.role === 'EXIT'
    ) {
      reasons.push(
        'Товар предложен к выводу из ассортимента. ' +
        'Заказывать его не рекомендуется.'
      );
    }
    if (codes.has('approved_policy_conflict')) {
      reasons.push('Рекомендация отличается от утверждённой политики.');
    }
    if (
      codes.has('irregular_sales') ||
      codes.has('core_below_active_week_ratio')
    ) {
      reasons.push('Продажи нерегулярны, поэтому нужен осторожный запас.');
    }
    if (item?.matrix?.owner_review_required === true) {
      reasons.push(
        'Агент не смог принять окончательное решение. ' +
        'Выберите действие вручную.'
      );
    }
    return reasons.slice(0, 2).join(' ') ||
      technicalExplanation(item) ||
      'Рекомендация сформирована по продажам и текущему остатку.';
  }

  function buildDecisionUrl(itemsUrl, rowId) {
    const safeBase = safeRunLink(itemsUrl);
    if (
      !safeBase ||
      !safeBase.endsWith('/items') ||
      typeof rowId !== 'string' ||
      rowId.length < 1 ||
      rowId.length > 512 ||
      rowId.includes('\0') ||
      rowId.includes('/') ||
      rowId.includes('\\')
    ) {
      throw new FrontendError('INVALID_OWNER_DECISION');
    }
    return `${safeBase}/${encodeURIComponent(rowId)}/decision`;
  }

  function buildItemsUrl(baseUrl, state = {}) {
    const safeBase = safeRunLink(baseUrl);
    if (!safeBase || !safeBase.endsWith('/items')) {
      throw new FrontendError('RUN_FAILED');
    }
    const page = Number.isInteger(state.page) && state.page > 0
      ? state.page
      : 1;
    const pageSize = [25, 50, 100].includes(state.pageSize)
      ? state.pageSize
      : 25;
    const sort = ITEM_SORTS.includes(state.sort)
      ? state.sort
      : 'source_row';
    const order = state.order === 'desc' ? 'desc' : 'asc';
    const filter = ITEM_FILTERS[state.filter] || ITEM_FILTERS.all;
    const parameters = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort,
      order,
      ...filter,
    });
    const query = typeof state.q === 'string' ? state.q.trim() : '';
    if (query) parameters.set('q', query.slice(0, 100));
    return `${safeBase}?${parameters.toString()}`;
  }

  function itemSortValue(item, sort) {
    if (sort === 'name') return String(item?.name || '').toLocaleLowerCase();
    if (sort === 'recommended_quantity') return recommendedQuantity(item);
    if (sort === 'recommended_line_value') {
      return recommendedLineValue(item);
    }
    if (sort === 'free_stock') return item?.stock?.free_stock ?? null;
    if (sort === 'sales_28_days') {
      return item?.sales?.last_28_days ?? null;
    }
    return item?.source_row ?? null;
  }

  function compareItemValues(left, right, sort, order) {
    const leftValue = itemSortValue(left, sort);
    const rightValue = itemSortValue(right, sort);
    let result = 0;
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (typeof leftValue === 'string') {
      result = leftValue.localeCompare(String(rightValue), 'ru');
    } else if (leftValue !== rightValue) {
      result = Number(leftValue) - Number(rightValue);
    }
    if (result !== 0) return order === 'desc' ? -result : result;
    return String(left?.row_id || '').localeCompare(
      String(right?.row_id || '')
    );
  }

  async function requestCompleteItemFilter(
    fetchFunction,
    baseUrl,
    state,
    filter
  ) {
    const requestState = {
      ...state,
      filter,
      page: 1,
      pageSize: 100,
    };
    const first = await requestJson(
      fetchFunction,
      buildItemsUrl(baseUrl, requestState)
    );
    const totalPages = first?.pagination?.total_pages || 0;
    const remaining = await Promise.all(
      Array.from(
        { length: Math.max(0, totalPages - 1) },
        (_, index) => requestJson(
          fetchFunction,
          buildItemsUrl(baseUrl, {
            ...requestState,
            page: index + 2,
          })
        )
      )
    );
    return {
      items: [
        ...(first?.items || []),
        ...remaining.flatMap(payload => payload?.items || []),
      ],
      owner_decisions: first?.owner_decisions || null,
    };
  }

  async function requestNeedsDecisionItems(fetchFunction, baseUrl, state) {
    const [undecided, deferred] = await Promise.all([
      requestCompleteItemFilter(fetchFunction, baseUrl, state, 'undecided'),
      requestCompleteItemFilter(fetchFunction, baseUrl, state, 'deferred'),
    ]);
    const uniqueItems = new Map();
    for (const item of [...undecided.items, ...deferred.items]) {
      if (
        typeof item?.row_id === 'string' &&
        itemMatchesDecisionFilter(item, 'needs')
      ) {
        uniqueItems.set(item.row_id, item);
      }
    }
    const items = [...uniqueItems.values()].sort((left, right) =>
      compareItemValues(left, right, state.sort, state.order)
    );
    const pageSize = state.pageSize;
    const totalPages = Math.ceil(items.length / pageSize);
    const page = Math.min(state.page, Math.max(1, totalPages));
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      pagination: {
        page,
        page_size: pageSize,
        total_items: items.length,
        total_pages: totalPages,
      },
      owner_decisions:
        undecided.owner_decisions || deferred.owner_decisions,
    };
  }

  function paginationLabel(pagination = {}) {
    const total = Number.isInteger(pagination.total_items)
      ? pagination.total_items
      : 0;
    if (total === 0) return 'Показано 0 из 0';
    const page = Number.isInteger(pagination.page) ? pagination.page : 1;
    const pageSize = Number.isInteger(pagination.page_size)
      ? pagination.page_size
      : 25;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return `Показано ${start}–${end} из ${total}`;
  }

  function appendTextCell(documentObject, row, text, className = '') {
    const cell = documentObject.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    row.append(cell);
    return cell;
  }

  function appendDetail(documentObject, container, label, value) {
    const block = documentObject.createElement('div');
    const term = documentObject.createElement('span');
    const description = documentObject.createElement('strong');
    term.textContent = label;
    description.textContent = value;
    block.append(term, description);
    container.append(block);
  }

  function createItemRows(documentObject, item, options = {}) {
    const row = documentObject.createElement('tr');
    row.className = 'product-row';
    const nameCell = documentObject.createElement('td');
    nameCell.setAttribute('data-label', 'Товар');
    const expandButton = documentObject.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'product-expand';
    expandButton.setAttribute('aria-expanded', 'false');
    const name = documentObject.createElement('strong');
    name.className = 'product-name';
    name.textContent = item?.name || 'Без названия';
    const sku = documentObject.createElement('span');
    sku.className = 'product-sku';
    sku.textContent = item?.sku ? `Артикул: ${item.sku}` : 'Артикул не указан';
    const supplier = documentObject.createElement('span');
    supplier.className = 'product-supplier';
    supplier.textContent = item?.brand || item?.supplier || 'Бренд не указан';
    const expandIcon = documentObject.createElement('span');
    expandIcon.className = 'product-expand-icon';
    expandIcon.textContent = '⌄';
    expandButton.append(name, sku, supplier, expandIcon);
    nameCell.append(expandButton);
    row.append(nameCell);

    const stockCell = appendTextCell(
      documentObject,
      row,
      formatQuantity(item?.stock?.free_stock),
      'numeric-cell'
    );
    stockCell.setAttribute('data-label', 'Остаток');
    const salesCell = appendTextCell(
      documentObject,
      row,
      formatQuantity(item?.sales?.last_28_days),
      'numeric-cell'
    );
    salesCell.setAttribute('data-label', 'Продажи 28 дней');
    const quantityCell = appendTextCell(
      documentObject,
      row,
      formatQuantity(recommendedQuantity(item)),
      'numeric-cell'
    );
    quantityCell.setAttribute('data-label', 'Рекомендовано');
    const amountCell = appendTextCell(
      documentObject,
      row,
      formatRub(recommendedLineValue(item)),
      'numeric-cell'
    );
    amountCell.setAttribute('data-label', 'Сумма');

    const decisionCell = documentObject.createElement('td');
    decisionCell.className = 'decision-cell';
    decisionCell.setAttribute('data-label', 'Решение');
    const decisionStatus = documentObject.createElement('span');
    const controls = documentObject.createElement('div');
    controls.className = 'decision-controls';
    const quantity = documentObject.createElement('input');
    quantity.type = 'number';
    quantity.min = '0';
    quantity.max = '10000';
    quantity.step = '1';
    quantity.inputMode = 'numeric';
    quantity.setAttribute('aria-label', 'Количество к заказу');
    const initialQuantity = item?.owner_decision?.decision === 'BUY'
      ? item.owner_decision.quantity
      : recommendedQuantity(item);
    quantity.value = Number.isFinite(initialQuantity)
      ? String(Math.max(0, Math.round(initialQuantity)))
      : '0';

    const actionDefinitions = [
      ['BUY', 'Заказать', 'action-buy'],
      ['SKIP', 'Не заказывать', 'action-skip'],
      ['DEFER', 'Отложить', 'action-defer'],
    ];
    const actionGroup = documentObject.createElement('div');
    actionGroup.className = 'decision-action-group';
    const buttons = actionDefinitions.map(([decision, label, className]) => {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = `decision-action ${className}`;
      button.dataset.decision = decision;
      button.textContent = label;
      actionGroup.append(button);
      return button;
    });
    controls.append(quantity, actionGroup);
    const saveMessage = documentObject.createElement('small');
    saveMessage.className = 'decision-save-message';

    function syncDecisionStatus() {
      const view = ownerDecisionView(item);
      decisionStatus.className = `decision-status ${view.className}`;
      decisionStatus.textContent = view.label;
      for (const button of buttons) {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.decision === item?.owner_decision?.decision)
        );
      }
    }
    syncDecisionStatus();

    for (const button of buttons) {
      button.addEventListener('click', async () => {
        if (typeof options.onDecision !== 'function') return;
        const decision = button.dataset.decision;
        const requestedQuantity = decision === 'BUY'
          ? Number(quantity.value)
          : decision === 'SKIP'
            ? 0
            : null;
        if (
          decision === 'BUY' &&
          (!Number.isInteger(requestedQuantity) ||
            requestedQuantity < 0 ||
            requestedQuantity > 10000)
        ) {
          saveMessage.textContent =
            'Введите целое количество от 0 до 10000.';
          saveMessage.dataset.tone = 'error';
          return;
        }
        for (const action of buttons) action.disabled = true;
        quantity.disabled = true;
        saveMessage.textContent = 'Сохраняем…';
        saveMessage.dataset.tone = 'saving';
        try {
          const result = await options.onDecision({
            item,
            decision,
            quantity: requestedQuantity,
          });
          item.owner_decision = result.item.owner_decision;
          if (item.owner_decision.decision === 'BUY') {
            quantity.value = String(item.owner_decision.quantity ?? 0);
          }
          syncDecisionStatus();
          saveMessage.textContent = 'Сохранено';
          saveMessage.dataset.tone = 'success';
          if (typeof options.onSaved === 'function') {
            const effect = options.onSaved(result, item);
            if (effect?.remove === true) {
              row.hidden = true;
              detailsRow.hidden = true;
            }
          }
        } catch (error) {
          saveMessage.textContent =
            ERROR_MESSAGES[error?.code] ||
            'Не удалось сохранить. Решение не изменено.';
          saveMessage.dataset.tone = 'error';
        } finally {
          for (const action of buttons) action.disabled = false;
          quantity.disabled = false;
        }
      });
    }
    decisionCell.append(decisionStatus, controls, saveMessage);
    row.append(decisionCell);

    const detailsRow = documentObject.createElement('tr');
    detailsRow.className = 'product-details-row';
    detailsRow.hidden = true;
    const detailsCell = documentObject.createElement('td');
    detailsCell.colSpan = 6;
    const details = documentObject.createElement('div');
    details.className = 'product-details';
    const facts = documentObject.createElement('div');
    facts.className = 'product-detail-grid';
    const status = itemStatusView(item);
    appendDetail(
      documentObject,
      facts,
      'Цена',
      formatRub(item?.amounts?.unit_price)
    );
    appendDetail(documentObject, facts, 'Статус расчёта', status.label);
    appendDetail(
      documentObject,
      facts,
      'Текущее решение',
      ownerDecisionView(item).label
    );
    const reason = documentObject.createElement('p');
    reason.className = 'plain-reason';
    reason.textContent = plainReason(item);
    const signals = documentObject.createElement('p');
    signals.className = 'matrix-signals';
    signals.textContent =
      `Ассортимент: ${matrixRoleLabel(item?.matrix?.role)}. ` +
      `Средние продажи ` +
      `${formatQuantity(item?.matrix?.average_weekly_sales)} шт./нед., ` +
      `активность ${typeof item?.matrix?.active_week_ratio === 'number'
        ? Math.round(item.matrix.active_week_ratio * 100)
        : '—'}%, ` +
      `стратегическая защита — ` +
      `${item?.matrix?.strategic_protected ? 'да' : 'нет'}.`;
    const missing = documentObject.createElement('p');
    missing.className = 'missing-data';
    missing.textContent = item?.matrix?.missing_fields?.length
      ? `Не хватает данных: ${item.matrix.missing_fields.join(', ')}.`
      : 'Критичных пропусков данных не обнаружено.';
    const technical = documentObject.createElement('details');
    technical.open = false;
    const technicalSummary = documentObject.createElement('summary');
    technicalSummary.textContent = 'Показать технические детали';
    const technicalText = documentObject.createElement('pre');
    technicalText.textContent = technicalExplanation(item);
    technical.append(technicalSummary, technicalText);
    details.append(reason, facts, signals, missing, technical);
    detailsCell.append(details);
    detailsRow.append(detailsCell);

    expandButton.addEventListener('click', () => {
      const open = detailsRow.hidden;
      detailsRow.hidden = !open;
      expandButton.setAttribute('aria-expanded', String(open));
    });
    return [row, detailsRow];
  }

  function createItemRow(documentObject, item, options = {}) {
    return createItemRows(documentObject, item, options)[0];
  }

  function renderItemRows(documentObject, body, items, options = {}) {
    body.replaceChildren();
    for (const item of Array.isArray(items) ? items : []) {
      body.append(...createItemRows(documentObject, item, options));
    }
  }

  function setProductsPanelState(elements, state) {
    elements.products.hidden = state === 'hidden';
    elements.productsLoading.hidden = state !== 'loading';
    elements.productsError.hidden = state !== 'error';
    elements.productsEmpty.hidden = state !== 'empty';
    elements.productsContent.hidden = state !== 'ready';
  }

  function formatDuration(startedAt, completedAt) {
    const started = Date.parse(startedAt);
    const completed = Date.parse(completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed)) return '—';
    const seconds = Math.max(0, Math.round((completed - started) / 1000));
    if (seconds < 60) return `${seconds} сек`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} мин ${seconds % 60} сек`;
  }

  function financialStatusLabel(status) {
    const labels = {
      green: '🟢 Достаточный резерв',
      yellow: '🟠 Требуется внимание',
      red: '🔴 Требуется решение владельца',
      approved: '🟢 Одобрено',
      review: '🟠 Требуется проверка',
    };
    return labels[String(status || '').toLowerCase()] || 'Не указан';
  }

  function summaryView(summary, status) {
    const amounts = summary?.amounts || {};
    return {
      skuCount: displayCount(summary?.sku_count),
      analyzerOrderSum: formatRub(amounts.analyzer_order_sum),
      autoApprovedSum: formatRub(amounts.auto_approved_sum),
      pendingReviewSum: formatRub(amounts.pending_review_sum),
      workingMaximumSum: formatRub(amounts.working_maximum_sum),
      financiallyAssessedSum: formatRub(
        amounts.financially_assessed_sum
      ),
      financialStatus: financialStatusLabel(summary?.financial?.status),
      ownerReviewCount: displayCount(
        summary?.owner_review?.action_required
      ),
      calculationTime: formatDuration(
        status?.started_at,
        status?.completed_at
      ),
    };
  }

  function safeRunLink(value) {
    return typeof value === 'string' &&
      RUN_LINK_PATTERN.test(value) &&
      !value.includes('..') &&
      !value.includes('\\')
      ? value
      : null;
  }

  function safeArtifactDownloadUrl(value, definition) {
    if (
      typeof value !== 'string' ||
      !ARTIFACT_LINK_PATTERN.test(value)
    ) {
      return null;
    }
    if (value.includes('..') || value.includes('\\') || value.includes('\0')) {
      return null;
    }
    return value.endsWith(definition.pathSuffix) ? value : null;
  }

  function selectArtifacts(manifest) {
    const entries = Array.isArray(manifest?.artifacts)
      ? manifest.artifacts
      : [];
    const selected = {};
    for (const [key, definition] of Object.entries(ARTIFACTS)) {
      const entry = entries.find(item =>
        item?.name === definition.name &&
        safeArtifactDownloadUrl(item.download_url, definition)
      );
      if (entry) {
        selected[key] = {
          name: definition.name,
          downloadUrl: entry.download_url,
        };
      }
    }
    return selected;
  }

  async function requestJson(fetchFunction, url, options) {
    let response;
    try {
      response = await fetchFunction(url, options);
    } catch {
      throw new FrontendError('NETWORK_ERROR');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new FrontendError('RUN_FAILED');
    }
    if (!response.ok) {
      throw new FrontendError(payload?.error?.code || 'RUN_FAILED');
    }
    return payload?.data;
  }

  async function pollRunStatus(options) {
    const {
      fetchFunction,
      statusUrl,
      onStatus = () => {},
      intervalMs = POLL_INTERVAL_MS,
      timeoutMs = POLL_TIMEOUT_MS,
      now = Date.now,
      sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    } = options;
    const startedAt = now();

    while (now() - startedAt < timeoutMs) {
      const status = await requestJson(fetchFunction, statusUrl);
      onStatus(status);
      if (status?.status === 'completed') return status;
      if (status?.status === 'failed') {
        throw new FrontendError(status.error?.code || 'RUN_FAILED');
      }
      await sleep(intervalMs);
    }
    throw new FrontendError('POLL_TIMEOUT');
  }

  function createApplication(documentObject, fetchFunction) {
    const elements = {
      form: documentObject.getElementById('run-form'),
      fileInput: documentObject.getElementById('file-input'),
      fileError: documentObject.getElementById('file-error'),
      selectedFile: documentObject.getElementById('selected-file'),
      selectedFileName: documentObject.getElementById('selected-file-name'),
      runButton: documentObject.getElementById('run-button'),
      statusPill: documentObject.getElementById('status-pill'),
      statusMessage: documentObject.getElementById('status-message'),
      statusSteps: Array.from(
        documentObject.querySelectorAll('#status-list li')
      ),
      results: documentObject.getElementById('results'),
      exportButton: documentObject.getElementById('export-button'),
      exportMenu: documentObject.getElementById('export-menu'),
      calculationTime: documentObject.getElementById('calculation-time'),
      products: documentObject.getElementById('products'),
      productsSearch: documentObject.getElementById('products-search'),
      productFilters: Array.from(
        documentObject.querySelectorAll('[data-filter]')
      ),
      productsLoading: documentObject.getElementById('products-loading'),
      productsError: documentObject.getElementById('products-error'),
      productsEmpty: documentObject.getElementById('products-empty'),
      productsContent: documentObject.getElementById('products-content'),
      productsBody: documentObject.getElementById('products-body'),
      productsPageSize:
        documentObject.getElementById('products-page-size'),
      productsRange: documentObject.getElementById('products-range'),
      productsPrevious:
        documentObject.getElementById('products-previous'),
      productsNext: documentObject.getElementById('products-next'),
      decisionCounters: {
        all: documentObject.getElementById('decision-all'),
        needsDecision: documentObject.getElementById('decision-needs'),
        confirmedBuy: documentObject.getElementById('decision-buy'),
        excluded: documentObject.getElementById('decision-skip'),
      },
      sortButtons: Array.from(
        documentObject.querySelectorAll('[data-sort]')
      ),
      summary: {
        skuCount: documentObject.getElementById('sku-count'),
        analyzerOrderSum:
          documentObject.getElementById('analyzer-order-sum'),
        autoApprovedSum:
          documentObject.getElementById('auto-approved-sum'),
        pendingReviewSum:
          documentObject.getElementById('pending-review-sum'),
        workingMaximumSum:
          documentObject.getElementById('working-maximum-sum'),
        financiallyAssessedSum:
          documentObject.getElementById('financially-assessed-sum'),
        financialStatus:
          documentObject.getElementById('financial-status'),
        ownerReviewCount:
          documentObject.getElementById('owner-review-count'),
      },
    };

    let selectedFile = null;
    let active = false;
    let availableArtifacts = {};
    let itemRequestSequence = 0;
    let searchTimer = null;
    const itemState = {
      baseUrl: null,
      page: 1,
      pageSize: 25,
      q: '',
      filter: 'all',
      sort: 'source_row',
      order: 'asc',
      totalPages: 0,
      totalItems: null,
      defaultFilterResolved: false,
    };

    function setExportOpen(open) {
      const shouldOpen = open && !elements.exportButton.disabled;
      elements.exportButton.setAttribute(
        'aria-expanded',
        String(shouldOpen)
      );
      elements.exportMenu.hidden = !shouldOpen;
    }

    function resetExports() {
      availableArtifacts = {};
      setExportOpen(false);
      elements.exportButton.disabled = true;
      for (const button of documentObject.querySelectorAll(
        '[data-artifact-key]'
      )) {
        button.disabled = true;
      }
    }

    function syncFilterControls() {
      for (const button of elements.productFilters) {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.filter === itemState.filter)
        );
      }
    }

    function syncSortControls() {
      for (const button of elements.sortButtons) {
        const heading = button.closest('th');
        const activeSort = button.dataset.sort === itemState.sort;
        heading.setAttribute(
          'aria-sort',
          activeSort
            ? (itemState.order === 'desc' ? 'descending' : 'ascending')
            : 'none'
        );
      }
    }

    function resetItems() {
      itemRequestSequence += 1;
      if (searchTimer) clearTimeout(searchTimer);
      Object.assign(itemState, {
        baseUrl: null,
        page: 1,
        pageSize: 25,
        q: '',
        filter: 'all',
        sort: 'source_row',
        order: 'asc',
        totalPages: 0,
        totalItems: null,
        defaultFilterResolved: false,
      });
      elements.productsSearch.value = '';
      elements.productsPageSize.value = '25';
      elements.productsRange.textContent = 'Показано 0 из 0';
      elements.productsPrevious.disabled = true;
      elements.productsNext.disabled = true;
      renderDecisionCounters(null);
      renderItemRows(documentObject, elements.productsBody, []);
      syncFilterControls();
      syncSortControls();
      setProductsPanelState(elements, 'hidden');
    }

    function renderDecisionCounters(summary) {
      const view = decisionCounterView(summary, itemState.totalItems);
      for (const [name, element] of Object.entries(
        elements.decisionCounters
      )) {
        element.textContent = view[name];
      }
    }

    async function saveItemDecision(input) {
      const decisionUrl = buildDecisionUrl(
        itemState.baseUrl,
        input.item.row_id
      );
      return requestJson(fetchFunction, decisionUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          decision: input.decision,
          quantity: input.quantity,
        }),
      });
    }

    function renderItemsPayload(payload) {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const pagination = payload?.pagination || {};
      itemState.page = Number.isInteger(pagination.page)
        ? pagination.page
        : itemState.page;
      itemState.totalPages = Number.isInteger(pagination.total_pages)
        ? pagination.total_pages
        : 0;
      if (
        itemState.filter === 'all' &&
        Number.isInteger(pagination.total_items)
      ) {
        itemState.totalItems = pagination.total_items;
      }
      renderDecisionCounters(payload?.owner_decisions);
      renderItemRows(documentObject, elements.productsBody, items, {
        onDecision: saveItemDecision,
        onSaved(result, savedItem) {
          renderDecisionCounters(result.owner_decisions);
          const remove = !itemMatchesDecisionFilter(
            savedItem,
            itemState.filter
          );
          if (remove) {
            setTimeout(() => loadItems({ silent: true }), 0);
          }
          return { remove };
        },
      });
      elements.productsRange.textContent = paginationLabel(pagination);
      elements.productsPrevious.disabled = itemState.page <= 1;
      elements.productsNext.disabled =
        itemState.totalPages === 0 ||
        itemState.page >= itemState.totalPages;
      setProductsPanelState(
        elements,
        items.length === 0 ? 'empty' : 'ready'
      );
    }

    async function loadItems(options = {}) {
      if (!itemState.baseUrl) return;
      const sequence = ++itemRequestSequence;
      if (!options.silent) setProductsPanelState(elements, 'loading');
      try {
        const payload = itemState.filter === 'needs'
          ? await requestNeedsDecisionItems(
            fetchFunction,
            itemState.baseUrl,
            itemState
          )
          : await requestJson(
            fetchFunction,
            buildItemsUrl(itemState.baseUrl, itemState)
          );
        if (sequence !== itemRequestSequence) return;
        if (!itemState.defaultFilterResolved) {
          itemState.defaultFilterResolved = true;
          if (Number.isInteger(payload?.pagination?.total_items)) {
            itemState.totalItems = payload.pagination.total_items;
          }
          const initialFilter = defaultDecisionFilter(
            payload?.owner_decisions
          );
          if (initialFilter !== itemState.filter) {
            itemState.filter = initialFilter;
            itemState.page = 1;
            renderDecisionCounters(payload?.owner_decisions);
            syncFilterControls();
            return loadItems();
          }
        }
        renderItemsPayload(payload);
      } catch {
        if (sequence !== itemRequestSequence) return;
        setProductsPanelState(elements, 'error');
      }
    }

    function activateItems(itemsUrl) {
      resetItems();
      itemState.baseUrl = itemsUrl;
      setProductsPanelState(elements, 'loading');
      return loadItems();
    }

    function setFieldError(message) {
      elements.fileError.textContent = message || '';
      elements.fileError.hidden = !message;
    }

    function renderStatus(state, message) {
      const order = ['selected', 'uploading', 'processing', 'completed'];
      const currentIndex = order.indexOf(state);
      for (const step of elements.statusSteps) {
        const stepState = step.dataset.state;
        const stepIndex = order.indexOf(stepState);
        step.classList.toggle('is-current', stepState === state);
        step.classList.toggle(
          'is-complete',
          state !== 'failed' &&
            stepIndex >= 0 &&
            stepIndex < currentIndex
        );
        step.classList.toggle(
          'is-error',
          state === 'failed' && stepState === 'failed'
        );
      }

      const pillSettings = {
        selected: ['Файл выбран', 'success'],
        uploading: ['Загрузка', 'active'],
        processing: ['Расчёт', 'active'],
        completed: ['Готово', 'success'],
        failed: ['Ошибка', 'error'],
      };
      const settings = pillSettings[state] || ['Ожидание', ''];
      elements.statusPill.textContent = settings[0];
      elements.statusPill.dataset.tone = settings[1];
      elements.statusMessage.textContent = message;
    }

    function validateFile(file) {
      if (!file) return 'FILE_REQUIRED';
      if (!ALLOWED_FILE_PATTERN.test(file.name || '')) return 'INVALID_FILE';
      if (file.size > MAX_FILE_BYTES) return 'UPLOAD_TOO_LARGE';
      return null;
    }

    function updateFileSelection() {
      const file = elements.fileInput.files?.[0] || null;
      const code = validateFile(file);
      selectedFile = code ? null : file;
      resetExports();
      resetItems();
      elements.results.hidden = true;
      elements.selectedFile.hidden = !file;
      elements.selectedFileName.textContent = file?.name || '';
      elements.runButton.disabled = !selectedFile || active;
      setFieldError(code ? ERROR_MESSAGES[code] : '');
      if (selectedFile) {
        renderStatus(
          'selected',
          'Файл готов к загрузке. Запустите расчёт.'
        );
      } else if (file) {
        renderStatus('failed', ERROR_MESSAGES[code]);
      }
    }

    function renderSummary(summary, status) {
      const view = summaryView(summary, status);
      for (const [name, element] of Object.entries(elements.summary)) {
        element.textContent = view[name];
      }
      elements.calculationTime.textContent =
        `Время расчёта: ${view.calculationTime}`;
      elements.results.hidden = false;
    }

    function configureDownloads(manifest) {
      availableArtifacts = selectArtifacts(manifest);
      const buttons = documentObject.querySelectorAll(
        '[data-artifact-key]'
      );
      for (const button of buttons) {
        button.disabled = !availableArtifacts[button.dataset.artifactKey];
      }
      elements.exportButton.disabled =
        Object.keys(availableArtifacts).length === 0;
    }

    async function submitRun(event) {
      event.preventDefault();
      if (active) return;
      const code = validateFile(selectedFile);
      if (code) {
        setFieldError(ERROR_MESSAGES[code]);
        return;
      }

      active = true;
      elements.runButton.disabled = true;
      setFieldError('');
      elements.results.hidden = true;
      resetExports();
      resetItems();
      renderStatus('uploading', 'Отчёт загружается на локальный сервер.');
      const processingHint = setTimeout(() => {
        if (active) {
          renderStatus(
            'processing',
            'Агент анализирует данные и формирует рекомендации.'
          );
        }
      }, 250);

      try {
        const formData = new FormData();
        formData.append('file', selectedFile, selectedFile.name);
        let status = await requestJson(fetchFunction, '/api/v1/runs', {
          method: 'POST',
          body: formData,
        });
        clearTimeout(processingHint);

        if (status?.status !== 'completed') {
          const statusUrl = safeRunLink(status?.links?.self);
          if (!statusUrl) throw new FrontendError('RUN_FAILED');
          renderStatus(
            'processing',
            'Агент анализирует данные и формирует рекомендации.'
          );
          status = await pollRunStatus({
            fetchFunction,
            statusUrl,
            onStatus: current => {
              if (current?.status === 'processing') {
                renderStatus(
                  'processing',
                  'Расчёт выполняется. Не закрывайте эту страницу.'
                );
              }
            },
          });
        }

        const summaryUrl = safeRunLink(status?.links?.summary);
        const artifactsUrl = safeRunLink(status?.links?.artifacts);
        const itemsUrl = safeRunLink(status?.links?.items);
        if (!summaryUrl || !artifactsUrl || !itemsUrl) {
          throw new FrontendError('RUN_FAILED');
        }
        const [summary, manifest] = await Promise.all([
          requestJson(fetchFunction, summaryUrl),
          requestJson(fetchFunction, artifactsUrl),
        ]);
        renderSummary(summary, status);
        configureDownloads(manifest);
        renderStatus(
          'completed',
          'Расчёт завершён. Итоги и файлы готовы.'
        );
        await activateItems(itemsUrl);
      } catch (error) {
        clearTimeout(processingHint);
        const codeValue = error instanceof FrontendError
          ? error.code
          : 'RUN_FAILED';
        renderStatus(
          'failed',
          ERROR_MESSAGES[codeValue] || ERROR_MESSAGES.RUN_FAILED
        );
      } finally {
        active = false;
        elements.runButton.disabled = !selectedFile;
      }
    }

    function downloadArtifact(event) {
      const key = event.currentTarget.dataset.artifactKey;
      const artifact = availableArtifacts[key];
      if (!artifact) return;
      setExportOpen(false);
      const link = documentObject.createElement('a');
      link.href = artifact.downloadUrl;
      link.download = artifact.name;
      link.rel = 'noopener';
      documentObject.body.append(link);
      link.click();
      link.remove();
    }

    function selectFilter(event) {
      itemState.filter = event.currentTarget.dataset.filter;
      itemState.page = 1;
      syncFilterControls();
      loadItems();
    }

    function selectSort(event) {
      const sort = event.currentTarget.dataset.sort;
      if (!ITEM_SORTS.includes(sort)) return;
      if (itemState.sort === sort) {
        itemState.order = itemState.order === 'asc' ? 'desc' : 'asc';
      } else {
        itemState.sort = sort;
        itemState.order = sort === 'name' ? 'asc' : 'desc';
      }
      itemState.page = 1;
      syncSortControls();
      loadItems();
    }

    elements.fileInput.addEventListener('change', updateFileSelection);
    elements.form.addEventListener('submit', submitRun);
    elements.exportButton.addEventListener('click', () => {
      setExportOpen(elements.exportMenu.hidden);
    });
    documentObject.addEventListener('click', event => {
      if (
        !elements.exportMenu.hidden &&
        !event.target.closest('.export-control')
      ) {
        setExportOpen(false);
      }
    });
    documentObject.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        setExportOpen(false);
        elements.exportButton.focus();
      }
    });
    for (const button of documentObject.querySelectorAll(
      '[data-artifact-key]'
    )) {
      button.disabled = true;
      button.addEventListener('click', downloadArtifact);
    }
    elements.productsSearch.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        itemState.q = elements.productsSearch.value;
        itemState.page = 1;
        loadItems();
      }, 300);
    });
    for (const button of elements.productFilters) {
      button.addEventListener('click', selectFilter);
    }
    for (const button of elements.sortButtons) {
      button.addEventListener('click', selectSort);
    }
    elements.productsPageSize.addEventListener('change', () => {
      itemState.pageSize = Number(elements.productsPageSize.value);
      itemState.page = 1;
      loadItems();
    });
    elements.productsPrevious.addEventListener('click', () => {
      if (itemState.page <= 1) return;
      itemState.page -= 1;
      loadItems();
    });
    elements.productsNext.addEventListener('click', () => {
      if (
        itemState.totalPages === 0 ||
        itemState.page >= itemState.totalPages
      ) return;
      itemState.page += 1;
      loadItems();
    });
    resetExports();
    resetItems();
    return {
      activateItems,
      loadItems,
      submitRun,
      updateFileSelection,
    };
  }

  const publicApi = {
    FrontendError,
    buildDecisionUrl,
    buildItemsUrl,
    createItemRow,
    createItemRows,
    createApplication,
    decisionCounterView,
    defaultDecisionFilter,
    formatDuration,
    formatQuantity,
    formatRub,
    itemMatchesDecisionFilter,
    itemStatusView,
    matrixRoleLabel,
    needsOwnerDecisionView,
    ownerDecisionView,
    paginationLabel,
    plainReason,
    pollRunStatus,
    recommendedLineValue,
    recommendedQuantity,
    renderItemRows,
    requestNeedsDecisionItems,
    requestJson,
    safeArtifactDownloadUrl,
    safeRunLink,
    selectArtifacts,
    setProductsPanelState,
    summaryView,
    technicalExplanation,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }
  if (globalObject) globalObject.PurchasingFrontend = publicApi;
  if (globalObject?.document && globalObject?.fetch) {
    globalObject.document.addEventListener('DOMContentLoaded', () => {
      createApplication(
        globalObject.document,
        globalObject.fetch.bind(globalObject)
      );
    });
  }
})(typeof window === 'undefined' ? null : window);
