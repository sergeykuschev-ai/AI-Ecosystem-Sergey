# Personal Arthur implementation

## Scope and verified status

Continue the existing `arthur-v1` orchestrator and `arthur-core` database.
Telegram remains the owner channel. The Windows/Amursk production host has
not been accessed or changed by this implementation. Runtime activation is
separate from repository implementation and tests.

Implemented in this change:

- Dated commands and newline lists create individual personal tasks.
- Explicit `Напомни сегодня в 16:00 забрать заказ` sets `remindAt` on a task.
- A time-only reminder means today in the owner's configured timezone;
  elapsed times require clarification, rather than silently moving to tomorrow.
- Missing reminder times and recurring reminder requests ask for clarification.
- Deadlines alone never enable reminder delivery.
- Existing identical tasks can receive a reminder without creating a duplicate.
- Task rescheduling moves an existing reminder to the new deadline unless the
  caller explicitly supplies a different `remindAt` or clears it with `null`.
- Completed and cancelled tasks are excluded from notification selection.
- The personal scheduler sends due reminders and morning/evening briefings.
- Quiet hours defer messages; reminders catch up after recovery. Morning
  briefings catch up only before the evening window, for the current local day.
- Briefings include today's tasks, overdue tasks, due waiting checks, and
  tasks without deadlines. They do not automatically change task statuses.
- HTML escaping and bounded titles keep messages under the Telegram limit.
- Scheduler state is visible in Gateway health. Enabled but misconfigured
  personal scheduling prevents Gateway startup instead of accepting reminders
  that cannot be delivered.

## Data and boundaries

`arthur_tasks.remind_at` stores the explicit reminder time. Existing task
transactions also store audit events. The scheduler uses personal-domain
tasks for the canonical owner and reads timezone from the active profile.
Business tasks and other owners' tasks are excluded in PostgreSQL.

`arthur_personal_deliveries` is a durable delivery ledger. The unique key is
owner plus task ID/reminder occurrence, or owner plus briefing kind/local day.
Workers atomically claim a five-minute lease. Failed sends retry after one
minute; expired leases can be reclaimed. A confirmed delivery is not resent
after restart or by another worker. Claim tokens fence obsolete workers.

Telegram cannot be part of a PostgreSQL transaction. If Telegram accepts a
message but its acknowledgement or database completion is lost, a retry can
send it again. This is **at-least-once delivery**, not an exactly-once guarantee.
Telegram's existing request retries have the same ambiguity.

The Core API persists reminders and tasks; the existing Telegram Gateway owns
the scheduler and transport. No LLM is needed to schedule, format, or deliver
these messages. A timer only wakes the scheduler; durable state lives in the
database, not in the Node process or an n8n workflow.

## Deployment sequence

1. Back up the Arthur database using the existing production backup procedure.
2. Apply migration `005_personal_notifications.up.sql` using the existing
   migration runner. Restart/rebuild Core API before deploying the new Gateway;
   the updated task writer requires the new column even with automation off.
3. Verify the canonical owner's profile and timezone.
4. Configure `ARTHUR_PERSONAL_ENABLED=true` and enable the desired features:
   `ARTHUR_PERSONAL_REMINDERS_ENABLED`, `ARTHUR_PERSONAL_MORNING_ENABLED`,
   `ARTHUR_PERSONAL_EVENING_ENABLED`.
5. Review schedule and quiet-hour settings. Defaults are morning 09:00,
   evening 21:00, quiet hours 22:00–08:00, in the profile timezone.
6. Rebuild/restart the existing Gateway and inspect `personalScheduler` health.
7. Perform a controlled owner test: create a near-future reminder, verify the
   task and audit, receive the notification, restart Gateway, and verify no
   second confirmed delivery. Test reschedule and completion as well.

All new switches default to false. This change does not activate notifications
or create real owner tasks from screenshots.

Before rollback, disable personal scheduling and deploy the old API/Gateway.
The down migration deletes reminder times and delivery history; applying it to
production requires an explicit rollback decision and a restorable backup.

## Validation

```sh
npm run test:arthur
node scripts/arthur/check-personal-notifications.js
```

The second command requires `ARTHUR_DATABASE_URL` whose database name contains
`test` or `ci`. It creates a disposable schema, applies migrations, checks task
persistence, owner isolation, lease/retry behavior, restart deduplication,
rescheduling, completion, and migration rollback, then removes the schema.
CI runs this check against PostgreSQL 16. Local SQL acceptance also exercised
the same exported check on an embedded PostgreSQL engine.

## Remaining architecture stages

These are planned, not implemented or claimed active in production:

| Stage | Implementation | Acceptance gate |
|---|---|---|
| Reminder controls | Snooze buttons, cancellation of only a reminder, recurrence rules | No stale callbacks, owner validation, timezone and DST tests |
| Persistent personal memory | Explicit remember/edit/forget commands over existing versioned Core memory | Survives restart, has source and audit, scoped retrieval and owner isolation |
| Calendar | Read agenda, conflict checks, controlled event writes through an adapter | Account identity verified, event timezone and external results checked |
| Personal mail and documents | Owner-scoped accounts, document references, task extraction | Responses cite the original item; no unrequested outgoing messages |
| Projects and travel | Persistent next action, decision history, linked tasks and files | Project state remains current and traceable |
| Voice and images | Transcription and extraction into existing task/event contracts | Clarifies uncertain dates and names before writes |

The personal capability rollout does not require a 1C integration.
