'use strict';

function requireClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('PostgreSQL client with query(text, values) is required');
  }
}

function rowToAlertState(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    alertType: row.alert_type,
    entityId: row.entity_id,
    state: row.state,
    lastValue: row.last_value,
    lastValueText: row.last_value_text,
    firstSeenAt: row.first_seen_at ? row.first_seen_at.toISOString() : null,
    lastSentAt: row.last_sent_at ? row.last_sent_at.toISOString() : null,
    lastAlertDigest: row.last_alert_digest || null,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    sentCount: row.sent_count,
    metadata: row.metadata_json || {},
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

function createKpiAutomationStateStore(client) {
  requireClient(client);

  async function getAlertState(ownerId, alertType, entityId) {
    const result = await client.query(
      `SELECT * FROM arthur_automation_alert_state
       WHERE owner_id = (SELECT id FROM arthur_profiles WHERE external_id = $1)
         AND alert_type = $2
         AND entity_id = $3`,
      [ownerId, alertType, entityId]
    );
    return rowToAlertState(result.rows[0] || null);
  }

  async function upsertAlertState({
    ownerId,
    alertType,
    entityId,
    state,
    lastValue,
    lastValueText,
    lastSentAt,
    lastAlertDigest,
    metadata,
  }) {
    const result = await client.query(
      `INSERT INTO arthur_automation_alert_state
         (owner_id, alert_type, entity_id, state, last_value, last_value_text,
          last_sent_at, last_alert_digest, metadata_json, updated_at)
       VALUES (
         (SELECT id FROM arthur_profiles WHERE external_id = $1),
         $2, $3, $4, $5, $6, $7, $8, $9, now()
       )
       ON CONFLICT (owner_id, alert_type, entity_id) DO UPDATE SET
         state = EXCLUDED.state,
         last_value = EXCLUDED.last_value,
         last_value_text = EXCLUDED.last_value_text,
         last_sent_at = EXCLUDED.last_sent_at,
         last_alert_digest = EXCLUDED.last_alert_digest,
         sent_count = arthur_automation_alert_state.sent_count + 1,
         metadata_json = EXCLUDED.metadata_json,
         updated_at = now()
       RETURNING *`,
      [ownerId, alertType, entityId, state, lastValue ?? null, lastValueText ?? null, lastSentAt || null, lastAlertDigest || null, JSON.stringify(metadata || {})]
    );
    return rowToAlertState(result.rows[0]);
  }

  async function resolveAlertState(ownerId, alertType, entityId) {
    const result = await client.query(
      `UPDATE arthur_automation_alert_state
       SET state = 'ok', resolved_at = now(), updated_at = now()
       WHERE owner_id = (SELECT id FROM arthur_profiles WHERE external_id = $1)
         AND alert_type = $2
         AND entity_id = $3
       RETURNING *`,
      [ownerId, alertType, entityId]
    );
    return rowToAlertState(result.rows[0] || null);
  }

  async function recordRun({ ownerId, runType, scheduledFor, correlationId, result, errorCode, errorMessage, metadata }) {
    await client.query(
      `INSERT INTO arthur_automation_runs
         (owner_id, run_type, scheduled_for, sent_at, correlation_id, result,
          error_code, error_message, metadata_json)
       VALUES (
         (SELECT id FROM arthur_profiles WHERE external_id = $1),
         $2, $3, now(), $4, $5, $6, $7, $8
       )`,
      [ownerId, runType, scheduledFor || null, correlationId, result, errorCode || null, errorMessage || null, JSON.stringify(metadata || {})]
    );
  }

  async function getLastRun(ownerId, runType, options = {}) {
    const since = options.since || null;
    const result = await client.query(
      `SELECT r.*, p.external_id AS owner_id
       FROM arthur_automation_runs r
       JOIN arthur_profiles p ON p.id = r.owner_id
       WHERE p.external_id = $1 AND r.run_type = $2
         AND ($3::timestamptz IS NULL OR r.created_at >= $3)
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [ownerId, runType, since]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      ownerId: row.owner_id,
      runType: row.run_type,
      scheduledFor: row.scheduled_for ? row.scheduled_for.toISOString() : null,
      sentAt: row.sent_at ? row.sent_at.toISOString() : null,
      correlationId: row.correlation_id,
      result: row.result,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      metadata: row.metadata_json || {},
      createdAt: row.created_at ? row.created_at.toISOString() : null,
    };
  }

  async function listRecentAlertStates(ownerId, options = {}) {
    const alertType = options.alertType || null;
    const result = await client.query(
      `SELECT s.*, p.external_id AS owner_id
       FROM arthur_automation_alert_state s
       JOIN arthur_profiles p ON p.id = s.owner_id
       WHERE p.external_id = $1
         AND ($2::text IS NULL OR s.alert_type = $2)
       ORDER BY s.updated_at DESC`,
      [ownerId, alertType]
    );
    return result.rows.map(rowToAlertState);
  }

  return {
    getAlertState,
    upsertAlertState,
    resolveAlertState,
    recordRun,
    getLastRun,
    listRecentAlertStates,
  };
}

module.exports = { createKpiAutomationStateStore };
