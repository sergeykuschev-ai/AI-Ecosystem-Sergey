function display(value) {
  return value === null || value === undefined || value === '' ? 'нет данных' : value;
}

function buildAssortmentMatrixReport(controlResult) {
  const summary = controlResult.summary;
  const decisionsByIdentity = new Map(
    controlResult.decisions.map(decision => [decision.rowIdentity, decision])
  );
  const lines = [
    '## КОНТРОЛЬ ОБЯЗАТЕЛЬНОЙ АССОРТИМЕНТНОЙ МАТРИЦЫ',
    '',
    `- Общее количество позиций в матрице: ${summary.total_matrix_items}`,
    `- Найдено в отчёте: ${summary.matched_matrix_items}`,
    `- Отсутствует или сопоставлено неоднозначно: ${summary.missing_matrix_items_count}`,
    `- Critical ниже минимального остатка: ${summary.critical_below_minimum_count}`,
    `- Позиции матрицы на ручной проверке: ${summary.manual_review_count}`,
    `- Проекция рассчитана: ${summary.inventory_projection_calculated_count}`,
    `- Недостаточно складских данных: ${summary.inventory_projection_insufficient_data_count}`,
    '',
    '## ОБЯЗАТЕЛЬНЫЕ ПОЗИЦИИ, ОТСУТСТВУЮЩИЕ В ОТЧЁТЕ ПОСТАВЩИКА',
    '',
  ];

  if (controlResult.missingMatrixItems.length === 0) {
    lines.push('Не найдено.');
  } else {
    controlResult.missingMatrixItems.forEach((item, index) => {
      lines.push(
        `${index + 1}. Артикул: ${display(item.article)} | ` +
        `Товар: ${item.name} | Приоритет: ${item.priority} | Причина: ${item.reason}`
      );
    });
  }

  lines.push('', '## CRITICAL-ПОЗИЦИИ НИЖЕ МИНИМАЛЬНОГО ОСТАТКА', '');
  if (controlResult.criticalBelowMinimum.length === 0) {
    lines.push('Не найдено.');
  } else {
    controlResult.criticalBelowMinimum.forEach((product, index) => {
      const projection = product.inventory_projection;
      const decision = decisionsByIdentity.get(product.rowIdentity);
      lines.push(
        `${index + 1}. ${product.name} | ` +
        `Свободный остаток: ${display(projection.free_stock)} | ` +
        `В пути: ${display(projection.in_transit)} | ` +
        `Резерв: ${display(projection.reserve)} | ` +
        `Статус расчёта: ${projection.calculation_status} | ` +
        `Формула: ${display(projection.formula)} | ` +
        `Рекомендуемый заказ: ${display(projection.recommended_order_qty)} | ` +
        `Прогнозный остаток: ${display(projection.projected_stock)} | ` +
        `Минимум матрицы: ${product.assortment_matrix.minimum_shelf_stock} | ` +
        `Решение: ${decision?.decision || 'нет данных'}`
      );
    });
  }

  if (controlResult.warnings.length > 0) {
    lines.push('', 'Предупреждение:');
    controlResult.warnings.forEach(warning => lines.push(`- ${warning}`));
  }
  return lines.join('\n');
}

module.exports = { buildAssortmentMatrixReport };
