# Personal recurring tasks and Telegram buttons

Commands are deterministic and require personal reminders to be enabled:

- `Напоминай английский каждый день в 20:00`
- `Спортзал по понедельникам, средам и пятницам в 18:00`
- `Покажи повторяющиеся дела`
- `Отмени повтор английский`

A schedule stores the owner's profile timezone at creation. An explicit local
hour and minute are required. If today's time has passed, the schedule begins
from tomorrow, respecting the selected weekdays. It produces one independent
personal task for each applicable current local day. Completing one occurrence
does not disable the schedule. Stopping a schedule cancels its future active
occurrences; already overdue occurrences remain for explicit user handling.
Missed historical dates after downtime are not generated in bulk. Quiet hours
continue to defer notifications until the next allowed period.

Each newly sent task reminder includes buttons: **Выполнено**, **Через 30 минут**,
and **Отменить напоминание**. The last button clears that occurrence's reminder
and preserves the task deadline, status and future recurring schedule. Snooze
moves only its reminder to 30 minutes after the click. Completing marks only that
occurrence done. An old keyboard becomes stale when the task version changes.
Buttons on reminders sent before this release are not retroactively attached.

Callbacks require the allowed Telegram identity in its private chat. Core uses
the configured owner, validates the domain, locks the task, checks its version,
and atomically persists the change, audit and callback receipt. Duplicate clicks
cannot perform the same mutation twice. Keyboard cleanup follows a confirmed
Core result; cleanup failure does not undo the action. An already in-flight
notification may still arrive after cancellation.

## Storage and API

Migration `006_personal_recurring` adds the schedule table and unique
`(recurring_id, occurrence_date)` task index. Owner row locking serializes
occurrence generation against schedule cancellation. Newly generated occurrences
are audited. Existing task and business notification fields remain intact.

Authenticated endpoints:

- `POST /v1/personal-recurring`: `ownerId`, `operation` (`create`, `list`, `cancel`),
  `title` for mutations, `weekdays` (ISO 1–7) and `localTime` for create, optional
  `sourceRef` for replay protection. GET with ownerId lists active schedules.
- `POST /v1/tasks/:id/personal-action`: `ownerId`, `action` (`done`, `snooze`,
  `cancel`), `expectedUpdatedAt`, optional `sourceRef`.

Schedule cancellation uses an exact title. Duplicate active titles with distinct
schedules return schedule IDs to select with `Отмени повтор <id>`; no broad title match is silently cancelled.
Changing the owner profile timezone does not silently move existing schedules.
Schedule editing, arbitrary recurrence expressions and habit statistics are not
part of this release.

## Verification

`npm run test:arthur` covers parsing, routing, callback size/version, owner/private
chat restrictions and existing behavior. `node scripts/arthur/check-personal-memory.js`
now includes PostgreSQL occurrence creation, deduplication, weekday selection,
completion, snooze, schedule cancellation, replay protection and authenticated
HTTP contracts in an isolated test/CI database.
