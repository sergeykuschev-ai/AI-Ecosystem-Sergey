# Personal Arthur production deployment — 2026-10-09

## Verified target and revision

The existing Telegram Gateway and its Core API were updated on the Amursk
Windows host `DESKTOP-6NKDIC8`. `stores-web1` was used as an SSH bridge; the
personal services were not moved to that VPS. The separate `arthur-local-prod`
stack was not changed.

PRs [225](https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/pull/225),
[226](https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/pull/226), and
[227](https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/pull/227) were merged
in order. Candidate sources derive from main revision
`86cff20fa8a66437769d3dfa3d01ae6a5e268d1a`, with the existing host adaptations
retained. This is not a claim that the complete live source tree is identical
to that Git revision.

The host had local changes for three-store KPI reporting, seller learning
notifications, VOZDOOH order notifications, and advertising leads. Those changes
were applied to a separate candidate worktree. The notification HTTP handler
was retained from production when its patch conflicted. Existing purchasing
datasets, credentials and volumes were preserved. The old KPI scheduler's file
hash matched the host source before integration.

## Active configuration

All personal feature switches are enabled: tasks with explicit reminders,
morning/evening briefings, explicit memory commands and lexical recall.
The canonical active profile is `sergey`, timezone `Asia/Vladivostok`.

| Setting | Value |
|---|---|
| Morning briefing | 09:00 |
| Evening briefing | 21:00 |
| Quiet hours | 22:00–08:00 |
| Allowed Telegram owners | One |

Existing KPI daily, weekly and alert automation remained running. Mail and
external notification routes retain their existing configuration; they were
not exercised by sending unrelated business messages during this deployment.

## Images and storage

| Container | Image tag | Verified image ID |
|---|---|---|
| `arthur-core-api-1` | `arthur-core-api:personal-20261009` | `sha256:bb6504985ddd32d987c54f68cf825b15bdeb887a7bbcecb50d8c33c5439149aa` |
| `arthur-core-telegram-gateway-1` | `arthur-core-telegram-gateway:personal-20261009` | `sha256:8bc17d05428fa2a4f2e8501288ab8552bf4605eb748ddfd18675dad940c21a3b` |

Both images layer the reviewed candidate code over the previous production
images, preserving their unrelated runtime assets. Compose image references,
personal settings and corresponding host Arthur sources were updated so later
restarts do not revert to the old feature set. The existing modified repository
was not reset or cleaned.

Migration `005_personal_notifications` was applied through the migration runner:
one migration applied, five skipped after checksum verification. The previously
applied host-only `005_kpi_monthly_report` migration was retained unchanged;
versions are full filenames, so these two names are distinct.

## Runtime evidence

The deploy directory is
`C:\AI-Ecosystem\deployments\arthur-personal-20261009-1018`.
Its ACL is restricted to the administrator and SYSTEM. It contains the database
dump, previous configuration and source, captured runtime configuration,
candidate/build logs and verification script. Credentials were not committed.

| Check | Observed result |
|---|---|
| Database backup | Custom-format `pg_dump` copied to host; `pg_restore --list` succeeded |
| Targeted candidate tests | 135 passed, 0 failed |
| Notifications SQL acceptance | PASS: owner isolation, restart, leases and delivery behavior |
| Memory SQL/HTTP acceptance | PASS: versioning, replay protection, owner isolation, rollback and HTTP |
| Disposable acceptance DB | Created separately on the cluster and removed after checks |
| Live task command | A newline list produced two separate personal tasks |
| Live reminder | A third test task retained its explicit reminder time |
| Restart persistence | All three test tasks and the explicit note survived Core/Gateway restart |
| Recall | Returned the saved test note with source metadata |
| Edit and forget | Replacement confirmed; no matching active note remained after forgetting |
| Morning catch-up | Ledger `morning:2026-10-09`, state `sent`, Telegram message ID 405, attempts 1 |
| Real test reminder | Ledger task `fc621f5b-64c8-4a14-998b-c0173370b8b5`, state `sent`, Telegram message ID 406, attempts 1 |
| Restart deduplication | Both delivery IDs and attempt counts remained unchanged after another Gateway restart |
| Final health | Core and Gateway healthy; personal scheduler running, Vladivostok timezone, no last error |
| Cleanup | Test tasks cancelled; test note absent from active memory |

The blanket test run inside the production image was not wholly green: it
encountered missing development-only fixtures/dependencies, a generic migration
assertion incompatible with the existing constraint-only monthly migration,
and stale single-store expectations for the preserved three-store KPI scheduler.
These results were not presented as passing. The affected personal path was
checked with the 135-test run and actual PostgreSQL/live restart checks above.
Repository release CI had passed separately before merging.

Test history remains in task/audit storage and archived memory; cleanup did not
erase history. Screenshot errands were not automatically imported.

## Rollback and limits

Previous images are retained as `arthur-core-api:pre-personal-20261009` and
`arthur-core-telegram-gateway:pre-personal-20261009`. Restore the backed-up env
and Compose configuration, then recreate only API/Gateway using the retained
images without rebuilding. Leave the additive personal migration in place;
restoring a database or running its destructive down migration is a separate
recovery decision.

Semantic retrieval, recurrence, snooze controls and calendar integration remain
unimplemented. Reminder delivery remains at least once: a lost Telegram
acknowledgement before ledger completion can cause a retry. These successful
checks confirm the tested outcomes, not an exactly-once guarantee.
