#!/usr/bin/env python3
import base64
import json
import os
import subprocess
import time
from pathlib import Path

MISKA_ROOT = Path("/opt/stores-web/data/onec-exchange")
STATE_DIR = Path("/var/lib/stores-onec-freshness")
STATE_PATH = STATE_DIR / "state.json"
MISKA_THRESHOLD = int(os.environ.get("MISKA_ONEC_FRESHNESS_THRESHOLD_SECONDS", "2700"))
KPI_THRESHOLD = int(os.environ.get("BUSINESS_KPI_ONEC_FRESHNESS_THRESHOLD_SECONDS", "129600"))
STATE_DIR.mkdir(parents=True, exist_ok=True)

def run(args):
    return subprocess.run(args, text=True, capture_output=True)

def newest(pattern):
    files=[p for p in MISKA_ROOT.rglob(pattern) if p.is_file()]
    return max(files,key=lambda p:p.stat().st_mtime) if files else None

def age(path, now):
    return None if path is None else max(0,int(now-path.stat().st_mtime))

def human(seconds):
    if seconds is None: return "нет файла"
    m=seconds//60
    if m<60: return f"{m} мин"
    h,m=divmod(m,60)
    if h<48: return f"{h} ч {m} мин"
    d,h=divmod(h,24)
    return f"{d} д {h} ч"

def kpi_status(now):
    sql="select count(*)::text || '|' || coalesce(extract(epoch from max(received_at))::bigint::text,'') from business_kpi.onec_sync_batches;"
    p=run(["docker","exec","business-kpi-postgres-1","sh","-lc",
           'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '+json.dumps(sql)])
    if p.returncode != 0:
        return {"status":"error","error":"query_failed","batch_count":None,"last_received":None,"age_seconds":None}
    raw=p.stdout.strip()
    try:
        count_s,epoch_s=raw.split("|",1)
        count=int(count_s)
    except Exception:
        return {"status":"error","error":"query_parse_failed","batch_count":None,"last_received":None,"age_seconds":None}
    if count == 0 or not epoch_s:
        return {"status":"not_started","batch_count":count,"last_received":None,"age_seconds":None}
    epoch=int(epoch_s)
    a=max(0,int(now-epoch))
    return {"status":"fresh" if a<=KPI_THRESHOLD else "stale","batch_count":count,
            "last_received":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(epoch)),
            "age_seconds":a}

def notify_owner(message):
    encoded=base64.b64encode(message.encode()).decode()
    js=r"""
const { loadConfig } = require('./agents/arthur-v1/telegram/config');
const { createTelegramClient } = require('./agents/arthur-v1/telegram/telegram_client');
(async () => {
  const config=loadConfig();
  const ids=Array.from(config.allowedUserIds);
  if (ids.length !== 1) throw new Error('Expected exactly one owner Telegram ID');
  const client=createTelegramClient({token:config.token,apiBaseUrl:config.apiBaseUrl,timeoutMs:config.requestTimeoutMs,maxRetries:config.maxRetries,retryDelayMs:config.retryDelayMs});
  const msg=Buffer.from(process.env.OPS_ALERT_B64||'', 'base64').toString('utf8');
  await client.sendMessage(ids[0],msg);
})().catch(e=>{console.error(e && e.message ? e.message : String(e)); process.exit(1);});
"""
    p=run(["docker","exec","-e",f"OPS_ALERT_B64={encoded}","arthur-core-telegram-gateway-1","node","-e",js])
    return p.returncode == 0

now=time.time()
imp=newest("import*.xml")
off=newest("offers*.xml")
imp_age=age(imp,now)
off_age=age(off,now)
miska_status="fresh" if imp_age is not None and off_age is not None and imp_age<=MISKA_THRESHOLD and off_age<=MISKA_THRESHOLD else "stale"
kpi=kpi_status(now)

try:
    prev=json.loads(STATE_PATH.read_text()) if STATE_PATH.exists() else {}
except Exception:
    prev={}

messages=[]
prev_miska=(prev.get("miska") or {}).get("status")
if miska_status=="stale" and prev_miska!="stale":
    messages.append(f"🚨 Миска: выгрузка 1С устарела. import: {human(imp_age)}, offers: {human(off_age)}. Порог: {MISKA_THRESHOLD//60} мин.")
elif miska_status=="fresh" and prev_miska=="stale":
    messages.append(f"✅ Миска: обмен с 1С восстановился. import: {human(imp_age)}, offers: {human(off_age)}.")

prev_kpi=(prev.get("business_kpi") or {}).get("status")
if kpi["status"]=="stale" and prev_kpi=="fresh":
    messages.append(f"🚨 KPI: production 1С batch устарел. Последний batch: {human(kpi['age_seconds'])} назад.")
elif kpi["status"]=="fresh" and prev_kpi in ("stale","not_started"):
    messages.append("✅ KPI: production-поток 1С в Integration API активен и свеж.")

notify_results=[]
for m in messages:
    notify_results.append("sent" if notify_owner(m) else "failed")

payload={
  "checked_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(now)),
  "miska":{"status":miska_status,"threshold_seconds":MISKA_THRESHOLD,
           "import_file":str(imp) if imp else None,"import_age_seconds":imp_age,
           "offers_file":str(off) if off else None,"offers_age_seconds":off_age},
  "business_kpi":{**kpi,"threshold_seconds":KPI_THRESHOLD},
  "notifications":notify_results,
}
tmp=STATE_PATH.with_suffix(".json.tmp")
tmp.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n")
os.chmod(tmp,0o600)
tmp.replace(STATE_PATH)
print(json.dumps(payload,ensure_ascii=False))
