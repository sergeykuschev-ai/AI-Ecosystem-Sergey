# Production operations

These files describe host-level operations that are intentionally outside application containers but must still be version controlled.

## Verified source/runtime mapping (2026-09-17)

- Stores website: deployed tracked files match `origin/main` exactly.
- Business KPI: running container code matches server branch `business-kpi-amper-ventil` at `c2572e021d5b6e77b412db118210ae1f45fbd812` for checked critical files.
- Purchasing: running image `miska-purchasing:3d38b2a` maps to `origin/work/purchasing-server-20260915` at `3d38b2a4a6b95cb9da53fd3bbb96619241458d54`; server `app` and `release` copies were synchronized to that ref after backup.

Do not infer a deployment revision from timestamps or directory names. New deploy workflows should write an explicit immutable revision marker.

## Architecture backup

`sergey-architecture-backup.sh` creates validated custom-format PostgreSQL dumps for Stores Web and Business KPI plus a Directus uploads archive. Host retention is 14 days.

Installed paths:

```text
/usr/local/sbin/sergey-architecture-backup
/etc/systemd/system/sergey-architecture-backup.service
/etc/systemd/system/sergey-architecture-backup.timer
/var/backups/sergey-architecture/
```

The purchasing service keeps its separate existing daily backup of purchasing state.
## Architecture health

`architecture-health.py` runs every 15 minutes and records the latest status in:

```text
/var/lib/sergey-architecture-health/latest.json
```

It checks the core containers, required systemd services/timers, disk usage, backup freshness, loopback owner-app HTTP endpoints, and unexpected public TCP listeners. A disabled Kimi worker is currently a warning rather than a production outage.

Installed paths:

```text
/usr/local/sbin/sergey-architecture-health
/etc/systemd/system/sergey-architecture-health.service
/etc/systemd/system/sergey-architecture-health.timer
```

## Restore validation

A backup is not considered valid solely because a file exists. PostgreSQL custom-format dumps must pass `pg_restore -l`, and Directus archives must pass `tar -tzf` before they are relied upon.

## Off-host requirement

Host-local backups do not protect against loss of the VPS. Replication to a separately administered machine or storage account is still required. Do not send database dumps to an unverified Tailscale/SSH/SMB target merely because a port is reachable.
