# Personal reminder controls deployment — 2026-10-09

## Release

PR [229](https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/pull/229)
merged into main at `40cdf186954652ad60f07d256d2d24d80b5dc42f`.
Deployed on the existing Amursk Windows Arthur installation at approximately
10:43 Asia/Vladivostok. Both Core API and Telegram Gateway are healthy.

Images: `arthur-core-api:reminders-20261009` and
`arthur-core-telegram-gateway:reminders-20261009`.
Existing Windows business notifications, three-store KPI reporting and local
production adaptations were preserved. Host source was updated to reproduce the
image changes. No schema migration or production profile change was needed.

## Validation

- All 587 Arthur tests pass locally and Arthur Core CI completes successfully.
- CI PostgreSQL 16 storage/HTTP acceptance and Docker network smoke checks pass.
- The production Gateway image passes all four reminder control tests.
- The production API image passes isolated PostgreSQL/HTTP acceptance with the
  Gateway source mounted and Core dependency path set for the test runner.
  Initial attempts lacked these test-only dependencies; runtime was unaffected.
- Real authenticated Core calls from the running Gateway verified command routing,
  moving, cancellation, unchanged deadline/status and replay protection. Synthetic
  task `f52dd8af-6529-4fcc-97e3-499802a151ba` was cancelled after verification.
- Both schedulers run in Asia/Vladivostok with no reported error. KPI retains
  daily, weekly and alert automation and three daily store jobs.

Acceptance invoked the Gateway's deterministic command pipeline directly. A real
incoming Telegram user update was not required or claimed for this release.

## Recovery

Backup directory: `C:\AI-Ecosystem\deployments\arthur-reminders-20261009`.
It contains the database dump, original Compose definition and pre-update Core
and Gateway source. The previous `personal-20261009` images remain available.
Restore the Compose image references and restart only the API and Gateway to
roll back this code release; no database rollback is needed.

Cancellation affects future scheduler selection; an already in-flight message
may finish. Test tasks remain in cancelled history and audit records are retained.
