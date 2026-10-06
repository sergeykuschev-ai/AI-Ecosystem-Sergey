#!/usr/bin/env python3
import base64
import json
import os
import subprocess
import time
from pathlib import Path

EXCHANGE_ROOT = Path(os.environ.get("VOZDOOH_ONEC_EXCHANGE_ROOT", "/opt/vozdooh/data/onec-exchange"))
STATE_DIR = Path(os.environ.get("VOZDOOH_ONEC_FRESHNESS_STATE_DIR", "/var/lib/vozdooh-onec-freshness"))
THRESHOLD_SECONDS = int(os.environ.get("VOZDOOH_ONEC_FRESHNESS_THRESHOLD_SECONDS", "2700"))
STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_PATH = STATE_DIR / "state.json"


def run(args):
    return subprocess.run(args, text=True, capture_output=True)


def newest(pattern):
    files = [p for p in EXCHANGE_ROOT.rglob(pattern) if p.is_file()]
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def age_seconds(path, now):
    return None if path is None else max(0, int(now - path.stat().st_mtime))


def human_age(seconds):
    if seconds is None:
        return "нет файла"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} мин"
    hours, minutes = divmod(minutes, 60)
    if hours < 48:
        return f"{hours} ч {minutes} мин"
    days, hours = divmod(hours, 24)
    return f"{days} д {hours} ч"


def notify_owner(message):
    encoded = base64.b64encode(message.encode("utf-8")).decode("ascii")
    script = r"""
const { loadConfig } = require('./agents/arthur-v1/telegram/config');
const { createTelegramClient } = require('./agents/arthur-v1/telegram/telegram_client');
(async () => {
  const config = loadConfig();
  const ids = Array.from(config.allowedUserIds);
  if (ids.length !== 1) throw new Error('Expected exactly one owner Telegram ID');
  const client = createTelegramClient({
    token: config.token,
    apiBaseUrl: config.apiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
  });
  const text = Buffer.from(process.env.OPS_ALERT_B64 || '', 'base64').toString('utf8');
  await client.sendMessage(ids[0], text);
})().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
"""
    p = run([
        "docker", "exec", "-e", f"OPS_ALERT_B64={encoded}",
        "arthur-core-telegram-gateway-1", "node", "-e", script,
    ])
    return p.returncode == 0


now = time.time()
import_file = newest("import*.xml")
offers_file = newest("offers*.xml")
import_age = age_seconds(import_file, now)
offers_age = age_seconds(offers_file, now)
fresh = (
    import_age is not None
    and offers_age is not None
    and import_age <= THRESHOLD_SECONDS
    and offers_age <= THRESHOLD_SECONDS
)
status = "fresh" if fresh else "stale"

try:
    previous = json.loads(STATE_PATH.read_text()) if STATE_PATH.exists() else {}
except Exception:
    previous = {}

notification = None
if status == "stale" and previous.get("status") != "stale":
    notification = (
        "🚨 VOZDOOH: выгрузка 1С устарела.\n"
        f"• import: {human_age(import_age)}\n"
        f"• offers/остатки: {human_age(offers_age)}\n"
        f"Порог контроля: {THRESHOLD_SECONDS // 60} мин. "
        "Каталог продолжает собираться из последней полученной выгрузки."
    )
elif status == "fresh" and previous.get("status") == "stale":
    notification = (
        "✅ VOZDOOH: обмен с 1С снова свежий.\n"
        f"• import: {human_age(import_age)}\n"
        f"• offers/остатки: {human_age(offers_age)}"
    )

notify_result = None
if notification:
    notify_result = "sent" if notify_owner(notification) else "failed"

payload = {
    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
    "status": status,
    "threshold_seconds": THRESHOLD_SECONDS,
    "import_file": str(import_file) if import_file else None,
    "import_age_seconds": import_age,
    "offers_file": str(offers_file) if offers_file else None,
    "offers_age_seconds": offers_age,
    "notification": notify_result,
}
tmp = STATE_PATH.with_suffix(".json.tmp")
tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
os.chmod(tmp, 0o600)
tmp.replace(STATE_PATH)
print(json.dumps(payload, ensure_ascii=False))
