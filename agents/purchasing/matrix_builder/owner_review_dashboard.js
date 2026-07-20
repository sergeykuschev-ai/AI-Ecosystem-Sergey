const {
  REASON_EXPLANATIONS,
} = require('./matrix_builder_validator');

const DEFAULT_OWNER_REVIEW_POLICY = Object.freeze({
  max_owner_action_items: 30,
  max_data_quality_examples: 20,
  approved_conflict_score: 100,
  critical_inventory_score: 80,
  large_inventory_score: 60,
  exit_candidate_score: 50,
  strategic_item_score: 40,
  commercial_review_score: 30,
  missing_price_risk_score: 25,
  insufficient_data_score: 10,
  identity_only_score: 5,
});

const BUSINESS_PRIORITY = Object.freeze({
  critical: 0,
  important: 1,
  review: 2,
  standard: 3,
});

const OWNER_PRIORITY = Object.freeze({ P1: 0, P2: 1, P3: 2, NONE: 3 });

const CATEGORY_PROFILE_LABELS = Object.freeze({
  durable: 'Длительный ассортимент',
  default_consumable: 'Расходный товар',
  small_consumable: 'Мелкий расходник',
  slow_specialized: 'Медленный специализированный товар',
  medical_and_care: 'Медицинские товары и уход',
});

function display(value, fallback = 'нет данных') {
  return value === null || value === undefined || value === ''
    ? fallback
    : String(value);
}

function markdown(value) {
  return display(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function formatNumber(value, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'нет данных';
  const fixed = value.toFixed(digits);
  const [integer, fraction] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return digits === 0 ? grouped : `${grouped},${fraction}`;
}

function formatCurrency(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${formatNumber(value)} ₽`
    : 'нет данных';
}

function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  if (rows.length === 0) {
    lines.push(`| ${headers.map((_, index) => index === 0 ? '—' : '').join(' | ')} |`);
    return lines;
  }
  rows.forEach(row => lines.push(`| ${row.map(markdown).join(' | ')} |`));
  return lines;
}

function itemKey(item) {
  return display(item.article, `строка ${item.source_row_number}`);
}

function categoryText(item) {
  if (item.category) return item.category;
  const profile = item.evidence?.category_profile;
  return CATEGORY_PROFILE_LABELS[profile] || display(profile);
}

function hasQueue(item, queue) {
  return item.review_queue_memberships?.includes(queue) === true;
}

function hasReason(item, reason) {
  return item.reason_codes?.includes(reason) === true;
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function yesNo(value) {
  return value ? '✅ Да' : '➖ Нет';
}

function approvedPolicy(item) {
  return item.existing_policy?.policy_status === 'approved';
}

function reasonTexts(item, preferredCodes = null) {
  const codes = Array.isArray(item.reason_codes) ? item.reason_codes : [];
  const preferred = preferredCodes
    ? new Set(preferredCodes)
    : new Set(Array.isArray(item.manual_review_reasons)
      ? item.manual_review_reasons
      : []);
  const selectedCodes = preferred.size > 0
    ? codes.filter(code => preferred.has(code))
    : codes;
  const resolved = (selectedCodes.length > 0 ? selectedCodes : codes)
    .map(code => REASON_EXPLANATIONS[code] || code);
  return Array.from(new Set(resolved));
}

function reasonSummary(item, limit = 3, preferredCodes = null) {
  const reasons = reasonTexts(item, preferredCodes);
  return reasons.length > 0
    ? `${reasons
      .slice(0, limit)
      .map(reason => reason.replace(/[.;:]+$/g, ''))
      .join('; ')}.`
    : 'Требуется решение владельца.';
}

function strategicItem(item) {
  return (item.evidence?.strategic_group_matches || []).length > 0 ||
    hasReason(item, 'strategic_brand_group') ||
    hasReason(item, 'exit_blocked_strategic_policy');
}

function strategicExitRisk(item) {
  return hasReason(item, 'exit_blocked_strategic_policy');
}

function identityOnlyIssue(item) {
  return hasQueue(item, 'identity_remediation') &&
    !hasQueue(item, 'commercial_review') &&
    !hasQueue(item, 'large_inventory_review') &&
    item.suggested_role !== 'EXIT' &&
    !item.approved_policy_conflict;
}

function scoreOwnerReviewItem(item, ownerPolicy = DEFAULT_OWNER_REVIEW_POLICY) {
  let score = 0;
  const reasons = [];
  const add = (condition, field, reason) => {
    if (!condition) return;
    score += ownerPolicy[field];
    reasons.push(reason);
  };
  const criticalInventory = item.inventory_value_review_level === 'critical';
  const largeInventory = hasQueue(item, 'large_inventory_review');
  const missingPriceRisk = hasReason(item, 'missing_purchase_price') && largeInventory;
  const identityOnly = identityOnlyIssue(item);

  add(item.approved_policy_conflict, 'approved_conflict_score', 'approved_policy_conflict');
  if (criticalInventory) {
    add(true, 'critical_inventory_score', 'critical_inventory_value');
  } else {
    add(largeInventory, 'large_inventory_score', 'large_inventory_review');
  }
  add(item.suggested_role === 'EXIT', 'exit_candidate_score', 'exit_candidate');
  add(strategicItem(item), 'strategic_item_score', 'strategic_item');
  add(hasQueue(item, 'commercial_review'), 'commercial_review_score', 'commercial_review');
  add(missingPriceRisk, 'missing_price_risk_score', 'missing_price_risk');
  add(hasQueue(item, 'insufficient_data'), 'insufficient_data_score', 'insufficient_data');
  add(identityOnly, 'identity_only_score', 'identity_only_issue');

  let priority = 'NONE';
  if (item.approved_policy_conflict || criticalInventory || strategicExitRisk(item)) {
    priority = 'P1';
  } else if (
    item.suggested_role === 'EXIT' ||
    largeInventory ||
    hasQueue(item, 'commercial_review')
  ) {
    priority = 'P2';
  } else if (score > 0) {
    priority = 'P3';
  }
  return {
    owner_review_score: score,
    owner_review_priority: priority,
    owner_review_reasons: reasons,
    owner_action_required: priority === 'P1' || priority === 'P2',
  };
}

function compareOwnerItems(left, right) {
  const leftConflict = left.item.approved_policy_conflict ? 0 : 1;
  const rightConflict = right.item.approved_policy_conflict ? 0 : 1;
  return (
    (OWNER_PRIORITY[left.review.owner_review_priority] ?? 9) -
      (OWNER_PRIORITY[right.review.owner_review_priority] ?? 9) ||
    leftConflict - rightConflict ||
    right.review.owner_review_score - left.review.owner_review_score ||
    (BUSINESS_PRIORITY[left.item.suggested_priority] ?? 9) -
      (BUSINESS_PRIORITY[right.item.suggested_priority] ?? 9) ||
    (left.item.source_row_number ?? Number.MAX_SAFE_INTEGER) -
      (right.item.source_row_number ?? Number.MAX_SAFE_INTEGER)
  );
}

function recommendedAction(item) {
  if (item.approved_policy_conflict) return 'проверить minimum/target/maximum';
  if (strategicExitRisk(item)) return 'подтвердить стратегическую защиту';
  if (item.suggested_role === 'EXIT') return 'утвердить EXIT';
  if (hasQueue(item, 'large_inventory_review')) {
    return 'проверить minimum/target/maximum';
  }
  if (hasReason(item, 'strategic_low_demand')) return 'оставить в ассортименте';
  if (hasReason(item, 'exit_blocked_approved_policy')) return 'отменить EXIT';
  if (
    hasReason(item, 'growth_cap_applied') ||
    hasReason(item, 'short_long_trend_conflict')
  ) return 'проверить minimum/target/maximum';
  if (item.suggested_role === 'CORE' || item.suggested_role === 'UNCLASSIFIED') {
    return 'подтвердить роль';
  }
  if (hasQueue(item, 'insufficient_data') || hasQueue(item, 'identity_remediation')) {
    return 'проверить данные';
  }
  return 'наблюдать';
}

function selectTopPriorityItems(
  items,
  ownerPolicy = DEFAULT_OWNER_REVIEW_POLICY
) {
  return items
    .map(item => ({ item, review: scoreOwnerReviewItem(item, ownerPolicy) }))
    .filter(entry => entry.review.owner_action_required)
    .sort(compareOwnerItems)
    .slice(0, ownerPolicy.max_owner_action_items)
    .map(entry => entry.item);
}

function latestSalesText(item) {
  const weeklySales = Array.isArray(item.evidence?.weekly_sales)
    ? item.evidence.weekly_sales
    : [];
  const latest = weeklySales
    .filter(period => positive(period.quantity))
    .sort((left, right) =>
      display(right.periodEnd, '').localeCompare(display(left.periodEnd, ''))
    )[0];
  if (latest) return `${display(latest.periodEnd || latest.periodStart)} (${latest.quantity} шт.)`;
  const horizon = item.evidence?.exit_evaluation?.horizonWeeks;
  return horizon
    ? `нет продаж за ${horizon} завершённых недель`
    : 'продажи не зафиксированы в доступном окне';
}

function salesForWindow(item, averageField, weeks) {
  const average = item.evidence?.[averageField];
  if (typeof average !== 'number' || !Number.isFinite(average)) return 'нет данных';
  return formatNumber(average * weeks, 2);
}

function salesForLongTerm(item) {
  const average = item.evidence?.long_term_average;
  const weeks = item.evidence?.total_completed_weeks_available;
  if (
    typeof average !== 'number' || !Number.isFinite(average) ||
    typeof weeks !== 'number' || !Number.isFinite(weeks)
  ) return 'нет данных';
  return formatNumber(average * Math.min(weeks, 26), 2);
}

function policyText(policy) {
  if (!policy) return 'нет политики';
  return [
    `priority ${display(policy.priority)}`,
    `min ${display(policy.minimum_shelf_stock)}`,
    `target ${display(policy.target_stock)}`,
    `max ${display(policy.maximum_stock)}`,
  ].join(', ');
}

function policyDifferences(item) {
  const current = item.existing_policy || {};
  const suggested = item.suggested_policy || {};
  const labels = {
    priority: 'priority',
    minimum_shelf_stock: 'minimum',
    target_stock: 'target',
    maximum_stock: 'maximum',
  };
  return Object.entries(labels)
    .filter(([field]) => current[field] !== suggested[field])
    .map(([field, label]) =>
      `${label}: ${display(current[field])} → ${display(suggested[field])}`
    )
    .join('; ') || 'различий нет';
}

function policyStatus(item) {
  return item.existing_policy?.policy_status || 'нет действующей политики';
}

function coreHighlights(item) {
  const values = [];
  if (approvedPolicy(item)) values.push('✅ approved');
  if (strategicItem(item)) values.push('🧭 strategic');
  if (hasQueue(item, 'large_inventory_review')) values.push('💰 large inventory');
  if (hasReason(item, 'growth_cap_applied')) values.push('📈 growth cap');
  if (hasQueue(item, 'insufficient_data')) values.push('⚠️ incomplete data');
  return values.join('<br>') || '—';
}

function coreReason(item) {
  return reasonSummary(item, 3, [
    'stable_sales',
    'regular_weekly_sales',
    'high_abc_rank',
    'stable_xyz_rank',
    'strategic_brand_group',
    'existing_matrix_policy',
  ]);
}

function reviewQueues(item) {
  return (item.review_queue_memberships || []).join(', ') || 'нет';
}

function stockFormula(item) {
  const formula = item.evidence?.policy_formula;
  if (!formula) return 'нет данных';
  return display(formula.maximum_stock || formula.target_stock);
}

function dataQualityGroups(items) {
  return {
    'Missing article': items.filter(item => !item.article),
    'Ambiguous identity': items.filter(item =>
      item.data_quality?.identity_ambiguous || hasReason(item, 'ambiguous_identity')
    ),
    'Missing purchase price': items.filter(item =>
      item.evidence?.purchase_price === null || hasReason(item, 'missing_purchase_price')
    ),
    'Missing stock data': items.filter(item =>
      item.data_quality?.missing_fields?.includes('free_stock') ||
      item.data_quality?.missing_fields?.includes('stock_days')
    ),
    'Insufficient sales history': items.filter(item =>
      item.data_quality?.stock_policy_status !== 'calculated' ||
      item.data_quality?.missing_fields?.includes('completed_weekly_sales')
    ),
    'Incomplete supplier data': items.filter(item =>
      item.evidence?.supplier_need_qty === null ||
      item.evidence?.supplier_recommended_qty === null
    ),
  };
}

function commercialReviewItems(items) {
  return items.filter(item =>
    hasQueue(item, 'commercial_review') ||
    hasQueue(item, 'large_inventory_review') ||
    hasReason(item, 'strategic_low_demand') ||
    hasReason(item, 'short_long_trend_conflict') ||
    hasReason(item, 'possible_new_product')
  );
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.rowIdentity || `${item.source_row_number}:${item.article}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildOwnerReviewModel(draft, manualReview = null, config = null) {
  const items = draft.items || [];
  const ownerPolicy = config?.owner_review_policy || DEFAULT_OWNER_REVIEW_POLICY;
  const scoredEntries = items
    .map(item => ({ item, review: scoreOwnerReviewItem(item, ownerPolicy) }))
    .sort(compareOwnerItems);
  const allOwnerActionEntries = scoredEntries.filter(entry =>
    entry.review.owner_action_required
  );
  const ownerActionEntries = allOwnerActionEntries.slice(
    0,
    ownerPolicy.max_owner_action_items
  );
  const ownerActionItems = ownerActionEntries.map(entry => entry.item);
  const exitItems = items.filter(item => item.suggested_role === 'EXIT');
  const largeInventoryItems = items
    .filter(item => hasQueue(item, 'large_inventory_review'))
    .sort((left, right) =>
      (right.maximum_stock_value ?? -1) - (left.maximum_stock_value ?? -1)
    );
  const approvedConflicts = items.filter(item => item.approved_policy_conflict);
  const placeholderDifferences = items.filter(item => item.placeholder_difference);
  const requiresConfirmation = items.filter(item => item.policy_requires_confirmation);
  const commercialItems = commercialReviewItems(items);
  const qualityGroups = dataQualityGroups(items);
  const criticalLargeInventory = largeInventoryItems.filter(item =>
    item.inventory_value_review_level === 'critical'
  );
  const decisionItems = uniqueItems([
    ...ownerActionItems,
    ...exitItems,
    ...approvedConflicts,
    ...criticalLargeInventory,
  ]);
  const p1Count = scoredEntries.filter(entry =>
    entry.review.owner_review_priority === 'P1'
  ).length;
  const p2Count = scoredEntries.filter(entry =>
    entry.review.owner_review_priority === 'P2'
  ).length;
  const globalStatus = p1Count > 0
    ? { code: 'red', label: '🔴 требуется срочное решение' }
    : p2Count > 0
      ? { code: 'orange', label: '🟠 требуется проверка' }
      : scoredEntries.some(entry => entry.review.owner_review_score > 0)
        ? { code: 'yellow', label: '🟡 есть рекомендации' }
        : { code: 'green', label: '🟢 критических проблем нет' };

  return {
    version: 1,
    report_version: 'owner-review-v0.5.2',
    generated_at: draft.generated_at,
    source: draft.source,
    owner_review_policy: ownerPolicy,
    status: globalStatus,
    summary: {
      owner_action_required_total: allOwnerActionEntries.length,
      owner_action_displayed: ownerActionEntries.length,
      core_review: items.filter(item => item.suggested_role === 'CORE').length,
      exit_approval: exitItems.length,
      large_inventory_review: largeInventoryItems.length,
      approved_conflicts: approvedConflicts.length,
      placeholder_differences: placeholderDifferences.length,
      requires_confirmation: requiresConfirmation.length,
      commercial_review: commercialItems.length,
      owner_decision_sheet: decisionItems.length,
      data_quality: Object.fromEntries(
        Object.entries(qualityGroups).map(([name, groupItems]) => [name, groupItems.length])
      ),
    },
    items: scoredEntries.map(({ item, review }) => ({
      rowIdentity: item.rowIdentity,
      source_row_number: item.source_row_number,
      article: item.article,
      name: item.name,
      suggested_role: item.suggested_role,
      owner_review_score: review.owner_review_score,
      owner_review_priority: review.owner_review_priority,
      owner_review_reasons: review.owner_review_reasons,
      owner_action_required: review.owner_action_required,
      recommended_action: recommendedAction(item),
    })),
    sections: {
      owner_action_required: ownerActionItems.map(item => item.rowIdentity),
      core_review: items.filter(item => item.suggested_role === 'CORE')
        .map(item => item.rowIdentity),
      exit_approval: exitItems.map(item => item.rowIdentity),
      large_inventory_review: largeInventoryItems.map(item => item.rowIdentity),
      approved_conflicts: approvedConflicts.map(item => item.rowIdentity),
      placeholder_differences: placeholderDifferences.map(item => item.rowIdentity),
      requires_confirmation: requiresConfirmation.map(item => item.rowIdentity),
      commercial_review: commercialItems.map(item => item.rowIdentity),
      data_quality: Object.fromEntries(
        Object.entries(qualityGroups).map(([name, groupItems]) => [
          name,
          groupItems.map(item => item.rowIdentity),
        ])
      ),
      owner_decision_sheet: decisionItems.map(item => item.rowIdentity),
    },
    manual_review_item_count: manualReview?.item_count ?? null,
  };
}

function buildOwnerReviewReport(
  draft,
  manualReview = null,
  config = null,
  suppliedModel = null
) {
  const model = suppliedModel || buildOwnerReviewModel(draft, manualReview, config);
  const items = draft.items || [];
  const byIdentity = new Map(items.map(item => [item.rowIdentity, item]));
  const sectionItems = section => (model.sections[section] || [])
    .map(identity => byIdentity.get(identity))
    .filter(Boolean);
  const summary = draft.summary;
  const ownerActionItems = sectionItems('owner_action_required');
  const coreItems = sectionItems('core_review');
  const exitItems = sectionItems('exit_approval');
  const largeInventoryItems = sectionItems('large_inventory_review');
  const conflictItems = sectionItems('approved_conflicts');
  const placeholderItems = sectionItems('placeholder_differences');
  const confirmationItems = sectionItems('requires_confirmation');
  const commercialItems = sectionItems('commercial_review');
  const decisionItems = sectionItems('owner_decision_sheet');
  const scoreByIdentity = new Map(model.items.map(item => [item.rowIdentity, item]));
  const qualityGroups = dataQualityGroups(items);
  const maxQualityExamples = model.owner_review_policy.max_data_quality_examples;
  const coreOwnerItems = coreItems.filter(item =>
    scoreByIdentity.get(item.rowIdentity)?.owner_action_required
  );
  const identificationProblems = uniqueItems([
    ...(qualityGroups['Missing article'] || []),
    ...(qualityGroups['Ambiguous identity'] || []),
  ]).length;
  const insufficientData = uniqueItems([
    ...(qualityGroups['Missing purchase price'] || []),
    ...(qualityGroups['Missing stock data'] || []),
    ...(qualityGroups['Insufficient sales history'] || []),
    ...(qualityGroups['Incomplete supplier data'] || []),
  ]).length;
  const ownerPriorityLabel = item => {
    const review = scoreByIdentity.get(item.rowIdentity);
    return `${review.owner_review_priority} · ${review.owner_review_score}`;
  };
  const lines = [
    '# Owner Review — ассортиментная матрица «Миска»',
    '',
    `**Общий статус:** ${model.status.label}`,
    '',
    `- Дата отчёта: ${display(draft.generated_at)}`,
    `- Дата исходного SmartZapas: ${display(
      draft.source?.report_timestamp || draft.source?.report_date
    )}`,
    `- Исходный файл: ${display(draft.source?.file)}`,
    `- SKU: ${summary.total_sku}`,
    '',
    '> Правило статуса: 🔴 при наличии P1; 🟠 при наличии P2 без P1; ' +
      '🟡 при рекомендациях без P1/P2; 🟢 при отсутствии сигналов.',
    '> Отчёт не изменяет роли, stock policy, рабочую матрицу или заказ.',
    '',
    '---',
    '',
    '## 1. 📊 EXECUTIVE SUMMARY',
    '',
    ...markdownTable(
      ['Показатель', 'Количество'],
      [
        ['CORE', summary.roles?.CORE ?? 0],
        ['OPTIONAL', summary.roles?.OPTIONAL ?? 0],
        ['EXIT', summary.roles?.EXIT ?? 0],
        ['UNCLASSIFIED', summary.roles?.UNCLASSIFIED ?? 0],
        ['Требуют решения владельца', model.summary.owner_action_required_total],
        ['Кандидаты EXIT', exitItems.length],
        ['Дорогие политики запаса', largeInventoryItems.length],
        ['Approved conflicts', conflictItems.length],
        ['Placeholder differences', placeholderItems.length],
        ['Проблемы идентификации', identificationProblems],
        ['Недостаточные данные', insufficientData],
      ]
    ),
    '',
    '---',
    '',
    '## 2. 🚨 OWNER ACTION REQUIRED',
    '',
    `Показано **${ownerActionItems.length}** из **${model.summary.owner_action_required_total}**. ` +
      `Лимит: ${model.owner_review_policy.max_owner_action_items}.`,
    '',
    ...markdownTable(
      ['Приоритет', 'Артикул', 'Товар', 'Роль', 'Причина', 'Рекомендуемое действие'],
      ownerActionItems.map(item => [
        ownerPriorityLabel(item),
        itemKey(item),
        item.name,
        item.suggested_role,
        reasonSummary(item),
        recommendedAction(item),
      ])
    ),
    '',
    '---',
    '',
    '## 3. 🟢 CORE REVIEW',
    '',
    `CORE: **${coreItems.length}**. Требуют решения владельца: **${coreOwnerItems.length}**.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Продажи 4/8/12 нед.', 'Long-term avg', 'Effective avg', 'Minimum', 'Target', 'Maximum', 'Priority', 'Policy status', 'Причина CORE', 'Review queues', 'Выделение'],
      coreItems.map(item => [
        itemKey(item),
        item.name,
        `${salesForWindow(item, 'short_average', 4)} / ` +
          `${salesForWindow(item, 'base_average', 8)} / ` +
          `${salesForWindow(item, 'preferred_average', 12)}`,
        display(item.evidence?.long_term_average),
        display(item.evidence?.effective_average),
        display(item.suggested_minimum_shelf_stock),
        display(item.suggested_target_stock),
        display(item.suggested_maximum_stock),
        item.suggested_priority,
        policyStatus(item),
        coreReason(item),
        reviewQueues(item),
        coreHighlights(item),
      ])
    ),
    '',
    '### CORE, требующие решения владельца',
    '',
    ...markdownTable(
      ['Приоритет', 'Артикул', 'Товар', 'Причина', 'Действие'],
      coreOwnerItems.map(item => [
        ownerPriorityLabel(item), itemKey(item), item.name,
        reasonSummary(item), recommendedAction(item),
      ])
    ),
    '',
    '---',
    '',
    '## 4. 🚪 EXIT APPROVAL',
    '',
    `Кандидатов EXIT: **${exitItems.length}**. Решение заранее не выбрано.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Горизонт', 'Последние продажи', 'Продажи 4/8/12/26 нед.', 'Current week', 'Supplier demand', 'Supplier order', 'Strategic', 'Approved', 'Reason codes', 'Качество данных', 'Решение владельца'],
      exitItems.map(item => {
        const evaluation = item.evidence?.exit_evaluation || {};
        return [
          itemKey(item),
          item.name,
          `${display(evaluation.horizonWeeks)} нед.`,
          latestSalesText(item),
          `${salesForWindow(item, 'short_average', 4)} / ` +
            `${salesForWindow(item, 'base_average', 8)} / ` +
            `${salesForWindow(item, 'preferred_average', 12)} / ` +
            `${salesForLongTerm(item)}`,
          yesNo(Boolean(evaluation.currentWeekSale)),
          yesNo(positive(item.evidence?.supplier_need_qty)),
          yesNo(positive(item.evidence?.supplier_recommended_qty)),
          yesNo(Boolean(evaluation.strategicProtected)),
          yesNo(approvedPolicy(item)),
          (item.reason_codes || []).join(', '),
          `${item.confidence}; missing: ${(item.data_quality?.missing_fields || []).join(', ') || 'нет'}`,
          '□ Утвердить EXIT<br>□ Оставить<br>□ Наблюдать<br>□ Исправить данные',
        ];
      })
    ),
    '',
    '---',
    '',
    '## 5. 💰 LARGE INVENTORY REVIEW',
    '',
    `Позиций: **${largeInventoryItems.length}**. Сортировка по maximum stock value.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Закупочная цена', 'Minimum', 'Target', 'Maximum', 'Maximum stock value', 'Статус', 'Effective avg', 'Формула', 'Причина'],
      largeInventoryItems.map(item => [
        itemKey(item),
        item.name,
        formatCurrency(item.evidence?.purchase_price),
        display(item.suggested_minimum_shelf_stock),
        display(item.suggested_target_stock),
        display(item.suggested_maximum_stock),
        formatCurrency(item.maximum_stock_value),
        item.inventory_value_review_level === 'critical' ? '🔴 critical' : '🟠 review',
        display(item.evidence?.effective_average),
        stockFormula(item),
        reasonSummary(item, 3, [
          'critical_inventory_value', 'large_inventory_value',
          'large_inventory_units', 'growth_cap_applied',
        ]),
      ])
    ),
    '',
    '---',
    '',
    '## 6. 🛡️ POLICY REVIEW',
    '',
    '### Approved conflicts',
    '',
    `Реальных конфликтов: **${conflictItems.length}**. Approved policy не изменена.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Approved policy', 'Предложение Builder', 'Что конфликтует', 'Статус'],
      conflictItems.map(item => [
        itemKey(item), item.name, policyText(item.existing_policy),
        policyText(item.suggested_policy), policyDifferences(item),
        '✅ approved policy сохранена',
      ])
    ),
    '',
    '### Placeholder differences',
    '',
    `Отличий: **${placeholderItems.length}**. Они не являются approved conflicts.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Placeholder', 'Предложение Builder', 'Различия'],
      placeholderItems.map(item => [
        itemKey(item), item.name, policyText(item.existing_policy),
        policyText(item.suggested_policy), policyDifferences(item),
      ])
    ),
    '',
    '### Requires confirmation',
    '',
    `Позиций: **${confirmationItems.length}**.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Текущая policy', 'Предложение Builder'],
      confirmationItems.map(item => [
        itemKey(item), item.name, policyText(item.existing_policy),
        policyText(item.suggested_policy),
      ])
    ),
    '',
    '---',
    '',
    '## 7. 🧠 COMMERCIAL REVIEW',
    '',
    `Коммерческих решений: **${commercialItems.length}**. ` +
      'Identity-only и price-only ошибки сюда не включаются.',
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Категория', 'Роль', 'Приоритет', 'Причина', 'Действие'],
      commercialItems.map(item => [
        itemKey(item), item.name, categoryText(item), item.suggested_role,
        item.suggested_priority, reasonSummary(item), recommendedAction(item),
      ])
    ),
    '',
    '---',
    '',
    '## 8. 🧪 DATA QUALITY',
    '',
    `В каждой группе показаны первые ${maxQualityExamples} примеров. ` +
      'Полные списки находятся в owner-review.json и техническом отчёте.',
    '',
  ];

  Object.entries(qualityGroups).forEach(([title, groupItems]) => {
    lines.push(
      `### ${title} — ${groupItems.length}`,
      '',
      ...markdownTable(
        ['Артикул', 'Товар', 'Роль', 'Проблема'],
        groupItems.slice(0, maxQualityExamples).map(item => [
          itemKey(item), item.name, item.suggested_role, reasonSummary(item, 2),
        ])
      ),
      groupItems.length > maxQualityExamples
        ? `Полный список: ещё ${groupItems.length - maxQualityExamples} SKU в owner-review.json.`
        : 'Показан полный список группы.',
      ''
    );
  });

  lines.push(
    '---',
    '',
    '## 9. ✅ OWNER DECISION SHEET',
    '',
    `Уникальных SKU: **${decisionItems.length}**. Дубли между секциями объединены.`,
    '',
    ...markdownTable(
      ['Артикул', 'Товар', 'Текущее предложение', 'Решение владельца', 'Комментарий'],
      decisionItems.map(item => [
        itemKey(item),
        item.name,
        `${item.suggested_role}; min/target/max ` +
          `${display(item.suggested_minimum_shelf_stock)}/` +
          `${display(item.suggested_target_stock)}/` +
          `${display(item.suggested_maximum_stock)}; причины: ` +
          `${scoreByIdentity.get(item.rowIdentity)?.owner_review_reasons.join(', ') || 'нет'}`,
        '',
        '',
      ])
    ),
    '',
    '---',
    '',
    '### Правила сортировки Owner Review',
    '',
    `- Approved conflict: +${model.owner_review_policy.approved_conflict_score}`,
    `- Critical inventory: +${model.owner_review_policy.critical_inventory_score}`,
    `- Large inventory: +${model.owner_review_policy.large_inventory_score}`,
    `- EXIT candidate: +${model.owner_review_policy.exit_candidate_score}`,
    `- Strategic item: +${model.owner_review_policy.strategic_item_score}`,
    `- Commercial review: +${model.owner_review_policy.commercial_review_score}`,
    `- Missing price risk: +${model.owner_review_policy.missing_price_risk_score}`,
    `- Insufficient data: +${model.owner_review_policy.insufficient_data_score}`,
    `- Identity-only issue: +${model.owner_review_policy.identity_only_score}`,
    '',
    '> Score используется только для порядка отображения и не влияет на роль или policy.',
    ''
  );
  return lines.join('\n');
}

module.exports = {
  DEFAULT_OWNER_REVIEW_POLICY,
  display,
  markdown,
  formatCurrency,
  scoreOwnerReviewItem,
  selectTopPriorityItems,
  latestSalesText,
  dataQualityGroups,
  buildOwnerReviewModel,
  buildOwnerReviewReport,
};
