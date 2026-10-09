'use strict';

const { randomUUID } = require('node:crypto');
const { PostgresArthurStore, mapCommon } = require('./postgres-store');

// Keep the delivery ledger in the same durable database as personal tasks.
function createPersonalNotificationStore(pool) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('PostgreSQL pool is required');
  return {
    async initialize(ownerId) {
      const result = await pool.query(
        `SELECT p.timezone FROM arthur_profiles p
         WHERE p.external_id=$1 AND p.active=true`, [ownerId]
      );
      if (!result.rows[0]) throw new Error('Active personal owner profile is required');
      await pool.query('SELECT delivery_key FROM arthur_personal_deliveries LIMIT 0');
      await pool.query('SELECT remind_at, recurring_id FROM arthur_tasks LIMIT 0');
      await pool.query('SELECT id FROM arthur_personal_recurring LIMIT 0');
      return result.rows[0];
    },
    async materializeRecurring(ownerId, now) {
      // One occurrence per owner-local date, including after restart; missed past dates are not replayed.
      return new PostgresArthurStore({client:pool}).transaction(async store => {
      await store.lockPersonalMemoryOwner(ownerId);
      const created = await store.client.query(`INSERT INTO arthur_tasks(owner_id,domain,title,status,due_at,remind_at,source_type,source_ref,recurring_id,occurrence_date)
        SELECT r.owner_id,'personal',r.title,'new',
          (((($2::timestamptz AT TIME ZONE r.timezone)::date)::text || ' ' || r.local_time)::timestamp AT TIME ZONE r.timezone),
          (((($2::timestamptz AT TIME ZONE r.timezone)::date)::text || ' ' || r.local_time)::timestamp AT TIME ZONE r.timezone),
          'api','recurring:'||r.id::text||':'||(($2::timestamptz AT TIME ZONE r.timezone)::date)::text,r.id,($2::timestamptz AT TIME ZONE r.timezone)::date
        FROM arthur_personal_recurring r JOIN arthur_profiles p ON p.id=r.owner_id
        WHERE p.external_id=$1 AND p.active=true AND r.active=true
          AND ($2::timestamptz AT TIME ZONE r.timezone)::date >= r.start_date
          AND extract(isodow FROM ($2::timestamptz AT TIME ZONE r.timezone))::integer=ANY(r.weekdays)
        ON CONFLICT (recurring_id,occurrence_date) WHERE recurring_id IS NOT NULL DO NOTHING RETURNING *`,[ownerId,now]);
      const { AsyncArthurCoreService } = require('./async-arthur-core-service');
      const service = new AsyncArthurCoreService({store,clock:()=>new Date(now)});
      for (const row of created.rows) await service.audit(store,{context:service.context(),domain:'personal',action:'task.create',entityType:'task',entityId:row.id,after:{...mapCommon(row),ownerId}});
      return created.rows.length;
      });
    },
    async listTasks(ownerId) {
      const result = await pool.query(
        `SELECT t.*, p.external_id AS owner_id FROM arthur_tasks t
         JOIN arthur_profiles p ON p.id=t.owner_id
         WHERE p.external_id=$1 AND p.active=true AND t.domain='personal'
           AND t.status NOT IN ('done','cancelled')
         ORDER BY t.due_at NULLS LAST, t.created_at`, [ownerId]
      );
      return result.rows.map(mapCommon);
    },
    async claim(ownerId, key, now) {
      const claimId = randomUUID();
      const result = await pool.query(
        `INSERT INTO arthur_personal_deliveries
           (owner_id, delivery_key, state, claim_id, lease_until, updated_at)
         VALUES ((SELECT id FROM arthur_profiles WHERE external_id=$1), $2, 'sending', $3,
           $4::timestamptz + interval '5 minutes', $4)
         ON CONFLICT (owner_id, delivery_key) DO UPDATE SET
           state='sending', claim_id=EXCLUDED.claim_id, lease_until=EXCLUDED.lease_until,
           attempts=arthur_personal_deliveries.attempts+1, updated_at=EXCLUDED.updated_at
         WHERE arthur_personal_deliveries.state <> 'sent'
           AND arthur_personal_deliveries.lease_until <= $4::timestamptz
         RETURNING claim_id`, [ownerId, key, claimId, now]
      );
      return result.rows[0]?.claim_id || null;
    },
    async finish(ownerId, key, claimId, now, messageId) {
      const result = await pool.query(
        `UPDATE arthur_personal_deliveries SET state='sent', sent_at=$4,
           telegram_message_id=$5, updated_at=$4
         WHERE owner_id=(SELECT id FROM arthur_profiles WHERE external_id=$1)
           AND delivery_key=$2 AND claim_id=$3 AND state='sending'
         RETURNING delivery_key`, [ownerId, key, claimId, now, messageId || null]
      );
      if (!result.rows.length) throw new Error('Personal delivery lease was lost');
    },
    async retry(ownerId, key, claimId, now) {
      await pool.query(
        `UPDATE arthur_personal_deliveries SET state='retry',
           lease_until=$4::timestamptz + interval '1 minute', updated_at=$4
         WHERE owner_id=(SELECT id FROM arthur_profiles WHERE external_id=$1)
           AND delivery_key=$2 AND claim_id=$3 AND state='sending'`,
        [ownerId, key, claimId, now]
      );
    },
  };
}

module.exports = { createPersonalNotificationStore };
