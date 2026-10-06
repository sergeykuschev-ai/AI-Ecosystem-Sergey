#!/usr/bin/env python3
import json
import socket
import ssl
import subprocess
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

DOMAIN = "vozdooh27.ru"
EXPECTED_IP = "138.16.155.126"
STATE = Path("/opt/vozdooh/state/public-health")
STATE.mkdir(parents=True, exist_ok=True)

def http_check(path):
    started = time.monotonic()
    try:
        req = urllib.request.Request(
            f"https://{DOMAIN}{path}",
            headers={"User-Agent": "vozdooh-health/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            response.read(1)
            return {
                "ok": response.status == 200,
                "status": response.status,
                "ms": round((time.monotonic() - started) * 1000),
            }
    except Exception as exc:
        return {
            "ok": False,
            "error": type(exc).__name__,
            "ms": round((time.monotonic() - started) * 1000),
        }

dns_answers = []
try:
    p = subprocess.run(
        ["dig", "+time=3", "+tries=1", "+short", DOMAIN, "A"],
        capture_output=True, text=True, timeout=5,
    )
    dns_answers = [x.strip() for x in p.stdout.splitlines() if x.strip()]
    dns_ok = p.returncode == 0 and EXPECTED_IP in dns_answers
except Exception:
    dns_ok = False

http = {path: http_check(path) for path in ["/", "/robots.txt", "/sitemap.xml", "/api/health"]}

tls = {"ok": False}
try:
    ctx = ssl.create_default_context()
    with socket.create_connection((DOMAIN, 443), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=DOMAIN) as tls_sock:
            cert = tls_sock.getpeercert()
    expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    days = (expires - datetime.now(timezone.utc)).total_seconds() / 86400
    tls = {"ok": days > 14, "expires_utc": expires.isoformat(), "days_remaining": round(days, 1)}
except Exception as exc:
    tls = {"ok": False, "error": type(exc).__name__}

now = datetime.now(timezone.utc)
out = {
    "timestamp_utc": now.isoformat(),
    "domain": DOMAIN,
    "dns": {"ok": dns_ok, "expected": EXPECTED_IP, "answers": dns_answers},
    "http": http,
    "tls": tls,
    "all_http_ok": all(v.get("ok") for v in http.values()),
}
out["ok"] = dns_ok and out["all_http_ok"] and tls.get("ok", False)
payload = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
stamp = now.strftime("%Y%m%dT%H%M%SZ")
(STATE / f"health-{stamp}.json").write_text(payload)
(STATE / "latest.json").write_text(payload)
cutoff = now - timedelta(days=30)
for p in STATE.glob("health-*.json"):
    if datetime.fromtimestamp(p.stat().st_mtime, timezone.utc) < cutoff:
        p.unlink()
print(payload, end="")
raise SystemExit(0 if out["ok"] else 1)
