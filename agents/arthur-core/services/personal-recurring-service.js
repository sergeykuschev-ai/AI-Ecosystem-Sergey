'use strict';
const { createHash } = require('node:crypto');
const { mapCommon } = require('./postgres-store');

async function manageRecurring(service, ownerId, operation, input = {}, actorContext) {
  if (typeof ownerId !== 'string' || !ownerId.trim() || !['create','list','cancel'].includes(operation)) throw new TypeError('Invalid recurring operation');
  if (operation !== 'list' && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500)) throw new TypeError('Recurring title is required');
  if (input.sourceRef != null && (typeof input.sourceRef !== 'string' || !input.sourceRef.trim() || input.sourceRef.length > 2000)) throw new TypeError('Invalid recurring source');
  if (operation === 'create' && (!Array.isArray(input.weekdays) || !input.weekdays.length
    || input.weekdays.some(n => !Number.isInteger(n) || n < 1 || n > 7)
    || typeof input.localTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))) throw new TypeError('Weekdays and exact local time are required');
  return service.store.transaction(async store => {
    await store.lockPersonalMemoryOwner(ownerId);
    const profile = await store.getProfile(ownerId);
    if (!profile?.active) throw new TypeError('Active owner profile is required');
    const records = (await store.client.query(`SELECT r.*,p.external_id AS owner_id FROM arthur_personal_recurring r JOIN arthur_profiles p ON p.id=r.owner_id WHERE p.external_id=$1 AND r.active=true ORDER BY r.created_at`,[ownerId])).rows.map(mapCommon);
    if (operation === 'list') return { status: 'listed', records };
    const key = input.sourceRef ? 'personal.recurring-command:'+createHash('sha256').update(input.sourceRef).digest('hex') : null;
    if (key && await store.getActiveMemory(ownerId,'personal',key)) return { status: 'already_processed' };
    const now = service.now();
    const title = input.title.trim();
    let result;
    let before = null;
    let after = null;
    if (operation === 'create') {
      const weekdays = [...new Set(input.weekdays)].sort();
      const duplicate = records.find(r => r.title.toLocaleLowerCase('ru-RU') === title.toLocaleLowerCase('ru-RU') && r.localTime === input.localTime && JSON.stringify(r.weekdays) === JSON.stringify(weekdays));
      if (duplicate) result = {status:'duplicate',record:duplicate};
      else {
        const row = await store.client.query(`INSERT INTO arthur_personal_recurring(owner_id,title,weekdays,local_time,timezone,start_date,created_at,updated_at)
          SELECT id,$2,$3,$4::text,timezone,
          (($5::timestamptz AT TIME ZONE timezone)::date + CASE WHEN ($5::timestamptz AT TIME ZONE timezone)::time >= $4::text::time THEN 1 ELSE 0 END),$5,$5
          FROM arthur_profiles WHERE external_id=$1 RETURNING *`,[ownerId,title,weekdays,input.localTime,now]);
        after = {...mapCommon(row.rows[0]),ownerId}; result = {status:'created',record:after};
      }
    } else {
      const matches = records.filter(r => r.id === title || r.title.toLocaleLowerCase('ru-RU') === title.toLocaleLowerCase('ru-RU'));
      if (matches.length !== 1) result = {status:matches.length ? 'ambiguous':'not_found',candidates:matches};
      else {
        before = matches[0];
        after = {...before,active:false,updatedAt:now};
        await store.client.query('UPDATE arthur_personal_recurring SET active=false,updated_at=$2 WHERE id=$1',[before.id,now]);
        await store.client.query(`UPDATE arthur_tasks SET status='cancelled',updated_at=$2 WHERE recurring_id=$1 AND due_at >= $2::timestamptz AND status NOT IN ('done','cancelled')`,[before.id,now]);
        result = {status:'cancelled',record:after};
      }
    }
    if (after) await service.audit(store,{context:service.context(actorContext),domain:'personal',action:'recurring.'+operation,entityType:'recurring_task',entityId:after.id,before,after});
    if (key) await store.putMemory({id:service.idFactory(),ownerId,domain:'personal',type:'reference',key,value:{status:result.status},sourceType:'api',sourceRef:input.sourceRef,confidence:1,sensitivity:'restricted',status:'active',validFrom:now,createdAt:now,updatedAt:now});
    return result;
  });
}
module.exports = { manageRecurring };
