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
  const OWNER_DECISION_ANALYTICS_URL =
    '/api/v1/owner-learning/decision-history/analytics';
  const OWNER_LEARNING_CENTER_URL =
    '/api/v1/owner-learning/center';
  const OWNER_LEARNING_CANDIDATES_URL =
    '/api/v1/owner-learning/candidates';
  const OWNER_LEARNING_LIFECYCLE_URL =
    '/api/v1/owner-learning/candidate-lifecycle';
  const OWNER_RULE_MATERIALIZATION_BASE_URL =
    '/api/v1/owner-learning/candidates';
  const OWNER_MATERIALIZED_RULES_URL =
    '/api/v1/owner-learning/materialized-rules';
  const OWNER_RULE_EFFECTIVENESS_URL =
    '/api/v1/owner-learning/rule-effectiveness';
  const OWNER_KNOWLEDGE_HEALTH_URL =
    '/api/v1/owner-learning/knowledge-health';
  const RULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
  const DECISION_LABELS = Object.freeze({
    BUY: 'Купить',
    SKIP: 'Пропустить',
    DEFER: 'Отложить',
    REVIEW: 'Проверить',
  });
  const REASON_LABELS = Object.freeze({
    TOO_MUCH_STOCK: 'Слишком большой остаток',
    LOW_SALES: 'Низкие продажи',
    STRATEGIC_ITEM: 'Стратегический товар',
    REQUIRED_ASSORTMENT: 'Обязательный ассортимент',
    SEASONAL: 'Сезонность',
    SUPPLIER_CONSTRAINT: 'Ограничение поставщика',
    PRICE_TOO_HIGH: 'Высокая цена',
    OWNER_EXPERIENCE: 'Опыт владельца',
    OTHER: 'Другое',
    NOT_SPECIFIED: 'Причина не указана',
  });
  const PATTERN_LABELS = Object.freeze({
    SAME_ITEM_SAME_DECISION:
      'Повторяется одно решение по товару',
    SAME_ITEM_SAME_REASON:
      'Повторяется одна причина по товару',
    BRAND_DECISION_BIAS:
      'Устойчивый паттерн по бренду',
    SUPPLIER_DECISION_BIAS:
      'Устойчивый паттерн по поставщику',
    AGENT_DISAGREEMENT_REPEAT:
      'Повторные расхождения с агентом',
  });
  const ELIGIBILITY_LABELS = Object.freeze({
    ELIGIBLE: 'Можно рассмотреть',
    REVIEW_ONLY: 'Только ручной анализ',
    INELIGIBLE: 'Недостаточно безопасно',
  });
  const CONFIDENCE_LABELS = Object.freeze({
    LOW: 'Низкая',
    MEDIUM: 'Средняя',
    HIGH: 'Высокая',
    VERY_HIGH: 'Очень высокая',
  });
  const PRIORITY_LABELS = Object.freeze({
    LOW: 'Низкий',
    MEDIUM: 'Средний',
    HIGH: 'Высокий',
    CRITICAL: 'Критический для проверки',
  });
  const CENTER_PRIORITY_LABELS = Object.freeze({
    LOW: 'Низкий',
    MEDIUM: 'Средний',
    HIGH: 'Высокий',
    CRITICAL: 'Критический',
  });
  const CENTER_HEALTH_LABELS = Object.freeze({
    HEALTHY: 'Всё работает',
    DEGRADED: 'Часть данных временно недоступна',
    UNAVAILABLE: 'Центр временно недоступен',
  });
  const CENTER_COMPONENT_LABELS = Object.freeze({
    decision_history: 'История решений',
    candidates: 'Кандидаты',
    candidate_lifecycle: 'Lifecycle кандидатов',
    materializations: 'История материализации',
    approved_rules_registry: 'Реестр правил',
    rule_status_events: 'История статусов правил',
    rule_activation_previews: 'Проверки активации',
    rule_effectiveness: 'Эффективность правил',
    knowledge_health: 'Здоровье базы знаний',
  });
  const CENTER_COMPONENT_STATUS_LABELS = Object.freeze({
    AVAILABLE: 'Доступно',
    EMPTY: 'Пока пусто',
    UNAVAILABLE: 'Недоступно',
  });
  const CENTER_ACTIVITY_LABELS = Object.freeze({
    CANDIDATE_STATUS_CHANGED: 'Статус кандидата изменён',
    RULE_MATERIALIZED: 'Правило материализовано',
    RULE_ACTIVATED: 'Правило активировано',
    RULE_DEACTIVATED: 'Правило отключено',
    RULE_APPLIED_EFFECT: 'Правило изменило заказ',
    RULE_FALLBACK_RECORDED: 'Зафиксирован fallback',
  });
  const RULE_EFFECTIVENESS_CLASSIFICATION_LABELS = Object.freeze({
    EFFECTIVE: 'Работает стабильно',
    OCCASIONAL: 'Срабатывает периодически',
    NO_EFFECT_YET: 'Пока без эффекта',
    STALE: 'Давно не срабатывало',
    REVIEW_RECOMMENDED: 'Требует ручной проверки',
    INSUFFICIENT_DATA: 'Недостаточно данных',
  });
  const RULE_EFFECT_STATUS_LABELS = Object.freeze({
    APPLIED_EFFECT: 'Изменило заказ',
    MATCHED_NO_CHANGE: 'Совпало без изменения',
    NO_MATCH: 'Нет подходящей строки',
    FALLBACK_TO_BASELINE: 'Возврат к baseline',
    NOT_ACTIVE: 'Неактивно',
    UNAVAILABLE: 'Недоступно',
  });
  const KNOWLEDGE_HEALTH_GRADE_LABELS = Object.freeze({
    EXCELLENT: 'Отлично',
    GOOD: 'Хорошо',
    FAIR: 'Удовлетворительно',
    POOR: 'Плохо',
    CRITICAL: 'Критично',
  });
  const KNOWLEDGE_HEALTH_CLASSIFICATION_LABELS = Object.freeze({
    HEALTHY: 'В норме',
    MONITOR: 'Наблюдать',
    REVIEW: 'Проверить',
    CRITICAL: 'Критично',
    INSUFFICIENT_DATA: 'Недостаточно данных',
  });
  const KNOWLEDGE_HEALTH_SEVERITY_LABELS = Object.freeze({
    INFO: 'Информация',
    LOW: 'Низкая',
    MEDIUM: 'Средняя',
    HIGH: 'Высокая',
    CRITICAL: 'Критическая',
  });
  const KNOWLEDGE_HEALTH_FINDING_LABELS = Object.freeze({
    RULE_CONFLICT: 'Конфликт активных правил',
    RULE_DUPLICATE: 'Дублирующиеся правила',
    RULE_STALE: 'Правило давно не срабатывало',
    RULE_NO_EFFECT: 'Правило пока не даёт эффекта',
    RULE_REVIEW_RECOMMENDED: 'Рекомендуется ручная проверка',
    RULE_LOW_CONFIDENCE: 'Низкая уверенность',
    RULE_LOW_PRIORITY: 'Низкий приоритет',
    RULE_MISSING_PROVENANCE: 'Не указан источник правила',
    RULE_MATERIALIZATION_MISSING: 'Нет записи о материализации',
    RULE_LIFECYCLE_INCONSISTENT: 'Lifecycle не согласован',
    RULE_STATUS_HISTORY_INCONSISTENT: 'История статуса не согласована',
    RULE_EFFECTIVENESS_UNAVAILABLE: 'Эффективность недоступна',
    RULE_SCOPE_TOO_BROAD: 'Область действия слишком широка',
    RULE_UNSUPPORTED_TYPE: 'Тип правила не поддерживается',
    RULE_DATA_QUALITY_ISSUE: 'Проблема качества данных',
    ACTIVE_RULE_WITHOUT_EFFECT_DATA:
      'У активного правила нет данных об эффекте',
    DISABLED_RULE_WITH_EFFECT_EVENTS:
      'У неактивного правила есть события эффекта',
    ACTIVE_RULE_NEVER_APPLIED:
      'Активное правило ни разу не применялось',
    RULE_LAST_UPDATED_TOO_OLD: 'Правило давно не обновлялось',
  });
  const KNOWLEDGE_HEALTH_ACTION_LABELS = Object.freeze({
    REVIEW_RULE: 'Проверить правило',
    REVIEW_CONFLICT: 'Сопоставить конфликтующие правила',
    REVIEW_DUPLICATE: 'Проверить дубликаты',
    REVIEW_EFFECTIVENESS: 'Проверить эффективность',
    REVIEW_PROVENANCE: 'Проверить источник',
    COLLECT_MORE_DATA: 'Накопить больше данных',
    NO_ACTION_REQUIRED: 'Действие не требуется',
  });
  const RULE_EFFECTIVENESS_CODE_LABELS = Object.freeze({
    RULE_CHANGED_ORDER: 'Правило изменяло рассчитанный заказ',
    RULE_MATCHED_WITHOUT_CHANGE:
      'Правило совпадало со строкой без изменения результата',
    RULE_DID_NOT_MATCH:
      'В отдельных запусках подходящая строка не найдена',
    RULE_EFFECT_RATE_HIGH: 'Высокая доля запусков с эффектом',
    RULE_EFFECT_RATE_LOW: 'Низкая доля запусков с эффектом',
    RULE_HAS_NO_EFFECT_YET: 'Фактический эффект пока не зафиксирован',
    RULE_LAST_EFFECT_RECENT: 'Последний эффект был недавно',
    RULE_LAST_EFFECT_STALE: 'Последний эффект был давно',
    RULE_FALLBACK_OCCURRED:
      'Зафиксирован безопасный возврат к baseline',
    RULE_HAS_CONSECUTIVE_NO_EFFECT:
      'Есть последовательные запуски без эффекта',
    RULE_DATA_QUALITY_ISSUES:
      'В журнале есть неполные или некорректные данные',
    RULE_EFFECTIVENESS_INSUFFICIENT_DATA:
      'Для устойчивой оценки недостаточно запусков',
    RULE_REQUIRES_MANUAL_REVIEW:
      'Рекомендуется ручная проверка владельцем',
    EFFECTIVENESS_IS_OBSERVATIONAL_ONLY:
      'Классификация является только наблюдением',
  });
  const OWNER_ACTION_LABELS = Object.freeze({
    REVIEW_AND_APPROVE:
      'Рассмотреть и при необходимости одобрить позже',
    REVIEW_ONLY: 'Провести ручной анализ',
    COLLECT_MORE_HISTORY: 'Накопить больше истории',
    DO_NOT_CREATE_RULE: 'Не создавать правило',
  });
  const LIFECYCLE_STATUS_LABELS = Object.freeze({
    NEW: 'Новый',
    UNDER_REVIEW: 'На проверке',
    APPROVED: 'Одобрен для будущего правила',
    REJECTED: 'Отклонён',
    POSTPONED: 'Отложен',
  });
  const LIFECYCLE_ACTIONS = Object.freeze({
    NEW: Object.freeze([
      Object.freeze({
        label: 'Начать проверку',
        targetStatus: 'UNDER_REVIEW',
        action: 'START_REVIEW',
      }),
      Object.freeze({
        label: 'Одобрить для создания правила',
        targetStatus: 'APPROVED',
        action: 'APPROVE',
      }),
      Object.freeze({
        label: 'Отклонить',
        targetStatus: 'REJECTED',
        action: 'REJECT',
      }),
      Object.freeze({
        label: 'Отложить',
        targetStatus: 'POSTPONED',
        action: 'POSTPONE',
      }),
    ]),
    UNDER_REVIEW: Object.freeze([
      Object.freeze({
        label: 'Одобрить для создания правила',
        targetStatus: 'APPROVED',
        action: 'APPROVE',
      }),
      Object.freeze({
        label: 'Отклонить',
        targetStatus: 'REJECTED',
        action: 'REJECT',
      }),
      Object.freeze({
        label: 'Отложить',
        targetStatus: 'POSTPONED',
        action: 'POSTPONE',
      }),
    ]),
    POSTPONED: Object.freeze([
      Object.freeze({
        label: 'Вернуть на проверку',
        targetStatus: 'UNDER_REVIEW',
        action: 'REOPEN',
      }),
      Object.freeze({
        label: 'Одобрить для создания правила',
        targetStatus: 'APPROVED',
        action: 'APPROVE',
      }),
      Object.freeze({
        label: 'Отклонить',
        targetStatus: 'REJECTED',
        action: 'REJECT',
      }),
    ]),
    REJECTED: Object.freeze([
      Object.freeze({
        label: 'Вернуть на проверку',
        targetStatus: 'UNDER_REVIEW',
        action: 'REOPEN',
      }),
    ]),
    APPROVED: Object.freeze([
      Object.freeze({
        label: 'Вернуть на проверку',
        targetStatus: 'UNDER_REVIEW',
        action: 'REOPEN',
      }),
    ]),
  });

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
    OWNER_DECISION_ANALYTICS_INVALID_INPUT:
      'Проверьте выбранные фильтры и повторите запрос.',
    OWNER_LEARNING_CANDIDATES_INVALID_INPUT:
      'Проверьте выбранные фильтры и повторите запрос.',
    OWNER_LEARNING_LIFECYCLE_INVALID_INPUT:
      'Проверьте причину и комментарий, затем повторите.',
    OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID:
      'Статус кандидата уже изменился. Обновите список и повторите.',
    CANDIDATE_NOT_AVAILABLE:
      'Кандидат больше не доступен в текущей истории.',
    OWNER_LEARNING_LIFECYCLE_UNAVAILABLE:
      'Статусы кандидатов временно недоступны.',
    OWNER_LEARNING_LIFECYCLE_REASON_REQUIRED:
      'Выберите причину отклонения или переноса.',
    OWNER_LEARNING_LIFECYCLE_CONFIRMATION_REQUIRED:
      'Подтвердите, что правило ещё не создаётся и не применяется.',
    OWNER_RULE_MATERIALIZATION_CONFIRMATION_REQUIRED:
      'Подтвердите создание неактивного правила.',
    OWNER_RULE_MATERIALIZATION_INVALID_INPUT:
      'Запрос создания правила некорректен.',
    OWNER_MATERIALIZED_RULES_INVALID_INPUT:
      'Проверьте выбранные фильтры и повторите запрос.',
    OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT:
      'Проверьте выбранные фильтры и повторите запрос.',
    CANDIDATE_NOT_APPROVED:
      'Кандидат больше не находится в статусе «Одобрен».',
    CANDIDATE_NOT_ELIGIBLE:
      'Кандидат больше не соответствует безопасным требованиям.',
    CANDIDATE_TYPE_NOT_MATERIALIZABLE:
      'Для этого типа кандидата создание правила недоступно.',
    RULE_REGISTRY_UNAVAILABLE:
      'Реестр правил временно недоступен.',
    RULE_MATERIALIZATION_STORAGE_UNAVAILABLE:
      'Состояние создания правил временно недоступно.',
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

  function formatPercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(value);
  }

  function formatHistoryDate(value) {
    if (typeof value !== 'string') return '—';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(timestamp));
  }

  function decisionLabel(value) {
    return DECISION_LABELS[value] || '—';
  }

  function reasonLabel(value) {
    return REASON_LABELS[value] || value || '—';
  }

  function patternLabel(value) {
    return PATTERN_LABELS[value] || '—';
  }

  function dominantValueLabel(value) {
    if (typeof value !== 'string') return '—';
    if (value.includes('->')) {
      const [from, to] = value.split('->');
      return `${decisionLabel(from)} → ${decisionLabel(to)}`;
    }
    return DECISION_LABELS[value] || REASON_LABELS[value] || value;
  }

  function buildAnalyticsUrl(filters = {}) {
    const parameters = new URLSearchParams();
    for (const name of [
      'supplier',
      'brand',
      'ownerDecision',
      'reasonCode',
      'dateFrom',
      'dateTo',
    ]) {
      const value = typeof filters[name] === 'string'
        ? filters[name].trim()
        : '';
      if (value) parameters.set(name, value);
    }
    parameters.set('maxItems', '100');
    return `${OWNER_DECISION_ANALYTICS_URL}?${parameters.toString()}`;
  }

  function analyticsViewState(result) {
    if (result?.status === 'UNAVAILABLE') return 'unavailable';
    if (result?.status !== 'AVAILABLE' || !result.data) return 'invalid';
    if (result.data.population?.totalEntries === 0) return 'empty';
    if (result.data.population?.filteredEntries === 0) {
      return 'no-results';
    }
    return 'ready';
  }

  function setHistoryPanelState(elements, state) {
    elements.historyLoading.hidden = state !== 'loading';
    elements.historyEmpty.hidden = state !== 'empty';
    elements.historyNoResults.hidden = state !== 'no-results';
    elements.historyUnavailable.hidden = state !== 'unavailable';
    elements.historyInvalid.hidden = state !== 'invalid';
    elements.historyContent.hidden = state !== 'ready';
  }

  function appendHistoryCell(documentObject, row, value) {
    const cell = documentObject.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }

  function patternScopeLabel(pattern, itemsByKey) {
    if (pattern?.scopeType === 'ITEM') {
      const item = itemsByKey.get(pattern.scopeKey);
      return item?.productName || item?.sku || 'Товар без названия';
    }
    return typeof pattern?.scopeKey === 'string'
      ? pattern.scopeKey
      : '—';
  }

  function renderAnalytics(
    documentObject,
    elements,
    analytics
  ) {
    const population = analytics?.population || {};
    const agreement = analytics?.agreementAnalysis || {};
    const summaryValues = {
      total: population.filteredEntries,
      items: population.uniqueItems,
      brands: population.uniqueBrands,
      suppliers: population.uniqueSuppliers,
      agreements: agreement.agreements,
      disagreements: agreement.disagreements,
    };
    for (const [name, value] of Object.entries(summaryValues)) {
      elements.historySummary[name].textContent = displayCount(value);
    }
    elements.historySummary.agreementRate.textContent =
      formatPercent(agreement.agreementRate);

    elements.historyDecisionDistribution.replaceChildren();
    for (const decision of ['BUY', 'SKIP', 'DEFER', 'REVIEW']) {
      const row = documentObject.createElement('div');
      const term = documentObject.createElement('dt');
      const count = documentObject.createElement('dd');
      term.textContent = decisionLabel(decision);
      count.textContent = displayCount(
        analytics?.ownerDecisionDistribution?.[decision]
      );
      row.append(term, count);
      elements.historyDecisionDistribution.append(row);
    }

    elements.historyReasons.replaceChildren();
    for (const reason of analytics?.reasonDistribution || []) {
      const row = documentObject.createElement('tr');
      appendHistoryCell(
        documentObject,
        row,
        reasonLabel(reason.reasonCode)
      );
      appendHistoryCell(
        documentObject,
        row,
        displayCount(reason.count)
      );
      appendHistoryCell(
        documentObject,
        row,
        formatPercent(reason.share)
      );
      elements.historyReasons.append(row);
    }

    const items = Array.isArray(analytics?.itemAnalytics)
      ? analytics.itemAnalytics
      : [];
    const itemsByKey = new Map(
      items.map(item => [item.stableItemKey, item])
    );
    elements.historyPatterns.replaceChildren();
    for (const pattern of analytics?.repeatedDecisionPatterns || []) {
      const row = documentObject.createElement('tr');
      const period = pattern.firstRecordedAt || pattern.lastRecordedAt
        ? `${formatHistoryDate(pattern.firstRecordedAt)} — ` +
          formatHistoryDate(pattern.lastRecordedAt)
        : '—';
      for (const value of [
        patternLabel(pattern.patternType),
        patternScopeLabel(pattern, itemsByKey),
        displayCount(pattern.occurrences),
        dominantValueLabel(pattern.dominantValue),
        formatPercent(pattern.share),
        period,
      ]) {
        appendHistoryCell(documentObject, row, value);
      }
      elements.historyPatterns.append(row);
    }

    elements.historyItems.replaceChildren();
    for (const item of items) {
      const row = documentObject.createElement('tr');
      for (const value of [
        item.productName || '—',
        item.sku || '—',
        item.brand || '—',
        item.supplier || '—',
        displayCount(item.totalEntries),
        decisionLabel(item.dominantOwnerDecision),
        displayCount(item.agreements),
        displayCount(item.disagreements),
        formatPercent(item.agreementRate),
        formatQuantity(item.averageOwnerQuantity),
        formatQuantity(item.ownerQuantityDeltaAverage),
        formatHistoryDate(item.lastRecordedAt),
      ]) {
        appendHistoryCell(documentObject, row, value);
      }
      elements.historyItems.append(row);
    }
  }

  function eligibilityLabel(value) {
    return ELIGIBILITY_LABELS[value] || '—';
  }

  function confidenceLabel(value) {
    return CONFIDENCE_LABELS[value] || '—';
  }

  function priorityLabel(value) {
    return PRIORITY_LABELS[value] || '—';
  }

  function ownerActionLabel(value) {
    return OWNER_ACTION_LABELS[value] || '—';
  }

  function formatSignedQuantity(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const formatted = formatQuantity(Math.abs(value));
    if (value > 0) return `+${formatted}`;
    if (value < 0) return `−${formatted}`;
    return formatted;
  }

  function buildCandidatesUrl(filters = {}) {
    const parameters = new URLSearchParams();
    for (const name of [
      'supplier',
      'brand',
      'ownerDecision',
      'reasonCode',
      'dateFrom',
      'dateTo',
    ]) {
      const value = typeof filters[name] === 'string'
        ? filters[name].trim()
        : '';
      if (value) parameters.set(name, value);
    }
    parameters.set('maxItems', '100');
    parameters.set('includeLowConfidence', 'true');
    parameters.set('includeIneligible', 'true');
    parameters.set('limit', '100');
    return `${OWNER_LEARNING_CANDIDATES_URL}?${parameters.toString()}`;
  }

  function lifecycleStatusLabel(status) {
    return LIFECYCLE_STATUS_LABELS[status] ||
      LIFECYCLE_STATUS_LABELS.NEW;
  }

  function lifecycleErrorMessage(code) {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES.NETWORK_ERROR;
  }

  function candidateLifecycleActions(status) {
    return LIFECYCLE_ACTIONS[status] || LIFECYCLE_ACTIONS.NEW;
  }

  function buildLifecycleStatusUrl(candidateId) {
    if (
      typeof candidateId !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(candidateId)
    ) {
      throw new FrontendError(
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'
      );
    }
    return `${OWNER_LEARNING_LIFECYCLE_URL}/${candidateId}/status`;
  }

  function buildLifecyclePayload(action, input = {}) {
    const reasonCode = typeof input.reasonCode === 'string' &&
        input.reasonCode
      ? input.reasonCode
      : 'NOT_SPECIFIED';
    if (
      ['REJECTED', 'POSTPONED'].includes(action?.targetStatus) &&
      reasonCode === 'NOT_SPECIFIED'
    ) {
      throw new FrontendError(
        'OWNER_LEARNING_LIFECYCLE_REASON_REQUIRED'
      );
    }
    if (
      action?.targetStatus === 'APPROVED' &&
      input.approvedConfirmed !== true
    ) {
      throw new FrontendError(
        'OWNER_LEARNING_LIFECYCLE_CONFIRMATION_REQUIRED'
      );
    }
    const ownerComment = typeof input.ownerComment === 'string'
      ? input.ownerComment.trim()
      : '';
    if (ownerComment.length > 1000) {
      throw new FrontendError(
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT'
      );
    }
    return {
      targetStatus: action?.targetStatus,
      action: action?.action,
      reasonCode,
      ownerComment: ownerComment || null,
    };
  }

  function shouldShowMaterialize(candidate = {}) {
    return candidate.lifecycle?.status === 'APPROVED' &&
      candidate.materialization?.status === 'NOT_MATERIALIZED' &&
      candidate.eligibility?.status === 'ELIGIBLE' &&
      candidate.patternType === 'SAME_ITEM_SAME_DECISION' &&
      candidate.proposedRuleType === 'ITEM_DECISION_OVERRIDE' &&
      candidate.scopeType === 'ITEM';
  }

  function buildMaterializationUrl(candidateId) {
    if (
      typeof candidateId !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(candidateId)
    ) {
      throw new FrontendError(
        'OWNER_RULE_MATERIALIZATION_INVALID_INPUT'
      );
    }
    return `${OWNER_RULE_MATERIALIZATION_BASE_URL}/${
      candidateId
    }/materialize-rule`;
  }

  function buildMaterializationPayload(confirmed) {
    if (confirmed !== true) {
      throw new FrontendError(
        'OWNER_RULE_MATERIALIZATION_CONFIRMATION_REQUIRED'
      );
    }
    return { confirmation: true };
  }

  function candidateViewState(result) {
    if (result?.status === 'UNAVAILABLE') return 'unavailable';
    if (
      result?.status !== 'AVAILABLE' ||
      !result.summary ||
      !Array.isArray(result.candidates)
    ) {
      return 'invalid';
    }
    if (result.summary.historyEntries === 0) return 'empty';
    if (
      result.summary.patternsFound === 0 ||
      result.summary.totalCandidates === 0
    ) {
      return 'no-patterns';
    }
    return 'ready';
  }

  function setCandidatePanelState(elements, state) {
    elements.candidateLoading.hidden = state !== 'loading';
    elements.candidateEmpty.hidden = state !== 'empty';
    elements.candidateNoPatterns.hidden = state !== 'no-patterns';
    elements.candidateNoResults.hidden = state !== 'no-results';
    elements.candidateUnavailable.hidden = state !== 'unavailable';
    elements.candidateInvalid.hidden = state !== 'invalid';
    elements.candidateContent.hidden = state !== 'ready';
  }

  function filterCandidates(candidates, filters = {}) {
    return (Array.isArray(candidates) ? candidates : []).filter(
      candidate =>
        (
          !filters.eligibility ||
          candidate?.eligibility?.status === filters.eligibility
        ) &&
        (
          !filters.confidence ||
          candidate?.confidence?.level === filters.confidence
        ) &&
        (
          !filters.priority ||
          candidate?.ranking?.priorityLevel === filters.priority
        )
    );
  }

  function resetCandidateFilters(elements) {
    for (const element of [
      elements.candidateSupplier,
      elements.candidateBrand,
      elements.candidateDecision,
      elements.candidateReason,
      elements.candidateDateFrom,
      elements.candidateDateTo,
      elements.candidateEligibility,
      elements.candidateConfidence,
      elements.candidatePriority,
    ]) {
      element.value = '';
    }
  }

  function appendCandidateFact(
    documentObject,
    list,
    label,
    value
  ) {
    const group = documentObject.createElement('div');
    const term = documentObject.createElement('dt');
    const description = documentObject.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    group.append(term, description);
    list.append(group);
  }

  function appendCandidateList(
    documentObject,
    parent,
    titleText,
    values
  ) {
    const section = documentObject.createElement('section');
    const title = documentObject.createElement('h5');
    const list = documentObject.createElement('ul');
    title.textContent = titleText;
    const safeValues = Array.isArray(values) && values.length > 0
      ? values
      : ['—'];
    for (const value of safeValues) {
      const item = documentObject.createElement('li');
      item.textContent = typeof value === 'string' ? value : '—';
      list.append(item);
    }
    section.append(title, list);
    parent.append(section);
  }

  function createCandidateCard(
    documentObject,
    candidate = {},
    onLifecycleAction = null,
    onMaterialize = null
  ) {
    const card = documentObject.createElement('article');
    card.className = 'candidate-card';

    const heading = documentObject.createElement('header');
    const rank = documentObject.createElement('span');
    const scope = documentObject.createElement('div');
    const name = documentObject.createElement('h3');
    const secondary = documentObject.createElement('p');
    rank.className = 'candidate-rank';
    rank.textContent = Number.isInteger(candidate.ranking?.rank)
      ? `#${candidate.ranking.rank}`
      : '—';
    name.textContent = candidate.displayScope?.primary || '—';
    secondary.textContent = candidate.displayScope?.secondary || '—';
    scope.append(name, secondary);
    heading.append(rank, scope);

    const badges = documentObject.createElement('div');
    badges.className = 'candidate-badges';
    for (const [value, className] of [
      [
        eligibilityLabel(candidate.eligibility?.status),
        `eligibility-${String(
          candidate.eligibility?.status || ''
        ).toLowerCase()}`,
      ],
      [
        `Confidence: ${formatQuantity(candidate.confidence?.score)} · ` +
          confidenceLabel(candidate.confidence?.level),
        'candidate-confidence',
      ],
      [
        `Приоритет: ${
          formatQuantity(candidate.ranking?.priorityScore)
        } · ${priorityLabel(candidate.ranking?.priorityLevel)}`,
        'candidate-priority',
      ],
    ]) {
      const badge = documentObject.createElement('span');
      badge.className = `candidate-badge ${className}`;
      badge.textContent = value;
      badges.append(badge);
    }

    const pattern = documentObject.createElement('p');
    pattern.className = 'candidate-pattern';
    pattern.textContent = patternLabel(candidate.patternType);

    const facts = documentObject.createElement('dl');
    facts.className = 'candidate-facts';
    const period = candidate.evidence?.firstRecordedAt ||
        candidate.evidence?.lastRecordedAt
      ? `${formatHistoryDate(candidate.evidence?.firstRecordedAt)} — ` +
        formatHistoryDate(candidate.evidence?.lastRecordedAt)
      : '—';
    for (const [label, value] of [
      ['Решение', decisionLabel(candidate.proposedAction?.decision)],
      ['Повторений', displayCount(candidate.evidence?.occurrences)],
      ['Dominant share', formatPercent(candidate.evidence?.dominantShare)],
      ['Период наблюдения', period],
      [
        'Затронуто товаров',
        displayCount(candidate.impact?.estimatedAffectedItems),
      ],
      [
        'Историческая разница количества',
        formatSignedQuantity(
          candidate.impact?.estimatedHistoricalQuantityDelta
        ),
      ],
    ]) {
      appendCandidateFact(documentObject, facts, label, value);
    }

    const explanation = documentObject.createElement('section');
    explanation.className = 'candidate-explanation';
    const headline = documentObject.createElement('h4');
    const summary = documentObject.createElement('p');
    headline.textContent = candidate.explanation?.headline || '—';
    summary.textContent = candidate.explanation?.summary || '—';
    explanation.append(headline, summary);

    const details = documentObject.createElement('details');
    const detailsSummary = documentObject.createElement('summary');
    const detailGrid = documentObject.createElement('div');
    detailsSummary.textContent = 'Раскрыть подробности';
    detailGrid.className = 'candidate-detail-grid';
    appendCandidateList(
      documentObject,
      detailGrid,
      'Сильные стороны',
      candidate.explanation?.strengths
    );
    appendCandidateList(
      documentObject,
      detailGrid,
      'Риски',
      candidate.explanation?.risks
    );
    details.append(detailsSummary, detailGrid);

    const recommended = documentObject.createElement('p');
    recommended.className = 'candidate-recommended-action';
    recommended.textContent = 'Рекомендуемое действие: ' +
      ownerActionLabel(
        candidate.explanation?.recommendedOwnerAction
      );

    const lifecycle = documentObject.createElement('section');
    lifecycle.className = 'candidate-lifecycle';
    const lifecycleHeading = documentObject.createElement('h4');
    const lifecycleStatus = documentObject.createElement('p');
    lifecycleHeading.textContent = 'Решение владельца';
    lifecycleStatus.className = 'candidate-lifecycle-status';
    lifecycleStatus.textContent = 'Статус: ' + lifecycleStatusLabel(
      candidate.lifecycle?.status || 'NEW'
    );
    const actionContainer = documentObject.createElement('div');
    actionContainer.className = 'candidate-lifecycle-actions';
    const actions = candidateLifecycleActions(
      candidate.lifecycle?.status || 'NEW'
    );
    for (const action of actions) {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = action.action === 'APPROVE'
        ? 'primary-button'
        : 'secondary-button';
      button.textContent = action.label;
      button.dataset.targetStatus = action.targetStatus;
      button.dataset.action = action.action;
      if (typeof onLifecycleAction === 'function') {
        button.addEventListener('click', () =>
          onLifecycleAction(candidate, action)
        );
      }
      actionContainer.append(button);
    }
    lifecycle.append(
      lifecycleHeading,
      lifecycleStatus,
      actionContainer
    );
    if (actions.some(action => action.action === 'APPROVE')) {
      const warning = documentObject.createElement('p');
      warning.className = 'candidate-approval-warning';
      warning.textContent =
        'Одобрение кандидата пока не создаёт и не применяет правило.';
      lifecycle.append(warning);
    }

    const materialization = documentObject.createElement('section');
    materialization.className = 'candidate-materialization';
    const materializationHeading = documentObject.createElement('h4');
    materializationHeading.textContent = 'Неактивное правило';
    materialization.append(materializationHeading);
    if (candidate.materialization?.status === 'MATERIALIZED') {
      const status = documentObject.createElement('p');
      const decision = documentObject.createElement('p');
      const date = documentObject.createElement('p');
      const safety = documentObject.createElement('p');
      status.className = 'candidate-materialization-status';
      status.textContent = 'Неактивное правило создано';
      decision.textContent = 'Решение: ' +
        decisionLabel(candidate.proposedAction?.decision);
      date.textContent = 'Дата: ' +
        formatHistoryDate(candidate.materialization.materializedAt);
      safety.className = 'candidate-approval-warning';
      safety.textContent = 'Правило пока не влияет на закупку.';
      materialization.append(status, decision, date, safety);
    } else if (
      candidate.materialization?.status === 'UNAVAILABLE'
    ) {
      const unavailable = documentObject.createElement('p');
      unavailable.textContent =
        'Состояние создания правил временно недоступно.';
      materialization.append(unavailable);
    } else if (shouldShowMaterialize(candidate)) {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'primary-button';
      button.textContent = 'Создать неактивное правило';
      if (typeof onMaterialize === 'function') {
        button.addEventListener('click', () =>
          onMaterialize(candidate)
        );
      }
      materialization.append(button);
    } else {
      const unavailable = documentObject.createElement('p');
      unavailable.textContent =
        'Создание правила недоступно для текущего состояния.';
      materialization.append(unavailable);
    }

    card.append(
      heading,
      badges,
      pattern,
      facts,
      explanation,
      details,
      recommended,
      lifecycle,
      materialization
    );
    return card;
  }

  function renderCandidateCards(
    documentObject,
    parent,
    candidates,
    onLifecycleAction = null,
    onMaterialize = null
  ) {
    parent.replaceChildren();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      parent.append(createCandidateCard(
        documentObject,
        candidate,
        onLifecycleAction,
        onMaterialize
      ));
    }
  }

  function renderCandidateSummary(elements, summary = {}) {
    const values = {
      total: summary.totalCandidates,
      eligible: summary.eligible,
      reviewOnly: summary.reviewOnly,
      ineligible: summary.ineligible,
      highPriority: summary.highPriority,
      criticalPriority: summary.criticalPriority,
    };
    for (const [name, value] of Object.entries(values)) {
      elements.candidateSummary[name].textContent = displayCount(value);
    }
  }

  function buildMaterializedRulesUrl(filters = {}) {
    const parameters = new URLSearchParams();
    for (const name of [
      'status',
      'decision',
      'confidenceLevel',
      'priorityLevel',
      'lifecycleStatus',
      'candidateAvailability',
      'dateFrom',
      'dateTo',
      'search',
    ]) {
      const value = typeof filters[name] === 'string'
        ? filters[name].trim()
        : '';
      if (value) parameters.set(name, value);
    }
    parameters.set('sortBy', 'materializedAt');
    parameters.set('sortDirection', 'desc');
    parameters.set('limit', '100');
    return `${OWNER_MATERIALIZED_RULES_URL}?${parameters.toString()}`;
  }

  function hasMaterializedRuleFilters(filters = {}) {
    return [
      'status',
      'decision',
      'confidenceLevel',
      'priorityLevel',
      'lifecycleStatus',
      'candidateAvailability',
      'dateFrom',
      'dateTo',
      'search',
    ].some(name =>
      typeof filters[name] === 'string' &&
      filters[name].trim() !== ''
    );
  }

  function materializedRulesViewState(result, filters = {}) {
    if (result?.status === 'UNAVAILABLE') return 'unavailable';
    if (
      result?.status !== 'AVAILABLE' ||
      !result.summary ||
      !Array.isArray(result.rules)
    ) {
      return 'invalid';
    }
    if (result.rules.length === 0) {
      return hasMaterializedRuleFilters(filters)
        ? 'no-results'
        : 'empty';
    }
    return 'ready';
  }

  function setMaterializedRulesPanelState(elements, state) {
    elements.materializedRulesLoading.hidden = state !== 'loading';
    elements.materializedRulesEmpty.hidden = state !== 'empty';
    elements.materializedRulesNoResults.hidden =
      state !== 'no-results';
    elements.materializedRulesUnavailable.hidden =
      state !== 'unavailable';
    elements.materializedRulesInvalid.hidden = state !== 'invalid';
    elements.materializedRulesNetwork.hidden = state !== 'network';
    elements.materializedRulesContent.hidden = state !== 'ready';
  }

  function resetMaterializedRulesFilters(elements) {
    for (const element of [
      elements.materializedRulesStatus,
      elements.materializedRulesDecision,
      elements.materializedRulesConfidence,
      elements.materializedRulesPriority,
      elements.materializedRulesLifecycle,
      elements.materializedRulesAvailability,
      elements.materializedRulesDateFrom,
      elements.materializedRulesDateTo,
      elements.materializedRulesSearch,
    ]) {
      element.value = '';
    }
  }

  function materializedRuleStatusLabel(status) {
    return status === 'ACTIVE' ? 'Активно' :
      status === 'DISABLED' ? 'Неактивно' : '—';
  }

  function materializedRuleSafetyLabel(rule = {}) {
    return rule.safety?.affectsPurchasing === true
      ? 'Может влиять на закупку'
      : 'Не влияет на закупку';
  }

  function materializedRuleStatusPreviewLabel(rule = {}) {
    return rule.status === 'ACTIVE'
      ? 'Проверить последствия отключения'
      : 'Проверить последствия активации';
  }

  function buildRuleStatusPreviewUrl(ruleId) {
    if (!RULE_ID_PATTERN.test(String(ruleId || ''))) {
      throw new FrontendError('OWNER_RULE_STATUS_INVALID_INPUT');
    }
    return `${OWNER_MATERIALIZED_RULES_URL}/${ruleId}/status-preview`;
  }

  function buildRuleStatusUrl(ruleId) {
    if (!RULE_ID_PATTERN.test(String(ruleId || ''))) {
      throw new FrontendError('OWNER_RULE_STATUS_INVALID_INPUT');
    }
    return `${OWNER_MATERIALIZED_RULES_URL}/${ruleId}/status`;
  }

  function buildRuleStatusPreviewPayload(targetStatus, runId) {
    return { targetStatus, runId };
  }

  function buildRuleStatusPayload({
    targetStatus,
    previewId,
    confirmation,
    reasonCode,
    ownerComment,
  } = {}) {
    return {
      targetStatus,
      previewId,
      confirmation: confirmation === true,
      reasonCode,
      ownerComment,
    };
  }

  function ruleStatusErrorMessage(code) {
    if (code === 'PREVIEW_EXPIRED' || code === 'PREVIEW_STALE') {
      return 'Данные изменились. Выполните проверку последствий заново.';
    }
    const messages = {
      OWNER_RULE_STATUS_CONFIRMATION_REQUIRED:
        'Подтвердите изменение статуса правила.',
      OWNER_RULE_STATUS_TRANSITION_INVALID:
        'Статус правила уже изменился. Обновите список.',
      PREVIEW_REQUIRED:
        'Сначала выполните проверку последствий.',
      PREVIEW_TARGET_MISMATCH:
        'Preview относится к другому изменению. Выполните проверку заново.',
      RULE_ACTIVATION_NOT_FINANCIALLY_PERMITTED:
        'Изменение заблокировано финансовой проверкой.',
      RULE_STATUS_STORAGE_UNAVAILABLE:
        'Статус изменён, но журнал временно недоступен. Повторите запрос.',
      RULE_REGISTRY_UNAVAILABLE:
        'Реестр правил временно недоступен.',
      RULE_ACTIVATION_PREVIEW_UNAVAILABLE:
        'Проверка последствий временно недоступна.',
      OWNER_MATERIALIZED_RULE_NOT_FOUND:
        'Правило не найдено. Обновите список.',
      NETWORK_ERROR:
        'Не удалось выполнить запрос. Проверьте соединение.',
      RUN_REQUIRED:
        'Сначала выполните расчёт закупки для проверочного preview.',
    };
    return messages[code] || 'Не удалось изменить статус правила.';
  }

  function candidateAvailabilityLabel(status) {
    return status === 'AVAILABLE' ? 'Доступен' :
      status === 'UNAVAILABLE' ? 'Недоступен' : '—';
  }

  function renderMaterializedRulesSummary(elements, summary = {}) {
    const values = {
      total: summary.totalRules,
      active: summary.activeRules,
      disabled: summary.disabledRules,
      buy: summary.buyRules,
      skip: summary.skipRules,
      defer: summary.deferRules,
    };
    for (const [name, value] of Object.entries(values)) {
      elements.materializedRulesSummary[name].textContent =
        displayCount(value);
    }
  }

  function createMaterializedRuleCard(
    documentObject,
    rule = {},
    onDetail = null,
    onStatusPreview = null
  ) {
    const card = documentObject.createElement('article');
    card.className = 'materialized-rule-card';
    const heading = documentObject.createElement('header');
    const scope = documentObject.createElement('div');
    const name = documentObject.createElement('h3');
    const sku = documentObject.createElement('p');
    const detailButton = documentObject.createElement('button');
    name.textContent = rule.displayScope?.primary || '—';
    sku.textContent = rule.displayScope?.secondary || '—';
    detailButton.type = 'button';
    detailButton.className = 'secondary-button';
    detailButton.textContent = 'Подробнее';
    if (typeof onDetail === 'function') {
      detailButton.addEventListener('click', () => onDetail(rule));
    }
    scope.append(name, sku);
    heading.append(scope, detailButton);

    const badges = documentObject.createElement('div');
    badges.className = 'materialized-rule-badges';
    for (const [text, className] of [
      [
        materializedRuleStatusLabel(rule.status),
        rule.status === 'ACTIVE' ? 'rule-active' : 'rule-disabled',
      ],
      [decisionLabel(rule.action?.decision), 'rule-decision'],
      [
        `Confidence: ${formatQuantity(
          rule.provenance?.confidenceScore
        )} · ${confidenceLabel(rule.provenance?.confidenceLevel)}`,
        'rule-confidence',
      ],
      [
        `Priority: ${formatQuantity(
          rule.provenance?.priorityScore
        )} · ${priorityLabel(rule.provenance?.priorityLevel)}`,
        'rule-priority',
      ],
    ]) {
      const badge = documentObject.createElement('span');
      badge.className = `materialized-rule-badge ${className}`;
      badge.textContent = text;
      badges.append(badge);
    }

    const facts = documentObject.createElement('dl');
    facts.className = 'materialized-rule-facts';
    for (const [label, value] of [
      [
        'Lifecycle',
        rule.lifecycle?.status
          ? lifecycleStatusLabel(rule.lifecycle.status)
          : '—',
      ],
      [
        'Текущий кандидат',
        candidateAvailabilityLabel(
          rule.candidateAvailability?.status
        ),
      ],
      [
        'Материализовано',
        formatHistoryDate(rule.provenance?.materializedAt),
      ],
      [
        'Обновлено',
        formatHistoryDate(rule.timestamps?.updatedAt),
      ],
      ['Источник', rule.source?.label || '—'],
    ]) {
      appendCandidateFact(documentObject, facts, label, value);
    }

    const safety = documentObject.createElement('p');
    safety.className = 'materialized-rule-safety';
    safety.textContent = materializedRuleSafetyLabel(rule);
    card.append(heading, badges, facts, safety);

    if (
      rule.management?.manageable === true &&
      typeof onStatusPreview === 'function'
    ) {
      const previewButton = documentObject.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'primary-button rule-status-preview-button';
      previewButton.textContent =
        materializedRuleStatusPreviewLabel(rule);
      previewButton.addEventListener(
        'click',
        () => onStatusPreview(rule)
      );
      card.append(previewButton);
    }

    if (rule.candidateAvailability?.status === 'UNAVAILABLE') {
      const unavailable = documentObject.createElement('p');
      unavailable.className =
        'materialized-rule-candidate-unavailable';
      unavailable.textContent =
        'Текущий кандидат больше не формируется, но созданное правило ' +
        'сохранено.';
      card.append(unavailable);
    }
    return card;
  }

  function renderMaterializedRuleCards(
    documentObject,
    parent,
    rules,
    onDetail = null,
    onStatusPreview = null
  ) {
    parent.replaceChildren();
    for (const rule of Array.isArray(rules) ? rules : []) {
      parent.append(createMaterializedRuleCard(
        documentObject,
        rule,
        onDetail,
        onStatusPreview
      ));
    }
  }

  function renderMaterializedRuleDetail(elements, rule = {}) {
    const values = {
      name: rule.displayScope?.primary,
      sku: rule.displayScope?.secondary,
      decision: decisionLabel(rule.action?.decision),
      quantity: rule.action?.quantityStrategy,
      status: materializedRuleStatusLabel(rule.status),
      source: rule.source?.label,
      confidence:
        `${formatQuantity(rule.provenance?.confidenceScore)} · ` +
        confidenceLabel(rule.provenance?.confidenceLevel),
      priority:
        `${formatQuantity(rule.provenance?.priorityScore)} · ` +
        priorityLabel(rule.provenance?.priorityLevel),
      eligibility: rule.provenance?.eligibilityStatus,
      lifecycle: rule.lifecycle?.status
        ? lifecycleStatusLabel(rule.lifecycle.status)
        : null,
      created: formatHistoryDate(rule.timestamps?.createdAt),
      updated: formatHistoryDate(rule.timestamps?.updatedAt),
    };
    for (const [name, value] of Object.entries(values)) {
      elements.materializedRuleDetail[name].textContent =
        value || '—';
    }
    elements.materializedRuleDetail.safety.textContent =
      rule.safety?.message || '—';
  }

  function buildRuleEffectivenessUrl(filters = {}) {
    const parameters = new URLSearchParams();
    for (const name of [
      'ruleStatus',
      'decision',
      'classification',
      'confidenceLevel',
      'priorityLevel',
      'dateFrom',
      'dateTo',
      'search',
    ]) {
      const value = typeof filters[name] === 'string'
        ? filters[name].trim()
        : '';
      if (value) parameters.set(name, value);
    }
    parameters.set('limit', '100');
    return `${OWNER_RULE_EFFECTIVENESS_URL}?${parameters.toString()}`;
  }

  function buildRuleEffectivenessDetailUrl(ruleId) {
    if (!RULE_ID_PATTERN.test(String(ruleId || ''))) {
      throw new FrontendError(
        'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
      );
    }
    return `${OWNER_RULE_EFFECTIVENESS_URL}/${ruleId}`;
  }

  function buildRuleEffectivenessEventsUrl(ruleId) {
    return `${buildRuleEffectivenessDetailUrl(ruleId)}/events?limit=20`;
  }

  function hasRuleEffectivenessFilters(filters = {}) {
    return [
      'ruleStatus',
      'decision',
      'classification',
      'confidenceLevel',
      'priorityLevel',
      'dateFrom',
      'dateTo',
      'search',
    ].some(name =>
      typeof filters[name] === 'string' &&
      filters[name].trim() !== ''
    );
  }

  function ruleEffectivenessViewState(result, filters = {}) {
    if (result?.status === 'UNAVAILABLE') return 'unavailable';
    if (
      result?.status !== 'AVAILABLE' ||
      !result.summary ||
      !Array.isArray(result.rules)
    ) {
      return 'invalid';
    }
    if (result.rules.length === 0) {
      return hasRuleEffectivenessFilters(filters)
        ? 'no-results'
        : 'empty';
    }
    const hasEvents = result.rules.some(
      rule => rule.effectiveness?.population?.totalEvents > 0
    );
    return hasEvents ? 'ready' : 'no-data';
  }

  function setRuleEffectivenessPanelState(elements, state) {
    elements.ruleEffectivenessLoading.hidden = state !== 'loading';
    elements.ruleEffectivenessEmpty.hidden = state !== 'empty';
    elements.ruleEffectivenessNoData.hidden = state !== 'no-data';
    elements.ruleEffectivenessNoResults.hidden =
      state !== 'no-results';
    elements.ruleEffectivenessUnavailable.hidden =
      state !== 'unavailable';
    elements.ruleEffectivenessInvalid.hidden = state !== 'invalid';
    elements.ruleEffectivenessNetwork.hidden = state !== 'network';
    elements.ruleEffectivenessContent.hidden = state !== 'ready';
  }

  function resetRuleEffectivenessFilters(elements) {
    for (const element of [
      elements.ruleEffectivenessStatus,
      elements.ruleEffectivenessDecision,
      elements.ruleEffectivenessClassification,
      elements.ruleEffectivenessConfidence,
      elements.ruleEffectivenessPriority,
      elements.ruleEffectivenessDateFrom,
      elements.ruleEffectivenessDateTo,
      elements.ruleEffectivenessSearch,
    ]) {
      element.value = '';
    }
  }

  function ruleEffectivenessClassificationLabel(value) {
    return RULE_EFFECTIVENESS_CLASSIFICATION_LABELS[value] || '—';
  }

  function ruleEffectStatusLabel(value) {
    return RULE_EFFECT_STATUS_LABELS[value] || '—';
  }

  function ruleEffectivenessCodeLabel(value) {
    return RULE_EFFECTIVENESS_CODE_LABELS[value] || '—';
  }

  function buildKnowledgeHealthUrl(filters = {}) {
    const parameters = new URLSearchParams();
    for (const name of [
      'status',
      'decision',
      'grade',
      'classification',
      'findingType',
      'severity',
      'confidenceLevel',
      'priorityLevel',
      'search',
    ]) {
      const value = typeof filters[name] === 'string'
        ? filters[name].trim()
        : '';
      if (value) parameters.set(name, value);
    }
    parameters.set('limit', '100');
    return `${OWNER_KNOWLEDGE_HEALTH_URL}?${parameters.toString()}`;
  }

  function hasKnowledgeHealthFilters(filters = {}) {
    return Object.values(filters).some(value =>
      typeof value === 'string' && value.trim() !== ''
    );
  }

  function knowledgeHealthViewState(result, filters = {}) {
    if (result?.status === 'UNAVAILABLE') return 'unavailable';
    if (
      !['AVAILABLE', 'PARTIAL'].includes(result?.status) ||
      !result.summary ||
      !result.dimensions ||
      !Array.isArray(result.findings) ||
      !Array.isArray(result.rules)
    ) {
      return 'invalid';
    }
    if (result.summary.total_rules === 0) return 'empty';
    if (result.rules.length === 0 && hasKnowledgeHealthFilters(filters)) {
      return 'no-results';
    }
    return result.status === 'PARTIAL' ? 'partial' : 'ready';
  }

  function setKnowledgeHealthPanelState(elements, state) {
    elements.knowledgeHealthLoading.hidden = state !== 'loading';
    elements.knowledgeHealthPartial.hidden = state !== 'partial';
    elements.knowledgeHealthEmpty.hidden = state !== 'empty';
    elements.knowledgeHealthNoFindings.hidden =
      !['ready', 'partial'].includes(state) ||
      elements.knowledgeHealthFindings.children.length > 0;
    elements.knowledgeHealthNoResults.hidden =
      state !== 'no-results';
    elements.knowledgeHealthUnavailable.hidden =
      state !== 'unavailable';
    elements.knowledgeHealthInvalid.hidden = state !== 'invalid';
    elements.knowledgeHealthNetwork.hidden = state !== 'network';
    elements.knowledgeHealthContent.hidden =
      !['ready', 'partial'].includes(state);
  }

  function resetKnowledgeHealthFilters(elements) {
    for (const element of [
      elements.knowledgeHealthStatus,
      elements.knowledgeHealthDecision,
      elements.knowledgeHealthGrade,
      elements.knowledgeHealthClassification,
      elements.knowledgeHealthSeverity,
      elements.knowledgeHealthFindingType,
      elements.knowledgeHealthConfidence,
      elements.knowledgeHealthPriority,
      elements.knowledgeHealthSearch,
    ]) {
      element.value = '';
    }
  }

  function knowledgeHealthGradeLabel(value) {
    return KNOWLEDGE_HEALTH_GRADE_LABELS[value] || '—';
  }

  function knowledgeHealthClassificationLabel(value) {
    return KNOWLEDGE_HEALTH_CLASSIFICATION_LABELS[value] || '—';
  }

  function knowledgeHealthSeverityLabel(value) {
    return KNOWLEDGE_HEALTH_SEVERITY_LABELS[value] || '—';
  }

  function createKnowledgeHealthFinding(
    documentObject,
    item = {},
    onNavigate
  ) {
    const card = documentObject.createElement('article');
    const title = documentObject.createElement('h4');
    const severity = documentObject.createElement('p');
    const scope = documentObject.createElement('p');
    const action = documentObject.createElement('p');
    card.className = 'knowledge-health-finding';
    title.textContent =
      KNOWLEDGE_HEALTH_FINDING_LABELS[item.type] ||
      'Требуется ручная проверка';
    severity.className = 'knowledge-health-finding-severity';
    severity.textContent =
      `Важность: ${knowledgeHealthSeverityLabel(item.severity)}`;
    scope.textContent =
      item.display_scopes?.[0]?.primary ||
      'Область правила не указана';
    action.textContent =
      `Рекомендация: ${
        KNOWLEDGE_HEALTH_ACTION_LABELS[
          item.recommended_review_action
        ] || 'Проверить вручную'
      }`;
    card.append(
      title,
      severity,
      scope,
      action,
      createOwnerLearningButton(
        documentObject,
        item.navigation_target,
        onNavigate,
        'Открыть раздел'
      )
    );
    return card;
  }

  function createKnowledgeHealthRuleRow(documentObject, rule = {}) {
    const row = documentObject.createElement('tr');
    const signals = rule.signals || {};
    const values = [
      rule.display_scope?.primary || '—',
      materializedRuleStatusLabel(rule.status),
      decisionLabel(rule.decision),
      Number.isInteger(rule.score) ? String(rule.score) : '—',
      knowledgeHealthGradeLabel(rule.grade),
      knowledgeHealthClassificationLabel(rule.classification),
      signals.has_conflict ? 'Да' : 'Нет',
      signals.has_duplicate ? 'Да' : 'Нет',
      signals.is_stale ? 'Да' : 'Нет',
      ruleEffectivenessClassificationLabel(
        signals.effectiveness_classification
      ),
      confidenceLabel(signals.confidence_level),
      priorityLabel(signals.priority_level),
    ];
    for (const value of values) {
      appendTextCell(documentObject, row, value || '—');
    }
    return row;
  }

  function renderKnowledgeHealth(
    documentObject,
    elements,
    data = {},
    onNavigate
  ) {
    const summary = data.summary || {};
    const summaryValues = {
      score: Number.isInteger(data.score) ? String(data.score) : '—',
      grade: knowledgeHealthGradeLabel(data.grade),
      apiStatus: data.status === 'PARTIAL'
        ? 'Частичные данные'
        : 'Доступно',
      conflicts: displayCount(summary.conflict_groups),
      duplicates: displayCount(summary.duplicate_groups),
      stale: displayCount(summary.stale_rules),
      attention: displayCount(
        (summary.attention_rules || 0) +
        (summary.critical_rules || 0)
      ),
    };
    for (const [name, value] of Object.entries(summaryValues)) {
      elements.knowledgeHealthSummary[name].textContent = value;
    }
    elements.knowledgeHealthDimensions.replaceChildren();
    const dimensionLabels = {
      consistency: 'Согласованность',
      effectiveness: 'Эффективность',
      freshness: 'Актуальность',
      data_quality: 'Качество данных',
      safety: 'Безопасность',
      maintainability: 'Поддерживаемость',
    };
    for (const [name, label] of Object.entries(dimensionLabels)) {
      const card = documentObject.createElement('article');
      const title = documentObject.createElement('span');
      const score = documentObject.createElement('strong');
      const detail = documentObject.createElement('small');
      card.className = 'knowledge-health-dimension';
      title.textContent = label;
      score.textContent = Number.isInteger(data.dimensions?.[name]?.score)
        ? String(data.dimensions[name].score)
        : '—';
      detail.textContent =
        `Вес ${displayCount(data.dimensions?.[name]?.weight)}% · ` +
        `проблем ${displayCount(
          data.dimensions?.[name]?.findings_count
        )}`;
      card.append(title, score, detail);
      elements.knowledgeHealthDimensions.append(card);
    }
    elements.knowledgeHealthFindings.replaceChildren();
    for (const item of data.findings || []) {
      elements.knowledgeHealthFindings.append(
        createKnowledgeHealthFinding(
          documentObject,
          item,
          onNavigate
        )
      );
    }
    elements.knowledgeHealthRules.replaceChildren();
    for (const rule of data.rules || []) {
      elements.knowledgeHealthRules.append(
        createKnowledgeHealthRuleRow(documentObject, rule)
      );
    }
  }

  function formatSignedRub(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    if (value > 0) return `+${formatRub(value)}`;
    if (value < 0) return `−${formatRub(Math.abs(value))}`;
    return formatRub(0);
  }

  function renderRuleEffectivenessSummary(elements, summary = {}) {
    const values = {
      total: displayCount(summary.totalRules),
      applied: displayCount(summary.appliedRules),
      noEffect: displayCount(summary.noEffectRules),
      stale: displayCount(summary.staleRules),
      review: displayCount(summary.reviewRecommendedRules),
      amountDelta: formatSignedRub(summary.totalOrderAmountDelta),
    };
    for (const [name, value] of Object.entries(values)) {
      elements.ruleEffectivenessSummary[name].textContent = value;
    }
  }

  function createRuleEffectivenessRow(
    documentObject,
    rule = {},
    onDetail = null
  ) {
    const row = documentObject.createElement('tr');
    const itemCell = documentObject.createElement('td');
    const button = documentObject.createElement('button');
    const sku = documentObject.createElement('small');
    button.type = 'button';
    button.className = 'rule-effectiveness-row-button';
    button.textContent = rule.displayScope?.primary || '—';
    sku.textContent = rule.displayScope?.secondary || '—';
    button.append(sku);
    if (typeof onDetail === 'function') {
      button.addEventListener('click', () => onDetail(rule));
    }
    itemCell.append(button);
    row.append(itemCell);

    const effectiveness = rule.effectiveness || {};
    const population = effectiveness.population || {};
    const effects = effectiveness.effects || {};
    const impact = effectiveness.impact || {};
    const activity = effectiveness.activity || {};
    const classificationCell = documentObject.createElement('td');
    const classification = documentObject.createElement('span');
    classification.className = 'rule-effectiveness-classification';
    classification.textContent = ruleEffectivenessClassificationLabel(
      effectiveness.classification
    );
    for (const value of [
      materializedRuleStatusLabel(rule.status),
      decisionLabel(rule.decision),
    ]) {
      appendHistoryCell(documentObject, row, value);
    }
    classificationCell.append(classification);
    row.append(classificationCell);
    for (const value of [
      displayCount(population.evaluatedRuns),
      displayCount(effects.appliedEffectRuns),
      formatPercent(effects.effectRate),
      formatPercent(effects.matchRate),
      displayCount(impact.totalAffectedRows),
      formatSignedQuantity(impact.totalQuantityDelta),
      formatSignedRub(impact.totalOrderAmountDelta),
      formatHistoryDate(activity.lastAppliedAt),
      displayCount(activity.daysSinceLastApplied),
      displayCount(activity.consecutiveNoEffectRuns),
    ]) {
      appendHistoryCell(documentObject, row, value);
    }
    const review = documentObject.createElement('td');
    review.className = effectiveness.classification ===
      'REVIEW_RECOMMENDED'
      ? 'rule-effectiveness-review'
      : '';
    review.textContent = effectiveness.classification ===
      'REVIEW_RECOMMENDED'
      ? 'Нужна проверка'
      : '—';
    row.append(review);
    return row;
  }

  function renderRuleEffectivenessRows(
    documentObject,
    parent,
    rules,
    onDetail = null
  ) {
    parent.replaceChildren();
    for (const rule of Array.isArray(rules) ? rules : []) {
      parent.append(
        createRuleEffectivenessRow(documentObject, rule, onDetail)
      );
    }
  }

  function renderRuleEffectivenessDetail(
    documentObject,
    elements,
    detail = {},
    eventsResult = {}
  ) {
    const rule = detail.rule || {};
    const effectiveness = detail.effectiveness || {};
    const population = effectiveness.population || {};
    const effects = effectiveness.effects || {};
    const impact = effectiveness.impact || {};
    const activity = effectiveness.activity || {};
    const quality = effectiveness.quality || {};
    elements.ruleEffectivenessDetailSummary.replaceChildren();
    for (const [label, value] of [
      ['Товар', rule.displayScope?.primary || '—'],
      ['SKU', rule.displayScope?.secondary || '—'],
      ['Статус', materializedRuleStatusLabel(rule.status)],
      ['Решение', decisionLabel(rule.decision)],
      [
        'Классификация',
        ruleEffectivenessClassificationLabel(
          effectiveness.classification
        ),
      ],
      ['Оценённых запусков', displayCount(population.evaluatedRuns)],
      ['Запусков с эффектом', displayCount(effects.appliedEffectRuns)],
      ['Effect rate', formatPercent(effects.effectRate)],
      ['Match rate', formatPercent(effects.matchRate)],
      ['Затронуто строк', displayCount(impact.totalAffectedRows)],
      ['Δ количества', formatSignedQuantity(impact.totalQuantityDelta)],
      ['Δ суммы заказа', formatSignedRub(impact.totalOrderAmountDelta)],
      ['Последний эффект', formatHistoryDate(activity.lastAppliedAt)],
      [
        'Дней с последнего эффекта',
        displayCount(activity.daysSinceLastApplied),
      ],
      [
        'Запусков без эффекта подряд',
        displayCount(activity.consecutiveNoEffectRuns),
      ],
      [
        'Предупреждения качества',
        Array.isArray(quality.warnings) && quality.warnings.length > 0
          ? quality.warnings.join(', ')
          : 'Нет',
      ],
    ]) {
      appendCandidateFact(
        documentObject,
        elements.ruleEffectivenessDetailSummary,
        label,
        value
      );
    }

    elements.ruleEffectivenessDetailCodes.replaceChildren();
    for (const code of (
      Array.isArray(effectiveness.explanationCodes)
        ? effectiveness.explanationCodes
        : []
    )) {
      const item = documentObject.createElement('li');
      item.textContent = ruleEffectivenessCodeLabel(code);
      elements.ruleEffectivenessDetailCodes.append(item);
    }

    elements.ruleEffectivenessDetailEvents.replaceChildren();
    for (const event of (
      Array.isArray(eventsResult.events)
        ? eventsResult.events.slice(0, 20)
        : []
    )) {
      const row = documentObject.createElement('tr');
      for (const value of [
        formatHistoryDate(event.recordedAt),
        event.runId || '—',
        ruleEffectStatusLabel(event.effectStatus),
        displayCount(event.impact?.affectedRows),
        formatSignedQuantity(event.impact?.quantityDelta),
        formatSignedRub(event.impact?.orderAmountDelta),
        event.fallback?.occurred ? 'Да' : 'Нет',
      ]) {
        appendHistoryCell(documentObject, row, value);
      }
      elements.ruleEffectivenessDetailEvents.append(row);
    }
  }

  function renderRuleStatusPreview(
    documentObject,
    elements,
    preview = {}
  ) {
    const rule = preview.rule || {};
    const impact = preview.impact || {};
    const values = {
      item: rule.display_scope?.primary,
      currentStatus: materializedRuleStatusLabel(rule.current_status),
      targetStatus: materializedRuleStatusLabel(rule.target_status),
      decision: decisionLabel(rule.decision),
      affectedItems: displayCount(impact.affected_items),
      decisionChanges: displayCount(impact.decision_changes),
      quantityChanges: displayCount(impact.quantity_changes),
      amountBefore: formatRub(impact.order_amount_before),
      amountAfter: formatRub(impact.order_amount_after),
      amountDelta: formatRub(impact.order_amount_delta),
      unitsBefore: formatQuantity(impact.units_before),
      unitsAfter: formatQuantity(impact.units_after),
      financialBefore: impact.financial_status_before,
      financialAfter: impact.financial_status_after,
      expiresAt: formatHistoryDate(preview.expires_at),
    };
    for (const [name, value] of Object.entries(values)) {
      elements.ruleStatusPreview[name].textContent = value || '—';
    }
    elements.ruleStatusWarnings.replaceChildren();
    for (const warning of (
      Array.isArray(preview.warnings) ? preview.warnings : []
    )) {
      const item = documentObject.createElement('li');
      item.textContent = warning;
      elements.ruleStatusWarnings.append(item);
    }
    if (elements.ruleStatusWarnings.children.length === 0) {
      const item = documentObject.createElement('li');
      item.textContent = 'Критических предупреждений нет.';
      elements.ruleStatusWarnings.append(item);
    }
    elements.ruleStatusChangedItems.replaceChildren();
    for (const item of (
      Array.isArray(preview.changed_items)
        ? preview.changed_items
        : []
    )) {
      const row = documentObject.createElement('li');
      row.textContent =
        `${item.product_name || 'Товар'}: ` +
        `${item.decision_before || '—'} → ${item.decision_after || '—'}, ` +
        `${formatQuantity(item.quantity_before)} → ` +
        `${formatQuantity(item.quantity_after)}`;
      elements.ruleStatusChangedItems.append(row);
    }
    if (elements.ruleStatusChangedItems.children.length === 0) {
      const item = documentObject.createElement('li');
      item.textContent = 'Изменений решения или количества нет.';
      elements.ruleStatusChangedItems.append(item);
    }
    elements.ruleStatusSafetyText.textContent =
      rule.target_status === 'ACTIVE'
        ? 'После активации правило сможет влиять на будущие расчёты ' +
          'закупки. Текущий сохранённый заказ автоматически не изменится.'
        : 'После отключения правило перестанет учитываться в будущих ' +
          'расчётах. Текущий сохранённый заказ автоматически не изменится.';
  }

  function buildOwnerLearningCenterUrl(filters = {}, options = {}) {
    const parameters = new URLSearchParams();
    for (const name of [
      'supplier',
      'brand',
      'category',
      'dateFrom',
      'dateTo',
    ]) {
      const value = typeof filters[name] === 'string'
        ? filters[name].trim()
        : '';
      if (value) parameters.set(name, value);
    }
    for (const name of [
      'attentionLimit',
      'activityLimit',
      'asOf',
    ]) {
      if (
        typeof options[name] === 'string' ||
        Number.isInteger(options[name])
      ) {
        parameters.set(name, String(options[name]));
      }
    }
    const query = parameters.toString();
    return query
      ? `${OWNER_LEARNING_CENTER_URL}?${query}`
      : OWNER_LEARNING_CENTER_URL;
  }

  function ownerLearningViewState(result) {
    if (result?.status === 'UNAVAILABLE') return 'unavailable';
    if (result?.status === 'PARTIAL') return 'partial';
    if (
      result?.status !== 'AVAILABLE' ||
      !result.summary ||
      !result.attention ||
      !Array.isArray(result.recent_activity) ||
      !result.system_health ||
      !result.sections
    ) {
      return 'invalid';
    }
    return 'ready';
  }

  function setOwnerLearningState(elements, state) {
    elements.ownerLearningLoading.hidden = state !== 'loading';
    elements.ownerLearningPartial.hidden = state !== 'partial';
    elements.ownerLearningUnavailable.hidden =
      state !== 'unavailable';
    elements.ownerLearningInvalid.hidden = state !== 'invalid';
    elements.ownerLearningNetwork.hidden = state !== 'network';
    elements.ownerLearningContent.hidden =
      !['ready', 'partial'].includes(state);
  }

  function formatHistoryDateTime(value) {
    if (typeof value !== 'string') return '—';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  function renderOwnerLearningSummary(elements, data = {}) {
    const summary = data.summary || {};
    const values = {
      decisions: displayCount(summary.decisions?.total),
      candidates: displayCount(summary.candidates?.total),
      approved: displayCount(summary.candidates?.approved),
      rules: displayCount(summary.rules?.total),
      activeRules: displayCount(summary.rules?.active),
      disabledRules: displayCount(summary.rules?.disabled),
      effectiveRules: displayCount(summary.effectiveness?.effective),
      attentionTotal: displayCount(data.attention?.total),
      amountDelta: formatSignedRub(
        summary.effectiveness?.total_order_amount_delta
      ),
      knowledgeScore: Number.isInteger(summary.knowledge_health?.score)
        ? String(summary.knowledge_health.score)
        : '—',
      knowledgeGrade: knowledgeHealthGradeLabel(
        summary.knowledge_health?.grade
      ),
      knowledgeConflicts: displayCount(
        summary.knowledge_health?.conflict_groups
      ),
      knowledgeDuplicates: displayCount(
        summary.knowledge_health?.duplicate_groups
      ),
      knowledgeStale: displayCount(
        summary.knowledge_health?.stale_rules
      ),
      knowledgeAttention: displayCount(
        (summary.knowledge_health?.critical_findings || 0) +
        (summary.knowledge_health?.attention_findings || 0)
      ),
    };
    for (const [name, value] of Object.entries(values)) {
      elements.ownerLearningSummary[name].textContent = value;
    }
    elements.ownerLearningAttentionBadge.textContent =
      displayCount(data.attention?.total);
  }

  function createOwnerLearningButton(
    documentObject,
    target,
    onNavigate,
    label = 'Открыть раздел'
  ) {
    const button = documentObject.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.navigationTarget = target || '';
    if (typeof onNavigate === 'function') {
      button.addEventListener('click', () => onNavigate(target));
    }
    return button;
  }

  function createAttentionCard(
    documentObject,
    item = {},
    onNavigate
  ) {
    const card = documentObject.createElement('article');
    const header = documentObject.createElement('header');
    const title = documentObject.createElement('h4');
    const priority = documentObject.createElement('span');
    const description = documentObject.createElement('p');
    const scope = documentObject.createElement('small');
    const date = documentObject.createElement('small');
    card.className = 'owner-learning-list-item';
    title.textContent = item.title || 'Требуется ручная проверка';
    priority.className = 'owner-learning-priority';
    priority.dataset.priority = item.priority || 'LOW';
    priority.textContent =
      CENTER_PRIORITY_LABELS[item.priority] || 'Низкий';
    header.append(title, priority);
    description.textContent = item.description || '—';
    scope.textContent = [
      item.display_scope?.primary,
      item.display_scope?.secondary,
    ].filter(Boolean).join(' · ') || '—';
    date.textContent = formatHistoryDateTime(item.created_at);
    card.append(
      header,
      description,
      scope,
      date,
      createOwnerLearningButton(
        documentObject,
        item.navigation_target,
        onNavigate
      )
    );
    return card;
  }

  function renderOwnerLearningAttention(
    documentObject,
    elements,
    attention = {},
    onNavigate
  ) {
    const items = Array.isArray(attention.items)
      ? attention.items
      : [];
    elements.ownerLearningAttentionList.replaceChildren();
    for (const item of items) {
      elements.ownerLearningAttentionList.append(
        createAttentionCard(documentObject, item, onNavigate)
      );
    }
    elements.ownerLearningAttentionEmpty.hidden = items.length !== 0;
  }

  function createActivityCard(
    documentObject,
    item = {},
    onNavigate
  ) {
    const card = documentObject.createElement('article');
    const title = documentObject.createElement('h4');
    const scope = documentObject.createElement('small');
    const description = documentObject.createElement('p');
    const facts = documentObject.createElement('p');
    const date = documentObject.createElement('small');
    card.className = 'owner-learning-list-item';
    title.textContent =
      CENTER_ACTIVITY_LABELS[item.activity_type] ||
      'Изменение базы знаний';
    scope.textContent = [
      item.display_scope?.primary,
      item.display_scope?.secondary,
    ].filter(Boolean).join(' · ') || '—';
    description.textContent = item.description || '—';
    const values = [];
    if (item.decision) {
      values.push(`Решение: ${decisionLabel(item.decision)}`);
    }
    if (item.status) values.push(`Статус: ${item.status}`);
    if (typeof item.amount_delta === 'number') {
      values.push(`Δ суммы: ${formatSignedRub(item.amount_delta)}`);
    }
    if (typeof item.quantity_delta === 'number') {
      values.push(
        `Δ количества: ${formatSignedQuantity(item.quantity_delta)}`
      );
    }
    facts.textContent = values.join(' · ') || '—';
    date.textContent = formatHistoryDateTime(item.recorded_at);
    card.append(
      title,
      scope,
      description,
      facts,
      date,
      createOwnerLearningButton(
        documentObject,
        item.navigation_target,
        onNavigate
      )
    );
    return card;
  }

  function renderOwnerLearningActivity(
    documentObject,
    elements,
    activity,
    onNavigate
  ) {
    const items = Array.isArray(activity) ? activity : [];
    elements.ownerLearningActivityList.replaceChildren();
    for (const item of items) {
      elements.ownerLearningActivityList.append(
        createActivityCard(documentObject, item, onNavigate)
      );
    }
    elements.ownerLearningActivityEmpty.hidden = items.length !== 0;
  }

  function renderOwnerLearningHealth(
    documentObject,
    elements,
    health = {}
  ) {
    elements.ownerLearningHealthStatus.textContent =
      CENTER_HEALTH_LABELS[health.overall_status] ||
      CENTER_HEALTH_LABELS.UNAVAILABLE;
    elements.ownerLearningHealthComponents.replaceChildren();
    for (const [name, value] of Object.entries(
      health.components || {}
    )) {
      const row = documentObject.createElement('div');
      const label = documentObject.createElement('dt');
      const status = documentObject.createElement('dd');
      label.textContent = CENTER_COMPONENT_LABELS[name] || name;
      status.textContent =
        CENTER_COMPONENT_STATUS_LABELS[value?.status] || 'Недоступно';
      row.append(label, status);
      elements.ownerLearningHealthComponents.append(row);
    }
    elements.ownerLearningHealthWarnings.replaceChildren();
    for (const warning of (
      Array.isArray(health.data_quality_warnings)
        ? health.data_quality_warnings
        : []
    )) {
      const item = documentObject.createElement('li');
      item.textContent = warning;
      elements.ownerLearningHealthWarnings.append(item);
    }
    elements.ownerLearningLastKnowledge.textContent =
      formatHistoryDateTime(health.last_knowledge_change_at);
    elements.ownerLearningLastStatus.textContent =
      formatHistoryDateTime(health.last_rule_status_change_at);
    elements.ownerLearningLastEffect.textContent =
      formatHistoryDateTime(health.last_rule_effect_at);
  }

  function renderOwnerLearningSections(
    documentObject,
    elements,
    sections = {},
    onNavigate
  ) {
    const definitions = [
      ['decision_history', 'История решений'],
      ['candidates', 'Кандидаты'],
      ['materialized_rules', 'Материализованные правила'],
      ['effectiveness', 'Эффективность правил'],
      ['knowledge_health', 'Здоровье базы знаний'],
    ];
    elements.ownerLearningSections.replaceChildren();
    for (const [name, label] of definitions) {
      const value = sections[name] || {};
      const card = documentObject.createElement('article');
      const title = documentObject.createElement('h3');
      const total = documentObject.createElement('p');
      const status = documentObject.createElement('p');
      const attention = documentObject.createElement('p');
      card.className = 'owner-learning-section-card';
      title.textContent = label;
      total.textContent = `Количество: ${displayCount(value.count)}`;
      if (
        name === 'knowledge_health' &&
        Number.isInteger(value.score)
      ) {
        total.textContent =
          `Оценка: ${value.score} · ${
            knowledgeHealthGradeLabel(value.grade)
          }`;
      }
      status.textContent =
        `Статус: ${
          CENTER_COMPONENT_STATUS_LABELS[value.status] || 'Недоступно'
        }`;
      card.append(title, total, status);
      if (Number.isInteger(value.attention_count)) {
        attention.textContent =
          `Требуют внимания: ${displayCount(value.attention_count)}`;
        card.append(attention);
      }
      if (Number.isInteger(value.active_count)) {
        attention.textContent =
          `Активных: ${displayCount(value.active_count)}`;
        card.append(attention);
      }
      card.append(createOwnerLearningButton(
        documentObject,
        value.navigation_target,
        onNavigate,
        'Открыть'
      ));
      elements.ownerLearningSections.append(card);
    }
  }

  function renderOwnerLearningCenter(
    documentObject,
    elements,
    data,
    onNavigate
  ) {
    renderOwnerLearningSummary(elements, data);
    renderOwnerLearningAttention(
      documentObject,
      elements,
      data.attention,
      onNavigate
    );
    renderOwnerLearningActivity(
      documentObject,
      elements,
      data.recent_activity,
      onNavigate
    );
    renderOwnerLearningHealth(
      documentObject,
      elements,
      data.system_health
    );
    renderOwnerLearningSections(
      documentObject,
      elements,
      data.sections,
      onNavigate
    );
  }

  function switchOwnerLearningTab(elements, target) {
    const safeTarget = [
      'OVERVIEW',
      'DECISION_HISTORY',
      'CANDIDATES',
      'MATERIALIZED_RULES',
      'RULE_EFFECTIVENESS',
      'KNOWLEDGE_HEALTH',
    ].includes(target)
      ? target
      : 'OVERVIEW';
    for (const tab of elements.ownerLearningTabs) {
      const selected =
        tab.dataset.ownerLearningTarget === safeTarget;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    for (const panel of elements.ownerLearningPanels) {
      panel.hidden =
        panel.dataset.ownerLearningPanel !== safeTarget;
    }
    return safeTarget;
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
      ownerLearningTabs: Array.from(
        documentObject.querySelectorAll('[data-owner-learning-target]')
      ),
      ownerLearningPanels: Array.from(
        documentObject.querySelectorAll('[data-owner-learning-panel]')
      ),
      ownerLearningLoading:
        documentObject.getElementById('owner-learning-loading'),
      ownerLearningPartial:
        documentObject.getElementById('owner-learning-partial'),
      ownerLearningUnavailable:
        documentObject.getElementById('owner-learning-unavailable'),
      ownerLearningInvalid:
        documentObject.getElementById('owner-learning-invalid'),
      ownerLearningNetwork:
        documentObject.getElementById('owner-learning-network'),
      ownerLearningContent:
        documentObject.getElementById('owner-learning-content'),
      ownerLearningAttentionBadge:
        documentObject.getElementById('owner-learning-attention-badge'),
      ownerLearningAttentionEmpty:
        documentObject.getElementById('owner-learning-attention-empty'),
      ownerLearningAttentionList:
        documentObject.getElementById('owner-learning-attention-list'),
      ownerLearningActivityEmpty:
        documentObject.getElementById('owner-learning-activity-empty'),
      ownerLearningActivityList:
        documentObject.getElementById('owner-learning-activity-list'),
      ownerLearningHealthStatus:
        documentObject.getElementById('owner-learning-health-status'),
      ownerLearningHealthComponents:
        documentObject.getElementById(
          'owner-learning-health-components'
        ),
      ownerLearningHealthWarnings:
        documentObject.getElementById('owner-learning-health-warnings'),
      ownerLearningLastKnowledge:
        documentObject.getElementById('owner-learning-last-knowledge'),
      ownerLearningLastStatus:
        documentObject.getElementById('owner-learning-last-status'),
      ownerLearningLastEffect:
        documentObject.getElementById('owner-learning-last-effect'),
      ownerLearningSections:
        documentObject.getElementById('owner-learning-sections'),
      ownerLearningSummary: {
        decisions:
          documentObject.getElementById('owner-learning-decisions'),
        candidates:
          documentObject.getElementById('owner-learning-candidates'),
        approved:
          documentObject.getElementById('owner-learning-approved'),
        rules: documentObject.getElementById('owner-learning-rules'),
        activeRules:
          documentObject.getElementById(
            'owner-learning-active-rules'
          ),
        disabledRules:
          documentObject.getElementById(
            'owner-learning-disabled-rules'
          ),
        effectiveRules:
          documentObject.getElementById(
            'owner-learning-effective-rules'
          ),
        attentionTotal:
          documentObject.getElementById(
            'owner-learning-attention-total'
          ),
        amountDelta:
          documentObject.getElementById(
            'owner-learning-amount-delta'
          ),
        knowledgeScore:
          documentObject.getElementById(
            'owner-learning-knowledge-score'
          ),
        knowledgeGrade:
          documentObject.getElementById(
            'owner-learning-knowledge-grade'
          ),
        knowledgeConflicts:
          documentObject.getElementById(
            'owner-learning-knowledge-conflicts'
          ),
        knowledgeDuplicates:
          documentObject.getElementById(
            'owner-learning-knowledge-duplicates'
          ),
        knowledgeStale:
          documentObject.getElementById(
            'owner-learning-knowledge-stale'
          ),
        knowledgeAttention:
          documentObject.getElementById(
            'owner-learning-knowledge-attention'
          ),
      },
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
      historyForm: documentObject.getElementById('history-filters'),
      historySupplier: documentObject.getElementById('history-supplier'),
      historyBrand: documentObject.getElementById('history-brand'),
      historyDecision: documentObject.getElementById('history-decision'),
      historyReason: documentObject.getElementById('history-reason'),
      historyDateFrom: documentObject.getElementById('history-date-from'),
      historyDateTo: documentObject.getElementById('history-date-to'),
      historyLoading: documentObject.getElementById('history-loading'),
      historyEmpty: documentObject.getElementById('history-empty'),
      historyNoResults:
        documentObject.getElementById('history-no-results'),
      historyUnavailable:
        documentObject.getElementById('history-unavailable'),
      historyInvalid: documentObject.getElementById('history-invalid'),
      historyContent: documentObject.getElementById('history-content'),
      historyDecisionDistribution:
        documentObject.getElementById('history-decision-distribution'),
      historyReasons: documentObject.getElementById('history-reasons'),
      historyPatterns: documentObject.getElementById('history-patterns'),
      historyItems:
        documentObject.getElementById('history-item-analytics'),
      historySummary: {
        total: documentObject.getElementById('history-total'),
        items: documentObject.getElementById('history-items'),
        brands: documentObject.getElementById('history-brands'),
        suppliers: documentObject.getElementById('history-suppliers'),
        agreements: documentObject.getElementById('history-agreements'),
        disagreements:
          documentObject.getElementById('history-disagreements'),
        agreementRate:
          documentObject.getElementById('history-agreement-rate'),
      },
      candidateForm:
        documentObject.getElementById('candidate-filters'),
      candidateSupplier:
        documentObject.getElementById('candidate-supplier'),
      candidateBrand:
        documentObject.getElementById('candidate-brand'),
      candidateDecision:
        documentObject.getElementById('candidate-decision'),
      candidateReason:
        documentObject.getElementById('candidate-reason'),
      candidateDateFrom:
        documentObject.getElementById('candidate-date-from'),
      candidateDateTo:
        documentObject.getElementById('candidate-date-to'),
      candidateEligibility:
        documentObject.getElementById('candidate-eligibility'),
      candidateConfidence:
        documentObject.getElementById('candidate-confidence'),
      candidatePriority:
        documentObject.getElementById('candidate-priority'),
      candidateReset:
        documentObject.getElementById('candidate-reset'),
      candidateLoading:
        documentObject.getElementById('candidate-loading'),
      candidateEmpty:
        documentObject.getElementById('candidate-empty'),
      candidateNoPatterns:
        documentObject.getElementById('candidate-no-patterns'),
      candidateNoResults:
        documentObject.getElementById('candidate-no-results'),
      candidateUnavailable:
        documentObject.getElementById('candidate-unavailable'),
      candidateInvalid:
        documentObject.getElementById('candidate-invalid'),
      candidateContent:
        documentObject.getElementById('candidate-content'),
      candidateList:
        documentObject.getElementById('candidate-list'),
      candidateActionStatus:
        documentObject.getElementById('candidate-action-status'),
      candidateLifecycleModal:
        documentObject.getElementById('candidate-lifecycle-modal'),
      candidateLifecycleForm:
        documentObject.getElementById('candidate-lifecycle-form'),
      candidateModalClose:
        documentObject.getElementById('candidate-modal-close'),
      candidateModalCancel:
        documentObject.getElementById('candidate-modal-cancel'),
      candidateModalSubmit:
        documentObject.getElementById('candidate-modal-submit'),
      candidateModalCandidate:
        documentObject.getElementById('candidate-modal-candidate'),
      candidateModalStatus:
        documentObject.getElementById('candidate-modal-status'),
      candidateModalConfidence:
        documentObject.getElementById('candidate-modal-confidence'),
      candidateModalPriority:
        documentObject.getElementById('candidate-modal-priority'),
      candidateModalEligibility:
        documentObject.getElementById('candidate-modal-eligibility'),
      candidateModalReason:
        documentObject.getElementById('candidate-modal-reason'),
      candidateModalComment:
        documentObject.getElementById('candidate-modal-comment'),
      candidateApproveConfirmation:
        documentObject.getElementById(
          'candidate-approve-confirmation'
        ),
      candidateApproveCheckbox:
        documentObject.getElementById('candidate-approve-checkbox'),
      candidateModalError:
        documentObject.getElementById('candidate-modal-error'),
      ruleMaterializationModal:
        documentObject.getElementById('rule-materialization-modal'),
      ruleMaterializationForm:
        documentObject.getElementById('rule-materialization-form'),
      ruleMaterializationClose:
        documentObject.getElementById('rule-materialization-close'),
      ruleMaterializationCancel:
        documentObject.getElementById('rule-materialization-cancel'),
      ruleMaterializationSubmit:
        documentObject.getElementById('rule-materialization-submit'),
      ruleMaterializationCandidate:
        documentObject.getElementById('rule-materialization-candidate'),
      ruleMaterializationDecision:
        documentObject.getElementById('rule-materialization-decision'),
      ruleMaterializationConfidence:
        documentObject.getElementById(
          'rule-materialization-confidence'
        ),
      ruleMaterializationPriority:
        documentObject.getElementById('rule-materialization-priority'),
      ruleMaterializationEligibility:
        documentObject.getElementById(
          'rule-materialization-eligibility'
        ),
      ruleMaterializationCheckbox:
        documentObject.getElementById('rule-materialization-checkbox'),
      ruleMaterializationError:
        documentObject.getElementById('rule-materialization-error'),
      candidateSummary: {
        total: documentObject.getElementById('candidate-total'),
        eligible: documentObject.getElementById('candidate-eligible'),
        reviewOnly:
          documentObject.getElementById('candidate-review-only'),
        ineligible:
          documentObject.getElementById('candidate-ineligible'),
        highPriority:
          documentObject.getElementById('candidate-high-priority'),
        criticalPriority:
          documentObject.getElementById(
            'candidate-critical-priority'
          ),
      },
      materializedRulesForm:
        documentObject.getElementById('materialized-rules-filters'),
      materializedRulesStatus:
        documentObject.getElementById('materialized-rules-status'),
      materializedRulesDecision:
        documentObject.getElementById('materialized-rules-decision'),
      materializedRulesConfidence:
        documentObject.getElementById(
          'materialized-rules-confidence'
        ),
      materializedRulesPriority:
        documentObject.getElementById('materialized-rules-priority'),
      materializedRulesLifecycle:
        documentObject.getElementById('materialized-rules-lifecycle'),
      materializedRulesAvailability:
        documentObject.getElementById(
          'materialized-rules-availability'
        ),
      materializedRulesDateFrom:
        documentObject.getElementById('materialized-rules-date-from'),
      materializedRulesDateTo:
        documentObject.getElementById('materialized-rules-date-to'),
      materializedRulesSearch:
        documentObject.getElementById('materialized-rules-search'),
      materializedRulesReset:
        documentObject.getElementById('materialized-rules-reset'),
      materializedRulesLoading:
        documentObject.getElementById('materialized-rules-loading'),
      materializedRulesEmpty:
        documentObject.getElementById('materialized-rules-empty'),
      materializedRulesNoResults:
        documentObject.getElementById(
          'materialized-rules-no-results'
        ),
      materializedRulesUnavailable:
        documentObject.getElementById(
          'materialized-rules-unavailable'
        ),
      materializedRulesInvalid:
        documentObject.getElementById('materialized-rules-invalid'),
      materializedRulesNetwork:
        documentObject.getElementById('materialized-rules-network'),
      materializedRulesContent:
        documentObject.getElementById('materialized-rules-content'),
      materializedRulesContextWarning:
        documentObject.getElementById(
          'materialized-rules-context-warning'
        ),
      materializedRulesList:
        documentObject.getElementById('materialized-rules-list'),
      materializedRulesSummary: {
        total:
          documentObject.getElementById('materialized-rules-total'),
        active:
          documentObject.getElementById('materialized-rules-active'),
        disabled:
          documentObject.getElementById('materialized-rules-disabled'),
        buy: documentObject.getElementById('materialized-rules-buy'),
        skip: documentObject.getElementById('materialized-rules-skip'),
        defer:
          documentObject.getElementById('materialized-rules-defer'),
      },
      ruleEffectivenessForm:
        documentObject.getElementById('rule-effectiveness-filters'),
      ruleEffectivenessStatus:
        documentObject.getElementById('rule-effectiveness-status'),
      ruleEffectivenessDecision:
        documentObject.getElementById('rule-effectiveness-decision'),
      ruleEffectivenessClassification:
        documentObject.getElementById(
          'rule-effectiveness-classification'
        ),
      ruleEffectivenessConfidence:
        documentObject.getElementById('rule-effectiveness-confidence'),
      ruleEffectivenessPriority:
        documentObject.getElementById('rule-effectiveness-priority'),
      ruleEffectivenessDateFrom:
        documentObject.getElementById('rule-effectiveness-date-from'),
      ruleEffectivenessDateTo:
        documentObject.getElementById('rule-effectiveness-date-to'),
      ruleEffectivenessSearch:
        documentObject.getElementById('rule-effectiveness-search'),
      ruleEffectivenessReset:
        documentObject.getElementById('rule-effectiveness-reset'),
      ruleEffectivenessLoading:
        documentObject.getElementById('rule-effectiveness-loading'),
      ruleEffectivenessEmpty:
        documentObject.getElementById('rule-effectiveness-empty'),
      ruleEffectivenessNoData:
        documentObject.getElementById('rule-effectiveness-no-data'),
      ruleEffectivenessNoResults:
        documentObject.getElementById('rule-effectiveness-no-results'),
      ruleEffectivenessUnavailable:
        documentObject.getElementById('rule-effectiveness-unavailable'),
      ruleEffectivenessInvalid:
        documentObject.getElementById('rule-effectiveness-invalid'),
      ruleEffectivenessNetwork:
        documentObject.getElementById('rule-effectiveness-network'),
      ruleEffectivenessContent:
        documentObject.getElementById('rule-effectiveness-content'),
      ruleEffectivenessBody:
        documentObject.getElementById('rule-effectiveness-body'),
      ruleEffectivenessSummary: {
        total:
          documentObject.getElementById('rule-effectiveness-total'),
        applied:
          documentObject.getElementById('rule-effectiveness-applied'),
        noEffect:
          documentObject.getElementById('rule-effectiveness-no-effect'),
        stale:
          documentObject.getElementById('rule-effectiveness-stale'),
        review:
          documentObject.getElementById('rule-effectiveness-review'),
        amountDelta:
          documentObject.getElementById(
            'rule-effectiveness-amount-delta'
          ),
      },
      knowledgeHealthForm:
        documentObject.getElementById('knowledge-health-filters'),
      knowledgeHealthStatus:
        documentObject.getElementById('knowledge-health-status'),
      knowledgeHealthDecision:
        documentObject.getElementById('knowledge-health-decision'),
      knowledgeHealthGrade:
        documentObject.getElementById('knowledge-health-grade'),
      knowledgeHealthClassification:
        documentObject.getElementById(
          'knowledge-health-classification'
        ),
      knowledgeHealthSeverity:
        documentObject.getElementById('knowledge-health-severity'),
      knowledgeHealthFindingType:
        documentObject.getElementById('knowledge-health-finding-type'),
      knowledgeHealthConfidence:
        documentObject.getElementById('knowledge-health-confidence'),
      knowledgeHealthPriority:
        documentObject.getElementById('knowledge-health-priority'),
      knowledgeHealthSearch:
        documentObject.getElementById('knowledge-health-search'),
      knowledgeHealthReset:
        documentObject.getElementById('knowledge-health-reset'),
      knowledgeHealthLoading:
        documentObject.getElementById('knowledge-health-loading'),
      knowledgeHealthPartial:
        documentObject.getElementById('knowledge-health-partial'),
      knowledgeHealthEmpty:
        documentObject.getElementById('knowledge-health-empty'),
      knowledgeHealthNoFindings:
        documentObject.getElementById('knowledge-health-no-findings'),
      knowledgeHealthNoResults:
        documentObject.getElementById('knowledge-health-no-results'),
      knowledgeHealthUnavailable:
        documentObject.getElementById('knowledge-health-unavailable'),
      knowledgeHealthInvalid:
        documentObject.getElementById('knowledge-health-invalid'),
      knowledgeHealthNetwork:
        documentObject.getElementById('knowledge-health-network'),
      knowledgeHealthContent:
        documentObject.getElementById('knowledge-health-content'),
      knowledgeHealthDimensions:
        documentObject.getElementById('knowledge-health-dimensions'),
      knowledgeHealthFindings:
        documentObject.getElementById('knowledge-health-findings'),
      knowledgeHealthRules:
        documentObject.getElementById('knowledge-health-rules'),
      knowledgeHealthSummary: {
        score: documentObject.getElementById('knowledge-health-score'),
        grade:
          documentObject.getElementById('knowledge-health-grade-value'),
        apiStatus:
          documentObject.getElementById('knowledge-health-api-status'),
        conflicts:
          documentObject.getElementById('knowledge-health-conflicts'),
        duplicates:
          documentObject.getElementById('knowledge-health-duplicates'),
        stale:
          documentObject.getElementById('knowledge-health-stale'),
        attention:
          documentObject.getElementById('knowledge-health-attention'),
      },
      ruleEffectivenessDetailModal:
        documentObject.getElementById(
          'rule-effectiveness-detail-modal'
        ),
      ruleEffectivenessDetailClose:
        documentObject.getElementById(
          'rule-effectiveness-detail-close'
        ),
      ruleEffectivenessDetailDone:
        documentObject.getElementById(
          'rule-effectiveness-detail-done'
        ),
      ruleEffectivenessDetailState:
        documentObject.getElementById(
          'rule-effectiveness-detail-state'
        ),
      ruleEffectivenessDetailContent:
        documentObject.getElementById(
          'rule-effectiveness-detail-content'
        ),
      ruleEffectivenessDetailSummary:
        documentObject.getElementById(
          'rule-effectiveness-detail-summary'
        ),
      ruleEffectivenessDetailCodes:
        documentObject.getElementById(
          'rule-effectiveness-detail-codes'
        ),
      ruleEffectivenessDetailEvents:
        documentObject.getElementById(
          'rule-effectiveness-detail-events'
        ),
      materializedRuleDetailModal:
        documentObject.getElementById(
          'materialized-rule-detail-modal'
        ),
      materializedRuleDetailClose:
        documentObject.getElementById(
          'materialized-rule-detail-close'
        ),
      materializedRuleDetailDone:
        documentObject.getElementById(
          'materialized-rule-detail-done'
        ),
      materializedRuleDetail: {
        name:
          documentObject.getElementById(
            'materialized-rule-detail-name'
          ),
        sku:
          documentObject.getElementById(
            'materialized-rule-detail-sku'
          ),
        decision:
          documentObject.getElementById(
            'materialized-rule-detail-decision'
          ),
        quantity:
          documentObject.getElementById(
            'materialized-rule-detail-quantity'
          ),
        status:
          documentObject.getElementById(
            'materialized-rule-detail-status'
          ),
        source:
          documentObject.getElementById(
            'materialized-rule-detail-source'
          ),
        confidence:
          documentObject.getElementById(
            'materialized-rule-detail-confidence'
          ),
        priority:
          documentObject.getElementById(
            'materialized-rule-detail-priority'
          ),
        eligibility:
          documentObject.getElementById(
            'materialized-rule-detail-eligibility'
          ),
        lifecycle:
          documentObject.getElementById(
            'materialized-rule-detail-lifecycle'
          ),
        created:
          documentObject.getElementById(
            'materialized-rule-detail-created'
          ),
        updated:
          documentObject.getElementById(
            'materialized-rule-detail-updated'
          ),
        safety:
          documentObject.getElementById(
            'materialized-rule-detail-safety'
          ),
      },
      ruleStatusModal:
        documentObject.getElementById('rule-status-modal'),
      ruleStatusForm:
        documentObject.getElementById('rule-status-form'),
      ruleStatusClose:
        documentObject.getElementById('rule-status-close'),
      ruleStatusCancel:
        documentObject.getElementById('rule-status-cancel'),
      ruleStatusSubmit:
        documentObject.getElementById('rule-status-submit'),
      ruleStatusReason:
        documentObject.getElementById('rule-status-reason'),
      ruleStatusComment:
        documentObject.getElementById('rule-status-comment'),
      ruleStatusConfirmation:
        documentObject.getElementById('rule-status-confirmation'),
      ruleStatusError:
        documentObject.getElementById('rule-status-error'),
      ruleStatusProgress:
        documentObject.getElementById('rule-status-progress'),
      ruleStatusContent:
        documentObject.getElementById('rule-status-content'),
      ruleStatusSafetyText:
        documentObject.getElementById('rule-status-safety-text'),
      ruleStatusWarnings:
        documentObject.getElementById('rule-status-warnings'),
      ruleStatusChangedItems:
        documentObject.getElementById('rule-status-changed-items'),
      ruleStatusPreview: {
        item: documentObject.getElementById('rule-status-item'),
        currentStatus:
          documentObject.getElementById('rule-status-current'),
        targetStatus:
          documentObject.getElementById('rule-status-target'),
        decision:
          documentObject.getElementById('rule-status-decision'),
        affectedItems:
          documentObject.getElementById('rule-status-affected'),
        decisionChanges:
          documentObject.getElementById(
            'rule-status-decision-changes'
          ),
        quantityChanges:
          documentObject.getElementById(
            'rule-status-quantity-changes'
          ),
        amountBefore:
          documentObject.getElementById('rule-status-amount-before'),
        amountAfter:
          documentObject.getElementById('rule-status-amount-after'),
        amountDelta:
          documentObject.getElementById('rule-status-amount-delta'),
        unitsBefore:
          documentObject.getElementById('rule-status-units-before'),
        unitsAfter:
          documentObject.getElementById('rule-status-units-after'),
        financialBefore:
          documentObject.getElementById('rule-status-financial-before'),
        financialAfter:
          documentObject.getElementById('rule-status-financial-after'),
        expiresAt:
          documentObject.getElementById('rule-status-expires-at'),
      },
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
    let ownerLearningRequestSequence = 0;
    let historyRequestSequence = 0;
    let candidateRequestSequence = 0;
    let materializedRulesRequestSequence = 0;
    let ruleEffectivenessRequestSequence = 0;
    let knowledgeHealthRequestSequence = 0;
    let currentRunId = null;
    let pendingRuleStatusChange = null;
    let currentCandidates = [];
    let pendingLifecycleChange = null;
    let pendingMaterializationCandidate = null;
    let searchTimer = null;
    const ownerLearningLoaded = {
      DECISION_HISTORY: false,
      CANDIDATES: false,
      MATERIALIZED_RULES: false,
      RULE_EFFECTIVENESS: false,
      KNOWLEDGE_HEALTH: false,
    };
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

    function navigateOwnerLearning(target) {
      const selected = switchOwnerLearningTab(elements, target);
      if (
        Object.hasOwn(ownerLearningLoaded, selected) &&
        ownerLearningLoaded[selected] === false
      ) {
        ownerLearningLoaded[selected] = true;
        ({
          DECISION_HISTORY: loadDecisionHistory,
          CANDIDATES: loadCandidates,
          MATERIALIZED_RULES: loadMaterializedRules,
          RULE_EFFECTIVENESS: loadRuleEffectiveness,
          KNOWLEDGE_HEALTH: loadKnowledgeHealth,
        })[selected]();
      }
      return selected;
    }

    async function loadOwnerLearningCenter() {
      const sequence = ++ownerLearningRequestSequence;
      setOwnerLearningState(elements, 'loading');
      try {
        const result = await requestJson(
          fetchFunction,
          buildOwnerLearningCenterUrl()
        );
        if (sequence !== ownerLearningRequestSequence) return;
        const state = ownerLearningViewState(result);
        if (['ready', 'partial'].includes(state)) {
          renderOwnerLearningCenter(
            documentObject,
            elements,
            result,
            navigateOwnerLearning
          );
        }
        setOwnerLearningState(elements, state);
      } catch (error) {
        if (sequence !== ownerLearningRequestSequence) return;
        setOwnerLearningState(
          elements,
          error instanceof FrontendError &&
            error.code === 'OWNER_LEARNING_CENTER_INVALID_INPUT'
            ? 'invalid'
            : 'network'
        );
      }
    }

    function historyFilters() {
      return {
        supplier: elements.historySupplier.value,
        brand: elements.historyBrand.value,
        ownerDecision: elements.historyDecision.value,
        reasonCode: elements.historyReason.value,
        dateFrom: elements.historyDateFrom.value,
        dateTo: elements.historyDateTo.value,
      };
    }

    async function loadDecisionHistory() {
      const sequence = ++historyRequestSequence;
      setHistoryPanelState(elements, 'loading');
      try {
        const result = await requestJson(
          fetchFunction,
          buildAnalyticsUrl(historyFilters())
        );
        if (sequence !== historyRequestSequence) return;
        const state = analyticsViewState(result);
        if (state === 'ready') {
          renderAnalytics(documentObject, elements, result.data);
        }
        setHistoryPanelState(elements, state);
      } catch (error) {
        if (sequence !== historyRequestSequence) return;
        setHistoryPanelState(
          elements,
          error instanceof FrontendError &&
            error.code === 'OWNER_DECISION_ANALYTICS_INVALID_INPUT'
            ? 'invalid'
            : 'unavailable'
        );
      }
    }

    function candidateFilters() {
      return {
        supplier: elements.candidateSupplier.value,
        brand: elements.candidateBrand.value,
        ownerDecision: elements.candidateDecision.value,
        reasonCode: elements.candidateReason.value,
        dateFrom: elements.candidateDateFrom.value,
        dateTo: elements.candidateDateTo.value,
        eligibility: elements.candidateEligibility.value,
        confidence: elements.candidateConfidence.value,
        priority: elements.candidatePriority.value,
      };
    }

    function closeCandidateLifecycleModal() {
      pendingLifecycleChange = null;
      elements.candidateLifecycleModal.hidden = true;
      elements.candidateModalError.hidden = true;
      elements.candidateModalError.textContent = '';
      elements.candidateModalSubmit.disabled = false;
    }

    function openCandidateLifecycleModal(candidate, action) {
      pendingLifecycleChange = { candidate, action };
      elements.candidateModalCandidate.textContent =
        candidate.displayScope?.primary || '—';
      elements.candidateModalStatus.textContent =
        lifecycleStatusLabel(action.targetStatus);
      elements.candidateModalConfidence.textContent =
        `${formatQuantity(candidate.confidence?.score)} · ` +
        confidenceLabel(candidate.confidence?.level);
      elements.candidateModalPriority.textContent =
        `${formatQuantity(candidate.ranking?.priorityScore)} · ` +
        priorityLabel(candidate.ranking?.priorityLevel);
      elements.candidateModalEligibility.textContent =
        eligibilityLabel(candidate.eligibility?.status);
      elements.candidateModalReason.value =
        action.action === 'APPROVE'
          ? 'READY_FOR_RULE'
          : 'NOT_SPECIFIED';
      elements.candidateModalComment.value = '';
      elements.candidateApproveCheckbox.checked = false;
      elements.candidateApproveConfirmation.hidden =
        action.action !== 'APPROVE';
      elements.candidateModalError.hidden = true;
      elements.candidateModalError.textContent = '';
      elements.candidateLifecycleModal.hidden = false;
      if (typeof elements.candidateModalReason.focus === 'function') {
        elements.candidateModalReason.focus();
      }
    }

    function closeRuleMaterializationModal() {
      pendingMaterializationCandidate = null;
      elements.ruleMaterializationModal.hidden = true;
      elements.ruleMaterializationError.hidden = true;
      elements.ruleMaterializationError.textContent = '';
      elements.ruleMaterializationSubmit.disabled = false;
    }

    function openRuleMaterializationModal(candidate) {
      pendingMaterializationCandidate = candidate;
      elements.ruleMaterializationCandidate.textContent =
        candidate.displayScope?.primary || '—';
      elements.ruleMaterializationDecision.textContent =
        decisionLabel(candidate.proposedAction?.decision);
      elements.ruleMaterializationConfidence.textContent =
        `${formatQuantity(candidate.confidence?.score)} · ` +
        confidenceLabel(candidate.confidence?.level);
      elements.ruleMaterializationPriority.textContent =
        `${formatQuantity(candidate.ranking?.priorityScore)} · ` +
        priorityLabel(candidate.ranking?.priorityLevel);
      elements.ruleMaterializationEligibility.textContent =
        eligibilityLabel(candidate.eligibility?.status);
      elements.ruleMaterializationCheckbox.checked = false;
      elements.ruleMaterializationError.hidden = true;
      elements.ruleMaterializationError.textContent = '';
      elements.ruleMaterializationModal.hidden = false;
    }

    function renderCurrentCandidates() {
      const candidates = filterCandidates(
        currentCandidates,
        candidateFilters()
      );
      renderCandidateCards(
        documentObject,
        elements.candidateList,
        candidates,
        openCandidateLifecycleModal,
        openRuleMaterializationModal
      );
      setCandidatePanelState(
        elements,
        candidates.length > 0 ? 'ready' : 'no-results'
      );
    }

    async function submitCandidateLifecycle(event) {
      event.preventDefault();
      if (!pendingLifecycleChange) return;
      elements.candidateModalError.hidden = true;
      elements.candidateModalSubmit.disabled = true;
      try {
        const payload = buildLifecyclePayload(
          pendingLifecycleChange.action,
          {
            reasonCode: elements.candidateModalReason.value,
            ownerComment: elements.candidateModalComment.value,
            approvedConfirmed:
              elements.candidateApproveCheckbox.checked === true,
          }
        );
        const result = await requestJson(
          fetchFunction,
          buildLifecycleStatusUrl(
            pendingLifecycleChange.candidate.candidateId
          ),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        const candidate = currentCandidates.find(value =>
          value.candidateId === result.candidate_id
        );
        if (candidate) {
          candidate.lifecycle = {
            status: result.status,
            lastAction: result.last_event?.action || null,
            lastRecordedAt:
              result.last_event?.recorded_at || null,
            reasonCode:
              result.last_event?.reason_code || null,
          };
        }
        elements.candidateActionStatus.textContent = result.duplicate
          ? 'Статус уже был сохранён; дубль не создан.'
          : 'Статус кандидата обновлён.';
        closeCandidateLifecycleModal();
        renderCurrentCandidates();
      } catch (error) {
        const code = error instanceof FrontendError
          ? error.code
          : 'NETWORK_ERROR';
        elements.candidateModalError.textContent =
          lifecycleErrorMessage(code);
        elements.candidateModalError.hidden = false;
        elements.candidateModalSubmit.disabled = false;
      }
    }

    async function submitRuleMaterialization(event) {
      event.preventDefault();
      if (!pendingMaterializationCandidate) return;
      elements.ruleMaterializationError.hidden = true;
      elements.ruleMaterializationSubmit.disabled = true;
      try {
        const payload = buildMaterializationPayload(
          elements.ruleMaterializationCheckbox.checked === true
        );
        const result = await requestJson(
          fetchFunction,
          buildMaterializationUrl(
            pendingMaterializationCandidate.candidateId
          ),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        const candidate = currentCandidates.find(value =>
          value.candidateId === result.candidate_id
        );
        if (candidate) {
          candidate.materialization = {
            status: 'MATERIALIZED',
            ruleId: result.rule?.rule_id || null,
            ruleStatus: result.rule?.status || null,
            materializedAt: result.rule?.created_at || null,
          };
        }
        elements.candidateActionStatus.textContent =
          result.status === 'ALREADY_MATERIALIZED'
            ? 'Неактивное правило уже было создано ранее.'
            : 'Неактивное правило создано.';
        closeRuleMaterializationModal();
        renderCurrentCandidates();
      } catch (error) {
        const code = error instanceof FrontendError
          ? error.code
          : 'NETWORK_ERROR';
        elements.ruleMaterializationError.textContent =
          lifecycleErrorMessage(code);
        elements.ruleMaterializationError.hidden = false;
        elements.ruleMaterializationSubmit.disabled = false;
      }
    }

    async function loadCandidates() {
      const sequence = ++candidateRequestSequence;
      const filters = candidateFilters();
      setCandidatePanelState(elements, 'loading');
      try {
        const result = await requestJson(
          fetchFunction,
          buildCandidatesUrl(filters)
        );
        if (sequence !== candidateRequestSequence) return;
        const state = candidateViewState(result);
        if (state !== 'ready') {
          renderCandidateCards(
            documentObject,
            elements.candidateList,
            []
          );
          setCandidatePanelState(elements, state);
          return;
        }
        const candidates = filterCandidates(
          result.candidates,
          filters
        );
        currentCandidates = result.candidates;
        elements.candidateActionStatus.textContent =
          result.lifecycle_warning
            ? ERROR_MESSAGES.OWNER_LEARNING_LIFECYCLE_UNAVAILABLE
            : '';
        if (candidates.length === 0) {
          renderCandidateCards(
            documentObject,
            elements.candidateList,
            []
          );
          setCandidatePanelState(elements, 'no-results');
          return;
        }
        renderCandidateSummary(elements, result.summary);
        renderCandidateCards(
          documentObject,
          elements.candidateList,
          candidates,
          openCandidateLifecycleModal,
          openRuleMaterializationModal
        );
        setCandidatePanelState(elements, 'ready');
      } catch (error) {
        if (sequence !== candidateRequestSequence) return;
        setCandidatePanelState(
          elements,
          error instanceof FrontendError &&
            error.code ===
              'OWNER_LEARNING_CANDIDATES_INVALID_INPUT'
            ? 'invalid'
            : 'unavailable'
        );
      }
    }

    function materializedRulesFilters() {
      return {
        status: elements.materializedRulesStatus.value,
        decision: elements.materializedRulesDecision.value,
        confidenceLevel:
          elements.materializedRulesConfidence.value,
        priorityLevel: elements.materializedRulesPriority.value,
        lifecycleStatus:
          elements.materializedRulesLifecycle.value,
        candidateAvailability:
          elements.materializedRulesAvailability.value,
        dateFrom: elements.materializedRulesDateFrom.value,
        dateTo: elements.materializedRulesDateTo.value,
        search: elements.materializedRulesSearch.value,
      };
    }

    function ruleEffectivenessFilters() {
      return {
        ruleStatus: elements.ruleEffectivenessStatus.value,
        decision: elements.ruleEffectivenessDecision.value,
        classification:
          elements.ruleEffectivenessClassification.value,
        confidenceLevel:
          elements.ruleEffectivenessConfidence.value,
        priorityLevel:
          elements.ruleEffectivenessPriority.value,
        dateFrom: elements.ruleEffectivenessDateFrom.value,
        dateTo: elements.ruleEffectivenessDateTo.value,
        search: elements.ruleEffectivenessSearch.value,
      };
    }

    function knowledgeHealthFilters() {
      return {
        status: elements.knowledgeHealthStatus.value,
        decision: elements.knowledgeHealthDecision.value,
        grade: elements.knowledgeHealthGrade.value,
        classification:
          elements.knowledgeHealthClassification.value,
        severity: elements.knowledgeHealthSeverity.value,
        findingType: elements.knowledgeHealthFindingType.value,
        confidenceLevel: elements.knowledgeHealthConfidence.value,
        priorityLevel: elements.knowledgeHealthPriority.value,
        search: elements.knowledgeHealthSearch.value,
      };
    }

    function closeRuleEffectivenessDetail() {
      elements.ruleEffectivenessDetailModal.hidden = true;
      elements.ruleEffectivenessDetailContent.hidden = true;
      elements.ruleEffectivenessDetailState.textContent = '';
    }

    async function openRuleEffectivenessDetail(rule) {
      elements.ruleEffectivenessDetailModal.hidden = false;
      elements.ruleEffectivenessDetailContent.hidden = true;
      elements.ruleEffectivenessDetailState.textContent =
        'Загружаем подробную аналитику…';
      try {
        const [detail, events] = await Promise.all([
          requestJson(
            fetchFunction,
            buildRuleEffectivenessDetailUrl(rule.ruleId)
          ),
          requestJson(
            fetchFunction,
            buildRuleEffectivenessEventsUrl(rule.ruleId)
          ),
        ]);
        renderRuleEffectivenessDetail(
          documentObject,
          elements,
          detail,
          events
        );
        elements.ruleEffectivenessDetailState.textContent = '';
        elements.ruleEffectivenessDetailContent.hidden = false;
      } catch {
        elements.ruleEffectivenessDetailState.textContent =
          'Подробная аналитика временно недоступна.';
      }
    }

    function closeMaterializedRuleDetail() {
      elements.materializedRuleDetailModal.hidden = true;
    }

    function openMaterializedRuleDetail(rule) {
      renderMaterializedRuleDetail(elements, rule);
      elements.materializedRuleDetailModal.hidden = false;
    }

    function closeRuleStatusModal() {
      pendingRuleStatusChange = null;
      elements.ruleStatusModal.hidden = true;
      elements.ruleStatusError.hidden = true;
      elements.ruleStatusError.textContent = '';
      elements.ruleStatusProgress.hidden = true;
      elements.ruleStatusContent.hidden = true;
      elements.ruleStatusSubmit.disabled = false;
    }

    async function openRuleStatusPreview(rule) {
      const targetStatus = rule.status === 'ACTIVE'
        ? 'DISABLED'
        : 'ACTIVE';
      pendingRuleStatusChange = { rule, targetStatus, preview: null };
      elements.ruleStatusModal.hidden = false;
      elements.ruleStatusProgress.hidden = false;
      elements.ruleStatusProgress.textContent =
        'Выполняем проверочный расчёт последствий…';
      elements.ruleStatusContent.hidden = true;
      elements.ruleStatusError.hidden = true;
      elements.ruleStatusError.textContent = '';
      elements.ruleStatusSubmit.disabled = true;
      elements.ruleStatusConfirmation.checked = false;
      elements.ruleStatusComment.value = '';
      elements.ruleStatusReason.value = targetStatus === 'ACTIVE'
        ? 'READY_TO_APPLY'
        : 'TEMPORARILY_DISABLE';
      if (!currentRunId) {
        elements.ruleStatusProgress.hidden = true;
        elements.ruleStatusError.textContent =
          ruleStatusErrorMessage('RUN_REQUIRED');
        elements.ruleStatusError.hidden = false;
        return;
      }
      try {
        const result = await requestJson(
          fetchFunction,
          buildRuleStatusPreviewUrl(rule.ruleId),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildRuleStatusPreviewPayload(
              targetStatus,
              currentRunId
            )),
          }
        );
        if (
          !pendingRuleStatusChange ||
          pendingRuleStatusChange.rule.ruleId !== rule.ruleId
        ) {
          return;
        }
        pendingRuleStatusChange.preview = result.preview;
        renderRuleStatusPreview(
          documentObject,
          elements,
          result.preview
        );
        elements.ruleStatusProgress.hidden = true;
        elements.ruleStatusContent.hidden = false;
        if (result.preview?.impact?.financially_permitted !== true) {
          elements.ruleStatusError.textContent =
            ruleStatusErrorMessage(
              'RULE_ACTIVATION_NOT_FINANCIALLY_PERMITTED'
            );
          elements.ruleStatusError.hidden = false;
          elements.ruleStatusSubmit.disabled = true;
        } else {
          elements.ruleStatusSubmit.disabled = false;
        }
      } catch (error) {
        const code = error instanceof FrontendError
          ? error.code
          : 'NETWORK_ERROR';
        elements.ruleStatusProgress.hidden = true;
        elements.ruleStatusError.textContent =
          ruleStatusErrorMessage(code);
        elements.ruleStatusError.hidden = false;
      }
    }

    async function submitRuleStatusChange(event) {
      event.preventDefault();
      const pending = pendingRuleStatusChange;
      if (!pending?.preview) return;
      if (elements.ruleStatusConfirmation.checked !== true) {
        elements.ruleStatusError.textContent =
          ruleStatusErrorMessage(
            'OWNER_RULE_STATUS_CONFIRMATION_REQUIRED'
          );
        elements.ruleStatusError.hidden = false;
        return;
      }
      elements.ruleStatusError.hidden = true;
      elements.ruleStatusSubmit.disabled = true;
      try {
        const payload = buildRuleStatusPayload({
          targetStatus: pending.targetStatus,
          previewId: pending.preview.preview_id,
          confirmation: true,
          reasonCode: elements.ruleStatusReason.value,
          ownerComment: elements.ruleStatusComment.value,
        });
        const result = await requestJson(
          fetchFunction,
          buildRuleStatusUrl(pending.rule.ruleId),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        elements.ruleStatusProgress.textContent =
          result.status === 'ALREADY_CHANGED'
            ? 'Статус уже был изменён; повторное переключение не выполнено.'
            : result.message;
        elements.ruleStatusProgress.hidden = false;
        elements.ruleStatusContent.hidden = true;
        await loadMaterializedRules();
      } catch (error) {
        const code = error instanceof FrontendError
          ? error.code
          : 'NETWORK_ERROR';
        elements.ruleStatusError.textContent =
          ruleStatusErrorMessage(code);
        elements.ruleStatusError.hidden = false;
        elements.ruleStatusSubmit.disabled = false;
      }
    }

    function materializedRulesWarningText(result) {
      if (
        result?.warning ===
        'OWNER_RULE_MATERIALIZATION_HISTORY_UNAVAILABLE'
      ) {
        return 'История создания правил временно недоступна. ' +
          'Текущее состояние правил показано из реестра.';
      }
      if (
        result?.warning === 'OWNER_RULE_STATUS_HISTORY_UNAVAILABLE'
      ) {
        return 'Журнал статусов временно недоступен. Текущий статус ' +
          'показан из реестра правил.';
      }
      if (
        result?.warning ===
          'OWNER_MATERIALIZED_RULES_CANDIDATE_CONTEXT_UNAVAILABLE' ||
        result?.warning ===
          'OWNER_MATERIALIZED_RULES_LIFECYCLE_CONTEXT_UNAVAILABLE'
      ) {
        return 'Текущий контекст кандидатов временно недоступен. ' +
          'Созданные правила продолжают отображаться.';
      }
      return '';
    }

    async function loadMaterializedRules() {
      const sequence = ++materializedRulesRequestSequence;
      const filters = materializedRulesFilters();
      setMaterializedRulesPanelState(elements, 'loading');
      try {
        const result = await requestJson(
          fetchFunction,
          buildMaterializedRulesUrl(filters)
        );
        if (sequence !== materializedRulesRequestSequence) return;
        const state = materializedRulesViewState(result, filters);
        if (state !== 'ready') {
          renderMaterializedRuleCards(
            documentObject,
            elements.materializedRulesList,
            []
          );
          setMaterializedRulesPanelState(elements, state);
          return;
        }
        renderMaterializedRulesSummary(elements, result.summary);
        renderMaterializedRuleCards(
          documentObject,
          elements.materializedRulesList,
          result.rules,
          openMaterializedRuleDetail,
          openRuleStatusPreview
        );
        const warning = materializedRulesWarningText(result);
        elements.materializedRulesContextWarning.textContent = warning;
        elements.materializedRulesContextWarning.hidden = !warning;
        setMaterializedRulesPanelState(elements, 'ready');
      } catch (error) {
        if (sequence !== materializedRulesRequestSequence) return;
        setMaterializedRulesPanelState(
          elements,
          error instanceof FrontendError &&
            error.code ===
              'OWNER_MATERIALIZED_RULES_INVALID_INPUT'
            ? 'invalid'
            : 'network'
        );
      }
    }

    async function loadRuleEffectiveness() {
      const sequence = ++ruleEffectivenessRequestSequence;
      const filters = ruleEffectivenessFilters();
      setRuleEffectivenessPanelState(elements, 'loading');
      try {
        const result = await requestJson(
          fetchFunction,
          buildRuleEffectivenessUrl(filters)
        );
        if (sequence !== ruleEffectivenessRequestSequence) return;
        const state = ruleEffectivenessViewState(result, filters);
        if (state !== 'ready') {
          renderRuleEffectivenessRows(
            documentObject,
            elements.ruleEffectivenessBody,
            []
          );
          setRuleEffectivenessPanelState(elements, state);
          return;
        }
        renderRuleEffectivenessSummary(elements, result.summary);
        renderRuleEffectivenessRows(
          documentObject,
          elements.ruleEffectivenessBody,
          result.rules,
          openRuleEffectivenessDetail
        );
        setRuleEffectivenessPanelState(elements, 'ready');
      } catch (error) {
        if (sequence !== ruleEffectivenessRequestSequence) return;
        setRuleEffectivenessPanelState(
          elements,
          error instanceof FrontendError &&
            error.code ===
              'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT'
            ? 'invalid'
            : 'network'
        );
      }
    }

    async function loadKnowledgeHealth() {
      const sequence = ++knowledgeHealthRequestSequence;
      const filters = knowledgeHealthFilters();
      setKnowledgeHealthPanelState(elements, 'loading');
      try {
        const result = await requestJson(
          fetchFunction,
          buildKnowledgeHealthUrl(filters)
        );
        if (sequence !== knowledgeHealthRequestSequence) return;
        const state = knowledgeHealthViewState(result, filters);
        if (['ready', 'partial'].includes(state)) {
          renderKnowledgeHealth(
            documentObject,
            elements,
            result,
            navigateOwnerLearning
          );
        } else {
          elements.knowledgeHealthFindings.replaceChildren();
          elements.knowledgeHealthRules.replaceChildren();
        }
        setKnowledgeHealthPanelState(elements, state);
      } catch (error) {
        if (sequence !== knowledgeHealthRequestSequence) return;
        setKnowledgeHealthPanelState(
          elements,
          error instanceof FrontendError &&
            error.code === 'OWNER_KNOWLEDGE_HEALTH_INVALID_INPUT'
            ? 'invalid'
            : 'network'
        );
      }
    }

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

        currentRunId = typeof status?.run_id === 'string'
          ? status.run_id
          : null;

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
    for (const tab of elements.ownerLearningTabs) {
      tab.addEventListener('click', () => {
        navigateOwnerLearning(tab.dataset.ownerLearningTarget);
      });
    }
    elements.historyForm.addEventListener('submit', event => {
      event.preventDefault();
      loadDecisionHistory();
    });
    elements.candidateForm.addEventListener('submit', event => {
      event.preventDefault();
      loadCandidates();
    });
    elements.candidateReset.addEventListener('click', () => {
      resetCandidateFilters(elements);
      loadCandidates();
    });
    elements.materializedRulesForm.addEventListener('submit', event => {
      event.preventDefault();
      loadMaterializedRules();
    });
    elements.materializedRulesReset.addEventListener('click', () => {
      resetMaterializedRulesFilters(elements);
      loadMaterializedRules();
    });
    elements.ruleEffectivenessForm.addEventListener('submit', event => {
      event.preventDefault();
      loadRuleEffectiveness();
    });
    elements.ruleEffectivenessReset.addEventListener('click', () => {
      resetRuleEffectivenessFilters(elements);
      loadRuleEffectiveness();
    });
    elements.knowledgeHealthForm.addEventListener('submit', event => {
      event.preventDefault();
      loadKnowledgeHealth();
    });
    elements.knowledgeHealthReset.addEventListener('click', () => {
      resetKnowledgeHealthFilters(elements);
      loadKnowledgeHealth();
    });
    elements.ruleEffectivenessDetailClose.addEventListener(
      'click',
      closeRuleEffectivenessDetail
    );
    elements.ruleEffectivenessDetailDone.addEventListener(
      'click',
      closeRuleEffectivenessDetail
    );
    elements.materializedRuleDetailClose.addEventListener(
      'click',
      closeMaterializedRuleDetail
    );
    elements.materializedRuleDetailDone.addEventListener(
      'click',
      closeMaterializedRuleDetail
    );
    elements.ruleStatusForm.addEventListener(
      'submit',
      submitRuleStatusChange
    );
    elements.ruleStatusClose.addEventListener(
      'click',
      closeRuleStatusModal
    );
    elements.ruleStatusCancel.addEventListener(
      'click',
      closeRuleStatusModal
    );
    elements.candidateLifecycleForm.addEventListener(
      'submit',
      submitCandidateLifecycle
    );
    elements.candidateModalClose.addEventListener(
      'click',
      closeCandidateLifecycleModal
    );
    elements.candidateModalCancel.addEventListener(
      'click',
      closeCandidateLifecycleModal
    );
    elements.ruleMaterializationForm.addEventListener(
      'submit',
      submitRuleMaterialization
    );
    elements.ruleMaterializationClose.addEventListener(
      'click',
      closeRuleMaterializationModal
    );
    elements.ruleMaterializationCancel.addEventListener(
      'click',
      closeRuleMaterializationModal
    );
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
        closeCandidateLifecycleModal();
        closeRuleMaterializationModal();
        closeMaterializedRuleDetail();
        closeRuleEffectivenessDetail();
        closeRuleStatusModal();
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
    navigateOwnerLearning('OVERVIEW');
    loadOwnerLearningCenter();
    return {
      activateItems,
      loadCandidates,
      loadDecisionHistory,
      loadOwnerLearningCenter,
      loadMaterializedRules,
      loadRuleEffectiveness,
      loadItems,
      openCandidateLifecycleModal,
      openMaterializedRuleDetail,
      openRuleEffectivenessDetail,
      openRuleStatusPreview,
      openRuleMaterializationModal,
      navigateOwnerLearning,
      submitRuleMaterialization,
      submitCandidateLifecycle,
      submitRun,
      submitRuleStatusChange,
      updateFileSelection,
    };
  }

  const publicApi = {
    FrontendError,
    analyticsViewState,
    buildAnalyticsUrl,
    buildCandidatesUrl,
    buildOwnerLearningCenterUrl,
    buildKnowledgeHealthUrl,
    buildDecisionUrl,
    buildItemsUrl,
    buildLifecyclePayload,
    buildLifecycleStatusUrl,
    buildMaterializedRulesUrl,
    buildRuleEffectivenessDetailUrl,
    buildRuleEffectivenessEventsUrl,
    buildRuleEffectivenessUrl,
    buildMaterializationPayload,
    buildMaterializationUrl,
    buildRuleStatusPayload,
    buildRuleStatusPreviewPayload,
    buildRuleStatusPreviewUrl,
    buildRuleStatusUrl,
    candidateLifecycleActions,
    candidateViewState,
    confidenceLabel,
    createCandidateCard,
    createActivityCard,
    createAttentionCard,
    createMaterializedRuleCard,
    createKnowledgeHealthFinding,
    createKnowledgeHealthRuleRow,
    createRuleEffectivenessRow,
    createItemRow,
    createItemRows,
    createApplication,
    decisionCounterView,
    decisionLabel,
    defaultDecisionFilter,
    eligibilityLabel,
    filterCandidates,
    formatDuration,
    formatHistoryDate,
    formatHistoryDateTime,
    formatPercent,
    formatQuantity,
    formatRub,
    formatSignedRub,
    formatSignedQuantity,
    itemMatchesDecisionFilter,
    itemStatusView,
    lifecycleStatusLabel,
    lifecycleErrorMessage,
    matrixRoleLabel,
    materializedRuleSafetyLabel,
    materializedRuleStatusPreviewLabel,
    materializedRuleStatusLabel,
    materializedRulesViewState,
    knowledgeHealthClassificationLabel,
    knowledgeHealthGradeLabel,
    knowledgeHealthSeverityLabel,
    knowledgeHealthViewState,
    needsOwnerDecisionView,
    ownerActionLabel,
    ownerLearningViewState,
    ownerDecisionView,
    paginationLabel,
    patternLabel,
    priorityLabel,
    plainReason,
    pollRunStatus,
    recommendedLineValue,
    recommendedQuantity,
    renderAnalytics,
    renderCandidateCards,
    renderCandidateSummary,
    renderMaterializedRuleCards,
    renderMaterializedRuleDetail,
    renderKnowledgeHealth,
    renderMaterializedRulesSummary,
    renderOwnerLearningActivity,
    renderOwnerLearningAttention,
    renderOwnerLearningCenter,
    renderOwnerLearningHealth,
    renderOwnerLearningSections,
    renderOwnerLearningSummary,
    renderRuleEffectivenessDetail,
    renderRuleEffectivenessRows,
    renderRuleEffectivenessSummary,
    renderRuleStatusPreview,
    renderItemRows,
    resetCandidateFilters,
    resetMaterializedRulesFilters,
    resetKnowledgeHealthFilters,
    resetRuleEffectivenessFilters,
    requestNeedsDecisionItems,
    requestJson,
    safeArtifactDownloadUrl,
    safeRunLink,
    selectArtifacts,
    setCandidatePanelState,
    setHistoryPanelState,
    setMaterializedRulesPanelState,
    setKnowledgeHealthPanelState,
    setOwnerLearningState,
    setRuleEffectivenessPanelState,
    setProductsPanelState,
    summaryView,
    switchOwnerLearningTab,
    shouldShowMaterialize,
    reasonLabel,
    ruleStatusErrorMessage,
    ruleEffectStatusLabel,
    ruleEffectivenessClassificationLabel,
    ruleEffectivenessCodeLabel,
    ruleEffectivenessViewState,
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
