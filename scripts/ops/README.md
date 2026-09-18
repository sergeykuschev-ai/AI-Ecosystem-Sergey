# Production operations

These files describe host-level operations that are intentionally outside application containers but must still be version controlled.

## Verified source/runtime mapping (2026-09-17)

- Stores website: deployed tracked files match `origin/main` exactly.
- Business KPI: running container code matches server branch `business-kpi-amper-ventil` at `c2572e021d5b6e77b412db118210ae1f45fbd812` for checked critical files.
- Purchasing: running image `miska-purchasing:3d38b2a` maps to `origin/work/purchasing-server-20260915` at `3d38b2a4a6b95cb9da53fd3bbb96619241458d54`; server `app` and `release` copies were synchronized to that ref after backup.

Do not infer a deployment revision from timestamps or directory names. New deploy workflows should write an explicit immutable revision marker.

## Architecture backup

`sergey-architecture-backup.sh` creates validated custom-format PostgreSQL dumps for Stores Web, Business KPI, and Arthur Core plus a Directus uploads archive. Every PostgreSQL dump is validated with `pg_restore -l` before publication. Host retention is 14 days.

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

It checks the production application containers including Arthur Core API/PostgreSQL, required systemd services/timers, disk usage, local and off-host backup freshness, Arthur backup presence, loopback owner-app HTTP endpoints, and unexpected public TCP listeners. A disabled Kimi worker is a warning rather than a production outage.

Installed paths:

```text
/usr/local/sbin/sergey-architecture-health
/etc/systemd/system/sergey-architecture-health.service
/etc/systemd/system/sergey-architecture-health.timer
```

## Restore validation

A backup is not considered valid solely because a file exists. PostgreSQL custom-format dumps must pass `pg_restore -l`, and Directus archives must pass `tar -tzf` before they are relied upon.

## Encrypted off-host backup

`sergey-offhost-backup.sh` packages the latest Stores Web PostgreSQL dump, Business KPI PostgreSQL dump, Arthur Core PostgreSQL dump, Directus uploads archive, and the latest normal Miska Purchasing backup. The bundle format is `sergey-offhost-v2`. It is encrypted with `age` to every SSH public key in `/root/.ssh/authorized_keys` before it leaves the primary VPS.

The encrypted artifact is copied atomically over SSH to the Germany proxy host and verified with SHA-256 before publication. The remote host stores ciphertext only and keeps exactly one latest `sergey-offhost-*.tar.gz.age` emergency copy so the proxy disk is not used as backup storage.

Installed paths:

```text
/usr/local/sbin/sergey-offhost-backup
/etc/systemd/system/sergey-offhost-backup.service
/etc/systemd/system/sergey-offhost-backup.timer
/var/backups/sergey-architecture/offhost-last.json
```

The timer runs after the local architecture backup window. Architecture health treats a missing or older-than-30-hours off-host backup as an error.

Restore requires the private SSH key matching one of the configured recipients. Example on a trusted recovery machine:

```text
age --decrypt -i ~/.ssh/<matching-private-key> sergey-offhost-YYYYMMDDTHHMMSSZ.tar.gz.age > backup.tar.gz
tar -tzf backup.tar.gz
```

Do not copy the private decryption key to the Germany proxy.
