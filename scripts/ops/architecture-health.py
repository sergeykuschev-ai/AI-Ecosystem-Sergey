#!/usr/bin/env python3
import json, os, subprocess, time
from pathlib import Path

OUT = Path('/var/lib/sergey-architecture-health')
OUT.mkdir(parents=True, exist_ok=True)
checks = {}
errors = []
warnings = []

def run(args):
    return subprocess.run(args, text=True, capture_output=True)

def container(name):
    p = run(['docker','inspect','-f','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',name])
    state = p.stdout.strip() if p.returncode == 0 else 'missing'
    checks[f'container:{name}'] = state
    if state not in ('healthy','running'): errors.append(f'{name}:{state}')

for name in ('app-web-1','app-directus-1','app-postgres-1','business-kpi-web-1','business-kpi-postgres-1','miska-purchasing','arthur-core-api-1','arthur-core-postgres-1'):
    container(name)

for unit in ('tailscaled.service','instagram-germany-tunnel.service','miska-purchasing-health.timer','stores-public-health.timer','stores-seo-monitor.timer','sergey-architecture-backup.timer','sergey-offhost-backup.timer'):
    p = run(['systemctl','is-active',unit])
    state = p.stdout.strip()
    checks[f'unit:{unit}'] = state
    if state != 'active': errors.append(f'{unit}:{state}')
disk = os.statvfs('/')
disk_used = round((1 - disk.f_bavail / disk.f_blocks) * 100)
checks['disk_percent'] = disk_used
if disk_used >= 90: errors.append(f'disk:{disk_used}%')
elif disk_used >= 80: warnings.append(f'disk:{disk_used}%')

backup = Path('/var/backups/sergey-architecture/last.json')
if backup.exists():
    age_h = round((time.time() - backup.stat().st_mtime) / 3600, 1)
    checks['architecture_backup_age_hours'] = age_h
    if age_h > 30: errors.append(f'architecture_backup_age:{age_h}h')
    try:
        backup_payload = json.loads(backup.read_text())
        arthur_backup = Path(backup_payload.get('arthur_core', ''))
        checks['arthur_backup_present'] = bool(backup_payload.get('arthur_core')) and arthur_backup.is_file()
        if checks['arthur_backup_present']:
            arthur_age_h = round((time.time() - arthur_backup.stat().st_mtime) / 3600, 1)
            checks['arthur_backup_age_hours'] = arthur_age_h
            if arthur_age_h > 30:
                errors.append(f'arthur_backup_age:{arthur_age_h}h')
        else:
            checks['arthur_backup_age_hours'] = None
            errors.append('arthur_backup:missing')
    except Exception:
        checks['arthur_backup_present'] = False
        checks['arthur_backup_age_hours'] = None
        errors.append('architecture_backup_state:invalid')
else:
    checks['architecture_backup_age_hours'] = None
    checks['arthur_backup_present'] = False
    checks['arthur_backup_age_hours'] = None
    errors.append('architecture_backup:missing')

offhost = Path('/var/backups/sergey-architecture/offhost-last.json')
if offhost.exists():
    age_h = round((time.time() - offhost.stat().st_mtime) / 3600, 1)
    checks['offhost_backup_age_hours'] = age_h
    try:
        offhost_payload = json.loads(offhost.read_text())
        checks['offhost_backup_status'] = offhost_payload.get('status')
        if offhost_payload.get('status') != 'ok':
            errors.append(f"offhost_backup_status:{offhost_payload.get('status')}")
    except Exception:
        checks['offhost_backup_status'] = 'invalid'
        errors.append('offhost_backup_state:invalid')
    if age_h > 30:
        errors.append(f'offhost_backup_age:{age_h}h')
else:
    checks['offhost_backup_age_hours'] = None
    checks['offhost_backup_status'] = 'missing'
    errors.append('offhost_backup:missing')

p = run(['ss','-lntH'])
public = []
for line in p.stdout.splitlines():
    parts = line.split()
    if len(parts) < 4: continue
    local = parts[3]
    if local.startswith('0.0.0.0:') or local.startswith('[::]:'):
        try: port = int(local.rsplit(':',1)[1])
        except ValueError: continue
        if port not in (22,80,443): public.append(port)
checks['unexpected_public_tcp_ports'] = sorted(set(public))
if public: errors.append('unexpected_public_tcp_ports')
for url, key in (('http://127.0.0.1:3210/','purchasing_http'),('http://127.0.0.1:3220/health','business_kpi_http')):
    p = run(['curl','-fsS','--max-time','5','-o','/dev/null','-w','%{http_code}',url])
    code = p.stdout.strip() if p.returncode == 0 else 'error'
    checks[key] = code
    if code != '200': errors.append(f'{key}:{code}')

p = run(['systemctl','is-active','kimi-worker.timer'])
kimi_timer = p.stdout.strip()
checks['kimi_worker_timer'] = kimi_timer
if kimi_timer != 'active': warnings.append(f'kimi_worker_timer:{kimi_timer}')

status = 'error' if errors else ('warning' if warnings else 'ok')
payload = {
    'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'status': status,
    'checks': checks,
    'warnings': warnings,
    'errors': errors,
}
tmp = OUT / 'latest.json.tmp'
tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
os.chmod(tmp, 0o600)
tmp.replace(OUT / 'latest.json')
print(json.dumps(payload, ensure_ascii=False))
raise SystemExit(1 if errors else 0)
