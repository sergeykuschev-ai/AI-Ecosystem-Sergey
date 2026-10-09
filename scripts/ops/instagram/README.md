# Instagram scheduled publishing

Production path: `/opt/instagram-automation`.

The publisher timer runs every five minutes. The service first releases any due scheduled item into the profile inbox, then the existing publisher processes at most one inbox item.

Scheduled file names use UTC:

```
YYYYMMDDTHHMMSSZ__slug.caption.txt
YYYYMMDDTHHMMSSZ__slug.jpg
```

Supported media: jpg, jpeg, png, mp4, mov, m4v.

Install/update:

```bash
install -m 0755 scripts/ops/instagram/promote-scheduled.sh /opt/instagram-automation/promote-scheduled.sh
install -m 0644 scripts/ops/systemd/instagram-publisher@.service /etc/systemd/system/instagram-publisher@.service
install -m 0644 scripts/ops/systemd/instagram-publisher@.timer /etc/systemd/system/instagram-publisher@.timer
systemctl daemon-reload
systemctl enable --now instagram-publisher@default.timer
```

There is intentionally no separate scheduler timer. Keeping release + publish in the same oneshot service avoids timer drift and ensures one five-minute cadence controls both operations.
