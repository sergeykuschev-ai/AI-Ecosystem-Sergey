'use strict';

function requireClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('PostgreSQL client with query(text, values) is required');
  }
}

function first(result) {
  return result && result.rows && result.rows[0] ? result.rows[0] : null;
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.external_id,
    name: row.name,
    timezone: row.timezone,
    locale: row.locale,
    preferredChannel: row.preferred_channel,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCommon(row) {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camel] = value instanceof Date ? value.toISOString() : value;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'valueJson')) {
    result.value = result.valueJson;
    delete result.valueJson;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'payloadJson')) {
    result.payload = result.payloadJson;
    delete result.payloadJson;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'beforeJson')) {
    result.before = result.beforeJson;
    delete result.beforeJson;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'afterJson')) {
    result.after = result.afterJson;
    delete result.afterJson;
  }
  return result;
}

class PostgresArthurStore {
  constructor({ client }) {
    requireClient(client);
    this.client = client;
  }

  async transaction(work) {
    if (typeof work !== 'function') throw new TypeError('transaction work must be a function');
    const connection = typeof this.client.connect === 'function' ? await this.client.connect() : this.client;
    try {
      await connection.query('BEGIN');
      const scoped = new PostgresArthurStore({ client: connection });
      const result = await work(scoped);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      if (connection !== this.client && typeof connection.release === 'function') connection.release();
    }
  }

  async putProfile(record) {
    const result = await this.client.query(
      `INSERT INTO arthur_profiles (external_id, name, timezone, locale, preferred_channel, active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (external_id) DO UPDATE SET
         name=EXCLUDED.name, timezone=EXCLUDED.timezone, locale=EXCLUDED.locale,
         preferred_channel=EXCLUDED.preferred_channel, active=EXCLUDED.active,
         updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.id, record.name, record.timezone, record.locale, record.preferredChannel || null,
        record.active !== false, record.createdAt, record.updatedAt]
    );
    return mapProfile(first(result));
  }

  async getProfile(externalId) {
    return mapProfile(first(await this.client.query(
      'SELECT * FROM arthur_profiles WHERE external_id=$1', [externalId]
    )));
  }

  async archiveActiveMemory(ownerId, domain, key, validTo) {
    const result = await this.client.query(
      `UPDATE arthur_memory SET status='archived', valid_to=$4, updated_at=$4
       WHERE owner_id=(SELECT id FROM arthur_profiles WHERE external_id=$1)
         AND domain=$2 AND key=$3 AND status='active' AND valid_to IS NULL
       RETURNING *`,
      [ownerId, domain, key, validTo]
    );
    return result.rows.map(mapCommon);
  }

  async putMemory(record) {
    const result = await this.client.query(
      `INSERT INTO arthur_memory
       (id, owner_id, domain, type, key, value_json, source_type, source_ref, confidence,
        sensitivity, valid_from, valid_to, status, created_at, updated_at)
       VALUES ($1,(SELECT id FROM arthur_profiles WHERE external_id=$2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [record.id, record.ownerId, record.domain, record.type, record.key, record.value,
        record.sourceType, record.sourceRef || null, record.confidence, record.sensitivity || 'normal',
        record.validFrom || record.createdAt, record.validTo || null, record.status || 'active',
        record.createdAt, record.updatedAt]
    );
    return mapCommon(first(result));
  }

  async getActiveMemory(ownerId, domain, key) {
    return mapCommon(first(await this.client.query(
      `SELECT m.*, p.external_id AS owner_id FROM arthur_memory m
       JOIN arthur_profiles p ON p.id=m.owner_id
       WHERE p.external_id=$1 AND m.domain=$2 AND m.key=$3
         AND m.status='active' AND m.valid_to IS NULL
       ORDER BY m.created_at DESC LIMIT 1`,
      [ownerId, domain, key]
    )));
  }

  async putTask(record) {
    const result = await this.client.query(
      `INSERT INTO arthur_tasks
       (id, owner_id, domain, title, description, status, priority, due_at, waiting_for,
        next_check_at, completed_at, source_type, source_ref, created_at, updated_at)
       VALUES ($1,(SELECT id FROM arthur_profiles WHERE external_id=$2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
         status=EXCLUDED.status, priority=EXCLUDED.priority, due_at=EXCLUDED.due_at,
         waiting_for=EXCLUDED.waiting_for, next_check_at=EXCLUDED.next_check_at,
         completed_at=EXCLUDED.completed_at, source_type=EXCLUDED.source_type,
         source_ref=EXCLUDED.source_ref, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.id, record.ownerId, record.domain, record.title, record.description || null,
        record.status, record.priority, record.dueAt || null, record.waitingFor || null,
        record.nextCheckAt || null, record.completedAt || null, record.sourceType || 'api',
        record.sourceRef || null, record.createdAt, record.updatedAt]
    );
    return mapCommon(first(result));
  }

  async getTask(id) {
    return mapCommon(first(await this.client.query(
      `SELECT t.*, p.external_id AS owner_id
       FROM arthur_tasks t
       JOIN arthur_profiles p ON p.id=t.owner_id
       WHERE t.id=$1`,
      [id]
    )));
  }

  async putDecision(record) {
    const result = await this.client.query(
      `INSERT INTO arthur_decisions
       (id, owner_id, domain, statement, reason, status, supersedes_decision_id, created_at, updated_at)
       VALUES ($1,(SELECT id FROM arthur_profiles WHERE external_id=$2),$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.id, record.ownerId, record.domain, record.statement, record.reason,
        record.status, record.supersedesDecisionId || null, record.createdAt, record.updatedAt || record.createdAt]
    );
    return mapCommon(first(result));
  }

  async getDecision(id) {
    return mapCommon(first(await this.client.query('SELECT * FROM arthur_decisions WHERE id=$1', [id])));
  }

  async putConfirmation(record) {
    const result = await this.client.query(
      `INSERT INTO arthur_confirmations
       (id, owner_id, domain, skill_id, action_type, risk, status, payload_json,
        payload_fingerprint, expires_at, resolved_at, executed_at, created_at, updated_at)
       VALUES ($1,(SELECT id FROM arthur_profiles WHERE external_id=$2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, resolved_at=EXCLUDED.resolved_at,
         executed_at=EXCLUDED.executed_at, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.id, record.ownerId, record.domain, record.skillId, record.actionType, record.risk,
        record.status, record.payload, record.payloadFingerprint, record.expiresAt || null,
        record.resolvedAt || null, record.executedAt || null, record.createdAt, record.updatedAt]
    );
    return mapCommon(first(result));
  }

  async getConfirmation(id) {
    return mapCommon(first(await this.client.query('SELECT * FROM arthur_confirmations WHERE id=$1', [id])));
  }

  async appendAudit(record) {
    const result = await this.client.query(
      `INSERT INTO arthur_audit_events
       (id, actor_id, actor_type, domain, action, entity_type, entity_id,
        before_json, after_json, correlation_id, result, error_code, error_message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [record.id, record.actorId, record.actorType, record.domain, record.action,
        record.entityType, record.entityId, record.before || null, record.after || null,
        record.correlationId, record.result || 'success', record.error && record.error.code || null,
        record.error && record.error.message || null, record.createdAt]
    );
    return mapCommon(first(result));
  }

  async listAudit({ entityId, correlationId } = {}) {
    const clauses = [];
    const values = [];
    if (entityId) { values.push(entityId); clauses.push(`entity_id=$${values.length}`); }
    if (correlationId) { values.push(correlationId); clauses.push(`correlation_id=$${values.length}`); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.client.query(`SELECT * FROM arthur_audit_events${where} ORDER BY created_at`, values);
    return result.rows.map(mapCommon);
  }
}

module.exports = { PostgresArthurStore, mapProfile, mapCommon };
