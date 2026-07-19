function display(value) {
  return value === null || value === undefined || value === ''
    ? 'нет данных'
    : String(value);
}

function itemLine(item) {
  return [
    `Строка ${item.source_row_number}`,
    `артикул: ${display(item.article)}`,
    item.name,
    `роль: ${item.suggested_role}`,
    `приоритет: ${item.suggested_priority}`,
    `политика: ${display(item.suggested_minimum_shelf_stock)}/` +
      `${display(item.suggested_target_stock)}/` +
      `${display(item.suggested_maximum_stock)}`,
    `confidence: ${item.confidence}`,
  ].join(' | ');
}

function appendItems(lines, items, emptyText = 'Не найдено.', limit = 60) {
  if (items.length === 0) {
    lines.push(emptyText);
    return;
  }
  items.slice(0, limit).forEach((item, index) => {
    lines.push(`${index + 1}. ${itemLine(item)}`);
  });
  if (items.length > limit) {
    lines.push(`...ещё ${items.length - limit} позиций доступны в JSON-черновике.`);
  }
}

function buildMatrixBuilderReport(draft, manualReview) {
  const summary = draft.summary;
  const roleLines = Object.entries(summary.roles)
    .map(([role, count]) => `- ${role}: ${count}`);
  const priorityLines = Object.entries(summary.priorities)
    .map(([priority, count]) => `- ${priority}: ${count}`);
  const coreItems = draft.items.filter(item => item.suggested_role === 'CORE');
  const newItems = draft.items.filter(item => item.suggested_role === 'NEW');
  const exitItems = draft.items.filter(item => item.suggested_role === 'EXIT');
  const conflictItems = draft.items.filter(item => item.policy_conflict);
  const missingDataItems = draft.items.filter(item =>
    item.data_quality.missing_fields.length > 0 ||
    item.validation.errors.length > 0 ||
    item.suggested_minimum_shelf_stock === null
  );
  const lines = [
    '# ЧЕРНОВИК АССОРТИМЕНТНОЙ МАТРИЦЫ «МИСКА»',
    '',
    'Matrix Builder создаёт рекомендации, а не автоматически утверждённую ассортиментную политику.',
    'Рабочая матрица не изменена и не перезаписана.',
    '',
    '## ИСХОДНЫЕ ДАННЫЕ',
    '',
    `- Файл: ${draft.source.file}`,
    `- Лист: ${draft.source.worksheet}`,
    `- Timestamp отчёта: ${display(draft.source.report_timestamp)}`,
    `- Источник timestamp: ${display(draft.source.report_timestamp_source)}`,
    `- SKU: ${draft.source.sku_count}`,
    `- Структурные строки: ${draft.source.structural_row_count}`,
    `- Конфигурация: ${draft.builder_version}`,
    `- Действующая матрица: ${draft.existing_matrix ? draft.existing_matrix.file : 'не передана'}`,
    '',
    '## ИТОГОВАЯ СВОДКА',
    '',
    `- Всего SKU: ${summary.total_sku}`,
    `- High confidence: ${summary.confidence.high}`,
    `- Medium confidence: ${summary.confidence.medium}`,
    `- Low confidence: ${summary.confidence.low}`,
    `- Ручная проверка: ${summary.manual_review}`,
    `- Товары действующей матрицы: ${summary.existing_matrix_items}`,
    `- Конфликты политик: ${summary.policy_conflicts}`,
    `- Без полной политики остатков: ${summary.products_without_stock_policy}`,
    `- Ошибки валидации SKU: ${draft.validation_summary.error_count}`,
    `- Предупреждения валидации SKU: ${draft.validation_summary.warning_count}`,
    '',
    '## ПРЕДЛОЖЕННЫЕ РОЛИ',
    '',
    ...roleLines,
    '',
    '## ПРЕДЛОЖЕННЫЕ ПРИОРИТЕТЫ',
    '',
    ...priorityLines,
    '',
    '## CORE-ПОЗИЦИИ',
    '',
  ];
  appendItems(lines, coreItems);
  lines.push('', '## ВОЗМОЖНЫЕ НОВИНКИ', '');
  appendItems(lines, newItems);
  lines.push('', '## КАНДИДАТЫ НА ВЫВОД', '');
  appendItems(lines, exitItems);
  lines.push('', '## КОНФЛИКТЫ С ДЕЙСТВУЮЩЕЙ МАТРИЦЕЙ', '');
  appendItems(lines, conflictItems);
  lines.push('', '## ПОЗИЦИИ ДЛЯ РУЧНОЙ ПРОВЕРКИ', '');
  appendItems(lines, manualReview.items);
  lines.push('', '## НЕХВАТКА ДАННЫХ', '');
  appendItems(lines, missingDataItems);
  lines.push(
    '',
    '## РЕКОМЕНДУЕМЫЕ СЛЕДУЮЩИЕ ДЕЙСТВИЯ',
    '',
    '1. Проверить позиции из manual-review.json и подтвердить их роль.',
    '2. Проверить конфликты с действующей матрицей; по умолчанию сохранить действующую политику.',
    '3. Подтвердить параметры покрытия и safety stock в конфигурации Matrix Builder.',
    '4. Отдельно подтвердить кандидатов NEW и EXIT.',
    '5. Переносить в рабочую матрицу только явно утверждённые владельцем позиции.',
    ''
  );
  return lines.join('\n');
}

module.exports = {
  display,
  itemLine,
  buildMatrixBuilderReport,
};
