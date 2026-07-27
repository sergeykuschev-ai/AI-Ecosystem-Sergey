function safeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function mapChangedItem(item = {}) {
  return {
    product_name: safeText(item.productName) || 'Товар без названия',
    sku: safeText(item.sku),
    decision_before: safeText(item.decisionBefore),
    decision_after: safeText(item.decisionAfter),
    quantity_before: safeNumber(item.quantityBefore),
    quantity_after: safeNumber(item.quantityAfter),
  };
}

function mapStatusPreview(preview = {}) {
  return {
    status: preview.status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
    preview: {
      preview_id: safeText(preview.previewId),
      previewed_at: safeText(preview.previewedAt),
      expires_at: safeText(preview.expiresAt),
      rule: {
        rule_id: safeText(preview.rule?.ruleId),
        current_status: safeText(preview.rule?.currentStatus),
        target_status: safeText(preview.rule?.targetStatus),
        decision: safeText(preview.rule?.decision),
        display_scope: {
          primary:
            safeText(preview.rule?.displayScope?.primary) ||
            'Товар без названия',
          secondary:
            safeText(preview.rule?.displayScope?.secondary) || '—',
        },
      },
      impact: {
        affected_items: safeNumber(preview.impact?.affectedItems) || 0,
        affected_rows: safeNumber(preview.impact?.affectedRows) || 0,
        decision_changes:
          safeNumber(preview.impact?.decisionChanges) || 0,
        quantity_changes:
          safeNumber(preview.impact?.quantityChanges) || 0,
        order_amount_before:
          safeNumber(preview.impact?.orderAmountBefore),
        order_amount_after:
          safeNumber(preview.impact?.orderAmountAfter),
        order_amount_delta:
          safeNumber(preview.impact?.orderAmountDelta),
        units_before: safeNumber(preview.impact?.unitsBefore),
        units_after: safeNumber(preview.impact?.unitsAfter),
        units_delta: safeNumber(preview.impact?.unitsDelta),
        financial_status_before:
          safeText(preview.impact?.financialStatusBefore),
        financial_status_after:
          safeText(preview.impact?.financialStatusAfter),
        financially_permitted:
          preview.impact?.financiallyPermitted === true,
      },
      changed_items: Array.isArray(preview.changedItems)
        ? preview.changedItems.slice(0, 20).map(mapChangedItem)
        : [],
      warnings: Array.isArray(preview.warnings)
        ? preview.warnings.map(safeText).filter(Boolean).slice(0, 50)
        : [],
    },
  };
}

function mapStatusChange(result = {}) {
  const activated = result.rule?.currentStatus === 'ACTIVE';
  return {
    status: result.status === 'ALREADY_CHANGED'
      ? 'ALREADY_CHANGED'
      : 'CHANGED',
    rule: {
      rule_id: safeText(result.rule?.ruleId),
      previous_status: safeText(result.rule?.previousStatus),
      current_status: safeText(result.rule?.currentStatus),
      updated_at: safeText(result.rule?.updatedAt),
    },
    message: activated
      ? 'Правило активировано и будет учитываться в будущих расчётах закупки.'
      : 'Правило отключено и не будет учитываться в будущих расчётах закупки.',
    audit_repaired: result.repair?.repaired === true,
  };
}

function mapStatusHistory(result = {}) {
  return {
    rule_id: safeText(result.ruleId),
    events: Array.isArray(result.events)
      ? result.events.map(event => ({
        event_id: safeText(event.eventId),
        recorded_at: safeText(event.recordedAt),
        from_status: safeText(event.fromStatus),
        to_status: safeText(event.toStatus),
        action: safeText(event.action),
        actor: safeText(event.actor),
        reason_code: safeText(event.reasonCode),
        owner_comment: safeText(event.ownerComment),
        preview_id: safeText(event.previewId),
      }))
      : [],
  };
}

module.exports = {
  mapStatusChange,
  mapStatusHistory,
  mapStatusPreview,
};
