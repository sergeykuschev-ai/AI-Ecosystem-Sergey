#!/usr/bin/env python3
import base64, json, os, subprocess, time
from pathlib import Path

OUT = Path('/var/lib/sergey-architecture-health')
OUT.mkdir(parents=True, exist_ok=True)
checks = {}
errors = []
warnings = []

def run(args):
    return subprocess.run(args, text=True, capture_output=True)

def http_code(url, insecure=False):
    args = ['curl', '-fsS', '--max-time', '5', '-o', '/dev/null', '-w', '%{http_code}']
    if insecure:
        args.insert(1, '-k')
    args.append(url)
    p = run(args)
    return p.stdout.strip() if p.returncode == 0 else 'error'

def notify_owner(message):
    encoded = base64.b64encode(message.encode('utf-8')).decode('ascii')
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
        'docker', 'exec', '-e', f'OPS_ALERT_B64={encoded}',
        'arthur-core-telegram-gateway-1', 'node', '-e', script
    ])
    return p.returncode == 0

def container(name):
    p = run(['docker','inspect','-f','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',name])
    state = p.stdout.strip() if p.returncode == 0 else 'missing'
    checks[f'container:{name}'] = state
    if state not in ('healthy','running'): errors.append(f'{name}:{state}')

for name in ('app-web-1','app-directus-1','app-postgres-1','business-kpi-web-1','business-kpi-postgres-1','miska-purchasing','arthur-core-api-1','arthur-core-postgres-1'):
    container(name)

services_network = os.environ.get('ARTHUR_SERVICES_NETWORK', 'arthur_services')
p = run(['docker','network','inspect',services_network])
if p.returncode != 0:
    checks['arthur_services_network'] = 'missing'
    errors.append(f'arthur_services_network:{services_network}:missing')
else:
    try:
        network = json.loads(p.stdout)[0]
        internal = network.get('Internal') is True
        driver = network.get('Driver')
        members = sorted(
            entry.get('Name')
            for entry in (network.get('Containers') or {}).values()
            if entry.get('Name')
        )
        checks['arthur_services_network'] = services_network
        checks['arthur_services_internal'] = internal
        checks['arthur_services_driver'] = driver
        checks['arthur_services_members'] = members

        if not internal:
            errors.append(f'arthur_services_network:{services_network}:not_internal')
        if driver != 'bridge':
            errors.append(f'arthur_services_network:{services_network}:driver:{driver}')
        if 'business-kpi-web-1' not in members:
            errors.append('arthur_services_network:business-kpi-web-1:missing')

        forbidden_members = sorted(set(members) & {
            'app-postgres-1',
            'business-kpi-postgres-1',
            'arthur-core-postgres-1',
            'arthur-core-api-1',
        })
        checks['arthur_services_forbidden_members'] = forbidden_members
        if forbidden_members:
            errors.append('arthur_services_network:forbidden_members:' + ','.join(forbidden_members))

        web = run(['docker','inspect','business-kpi-web-1'])
        aliases = []
        if web.returncode == 0:
            web_payload = json.loads(web.stdout)[0]
            aliases = (
                web_payload.get('NetworkSettings', {})
                .get('Networks', {})
                .get(services_network, {})
                .get('Aliases')
            ) or []
        aliases = sorted(set(aliases))
        checks['arthur_services_kpi_aliases'] = aliases
        if 'business-kpi-api' not in aliases:
            errors.append('arthur_services_network:business-kpi-api_alias:missing')
    except Exception:
        checks['arthur_services_network'] = 'invalid'
        errors.append(f'arthur_services_network:{services_network}:invalid')

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
purchasing_code = http_code('http://127.0.0.1:3210/')
checks['purchasing_http'] = purchasing_code
if purchasing_code != '200':
    errors.append(f'purchasing_http:{purchasing_code}')

portal_errors = []
portal_events = []

# Local Business KPI health with one safe self-heal attempt.
local_code = http_code('http://127.0.0.1:3220/health')
if local_code != '200':
    time.sleep(2)
    local_code = http_code('http://127.0.0.1:3220/health')
if local_code != '200' and checks.get('container:business-kpi-postgres-1') == 'healthy':
    restart = run(['docker', 'restart', 'business-kpi-web-1'])
    checks['business_kpi_http_recovery'] = 'restart_attempted' if restart.returncode == 0 else 'restart_failed'
    if restart.returncode == 0:
        time.sleep(5)
        local_code = http_code('http://127.0.0.1:3220/health')
        state = run(['docker','inspect','-f','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}','business-kpi-web-1'])
        if state.returncode == 0:
            checks['container:business-kpi-web-1'] = state.stdout.strip()
        if local_code == '200':
            errors[:] = [item for item in errors if not item.startswith('business-kpi-web-1:')]
            portal_events.append('local_http_auto_recovered')
checks['business_kpi_http'] = local_code
if local_code != '200':
    item = f'business_kpi_http:{local_code}'
    errors.append(item)
    portal_errors.append(item)

# Verify the actual Tailscale Serve HTTPS endpoint, not only loopback.
tailnet_url = 'https://miska-purchasing.tailc31347.ts.net/health'
tailnet_code = http_code(tailnet_url, insecure=True)
if tailnet_code != '200':
    run(['tailscale', 'debug', 'rebind'])
    run(['tailscale', 'debug', 'restun'])
    time.sleep(2)
    tailnet_code = http_code(tailnet_url, insecure=True)
    if tailnet_code == '200':
        portal_events.append('tailnet_https_auto_recovered')
checks['business_kpi_tailnet_http'] = tailnet_code
if tailnet_code != '200':
    item = f'business_kpi_tailnet_http:{tailnet_code}'
    errors.append(item)
    portal_errors.append(item)

# If a store PC is online in Tailscale, require two-way reachability.
store_peers = (
    {'code': 'miska', 'name': 'Миска', 'host': 'DESKTOP-TVPRA5M', 'ip': '100.103.126.29'},
    {'code': 'amper', 'name': 'Ампер', 'host': 'DESKTOP-MOTQEMV', 'ip': '100.64.91.53'},
    {'code': 'ventil', 'name': 'Вентиль', 'host': 'Kassa1', 'ip': '100.96.109.84'},
)
tail_peers = {}
status_json = run(['tailscale', 'status', '--json'])
if status_json.returncode == 0:
    try:
        tail_status = json.loads(status_json.stdout)
        tail_peers = tail_status.get('Peer') or {}
    except Exception:
        checks['business_kpi_store_peer_status'] = 'invalid_json'

for store in store_peers:
    prefix = f"business_kpi_{store['code']}_store_peer"
    peer = next(
        (
            candidate for candidate in tail_peers.values()
            if store['ip'] in (candidate.get('TailscaleIPs') or [])
            or candidate.get('HostName') == store['host']
        ),
        None,
    )
    peer_found = peer is not None
    peer_online = bool(peer and peer.get('Online') is True)
    checks[f'{prefix}_found'] = peer_found
    checks[f'{prefix}_online'] = peer_online
    checks[f'{prefix}_host'] = store['host']
    checks[f'{prefix}_ip'] = store['ip']
    if peer:
        checks[f'{prefix}_relay'] = peer.get('Relay') or ''

    if not peer_online:
        checks[f'{prefix}_ping'] = 'skipped_offline'
        continue

    ping = run(['tailscale', 'ping', '-c', '2', '--timeout', '3s', store['ip']])
    ping_ok = ping.returncode == 0 and 'pong from' in ping.stdout
    if not ping_ok:
        run(['tailscale', 'debug', 'rebind'])
        run(['tailscale', 'debug', 'restun'])
        time.sleep(2)
        ping = run(['tailscale', 'ping', '-c', '2', '--timeout', '3s', store['ip']])
        ping_ok = ping.returncode == 0 and 'pong from' in ping.stdout
        if ping_ok:
            portal_events.append(f"{store['code']}_store_peer_auto_recovered")
    checks[f'{prefix}_ping'] = 'ok' if ping_ok else 'failed'
    ping_lines = [line.strip() for line in ping.stdout.splitlines() if 'pong from' in line]
    if ping_lines:
        checks[f'{prefix}_path'] = ping_lines[-1][:240]
    if not ping_ok:
        item = f"{prefix}:unreachable"
        errors.append(item)
        portal_errors.append(item)

p = run(['systemctl','is-active','kimi-worker.timer'])
kimi_timer = p.stdout.strip()
checks['kimi_worker_timer'] = kimi_timer
if kimi_timer != 'active': warnings.append(f'kimi_worker_timer:{kimi_timer}')

for event in portal_events:
    warnings.append(f'business_kpi:{event}')

# Notify the owner only on a portal state transition or a new failure signature.
portal_state_path = OUT / 'business-kpi-watch-state.json'
try:
    previous_portal_state = json.loads(portal_state_path.read_text()) if portal_state_path.exists() else {}
except Exception:
    previous_portal_state = {}

portal_severity = 'error' if portal_errors else ('warning' if portal_events else 'ok')
portal_signature = json.dumps(
    {'errors': sorted(portal_errors), 'events': sorted(portal_events)},
    ensure_ascii=False,
    sort_keys=True,
)
previous_severity = previous_portal_state.get('severity')
previous_signature = previous_portal_state.get('signature')
previous_notified = previous_portal_state.get('notified') is True

notification = None
if portal_severity == 'error':
    if previous_severity != 'error' or previous_signature != portal_signature or not previous_notified:
        notification = (
            '🚨 Business Portal: обнаружен сбой.\n'
            + '\n'.join(f'• {item}' for item in portal_errors)
            + '\nАвтовосстановление выполнено, но проверка всё ещё не проходит.'
        )
elif portal_severity == 'warning':
    if previous_severity != 'warning' or previous_signature != portal_signature or not previous_notified:
        notification = (
            '⚠️ Business Portal: сбой обнаружен и автоматически восстановлен.\n'
            + '\n'.join(f'• {item}' for item in portal_events)
        )
elif previous_severity == 'error':
    notification = '✅ Business Portal снова доступен. Проверка приложения и Tailscale проходит успешно.'

notify_ok = previous_notified if notification is None and previous_severity == portal_severity and previous_signature == portal_signature else False
if notification is not None:
    notify_ok = notify_owner(notification)
    checks['business_kpi_owner_notify'] = 'sent' if notify_ok else 'failed'
    if not notify_ok:
        warnings.append('business_kpi:owner_notify_failed')

portal_state_tmp = portal_state_path.with_suffix('.json.tmp')
portal_state_tmp.write_text(json.dumps({
    'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'severity': portal_severity,
    'signature': portal_signature,
    'notified': notify_ok,
}, ensure_ascii=False, indent=2) + '\n')
os.chmod(portal_state_tmp, 0o600)
portal_state_tmp.replace(portal_state_path)

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
