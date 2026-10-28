#!/usr/bin/env python3
import json, ssl, socket, subprocess, urllib.request, time
from pathlib import Path
from datetime import datetime, timezone, timedelta
STATE=Path('/opt/stores-web/state/public-health')
STATE.mkdir(parents=True,exist_ok=True)
expected='138.16.155.126'
ns=['ns1.adminvps.ru','ns2.adminvps.net','ns3.adminvps.ru','ns4.adminvps.net']
dns={}
for server in ns:
    attempts=[]
    for _ in range(2):
        try:
            p=subprocess.run(['dig','+time=2','+tries=1','+short','@'+server,'amurskmarket.ru','A'],capture_output=True,text=True,timeout=4)
            values=[x.strip() for x in p.stdout.splitlines() if x.strip() and not x.startswith(';;')]
            attempts.append({'ok':p.returncode==0 and expected in values,'answers':values})
        except Exception as e:
            attempts.append({'ok':False,'error':type(e).__name__})
        time.sleep(0.25)
    successes=sum(1 for x in attempts if x.get('ok'))
    dns[server]={'ok':successes>=1,'successes':successes,'attempts':len(attempts),'results':attempts}
# Compare SOA returned by every authoritative server. A disagreement can make crawlers
# treat DNS as unstable even when A records resolve correctly.
soa={}
for server in ns:
    try:
        p=subprocess.run(['dig','+time=2','+tries=1','+short','@'+server,'amurskmarket.ru','SOA'],capture_output=True,text=True,timeout=4)
        soa[server]=' '.join(x.strip() for x in p.stdout.splitlines() if x.strip())
    except Exception as e:
        soa[server]='ERROR:'+type(e).__name__
soa_values=set(soa.values())
soa_consistent=len(soa_values)==1 and not next(iter(soa_values),'').startswith('ERROR:')
http={}
def check_http(label,path,user_agent):
    start=time.monotonic()
    try:
        req=urllib.request.Request('https://amurskmarket.ru'+path,headers={'User-Agent':user_agent})
        with urllib.request.urlopen(req,timeout=10) as r:
            r.read(1)
            http[label]={'ok':r.status==200,'status':r.status,'ms':round((time.monotonic()-start)*1000)}
    except Exception as e:
        http[label]={'ok':False,'error':type(e).__name__,'ms':round((time.monotonic()-start)*1000)}
for path in ['/','/robots.txt','/sitemap.xml','/api/health']:
    check_http(path,path,'amurskmarket-health/1.1')
check_http('yandexbot:/','/','Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)')
check_http('yandexbot:/stores/amursk/','/stores/amursk/','Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)')
tls={'ok':False}
try:
    ctx=ssl.create_default_context()
    with socket.create_connection(('amurskmarket.ru',443),timeout=10) as sock:
        with ctx.wrap_socket(sock,server_hostname='amurskmarket.ru') as ssock:
            cert=ssock.getpeercert()
    expires=datetime.strptime(cert['notAfter'],'%b %d %H:%M:%S %Y %Z').replace(tzinfo=timezone.utc)
    days=(expires-datetime.now(timezone.utc)).total_seconds()/86400
    tls={'ok':days>14,'expires_utc':expires.isoformat(),'days_remaining':round(days,1)}
except Exception as e:
    tls={'ok':False,'error':type(e).__name__}
now=datetime.now(timezone.utc)
dns_degraded=[name for name,x in dns.items() if x.get('successes',0)<x.get('attempts',0)]
out={'timestamp_utc':now.isoformat(),'dns':dns,'dns_degraded':dns_degraded,'soa':soa,'soa_consistent':soa_consistent,'http':http,'tls':tls,
     'all_dns_ok':all(x.get('ok') for x in dns.values()),
     'all_http_ok':all(x.get('ok') for x in http.values()),'tls_ok':tls.get('ok',False)}
stamp=now.strftime('%Y%m%dT%H%M%SZ')
payload=json.dumps(out,ensure_ascii=False,indent=2)+'\n'
(STATE/f'health-{stamp}.json').write_text(payload)
(STATE/'latest.json').write_text(payload)
cutoff=now-timedelta(days=30)
for p in STATE.glob('health-*.json'):
    if datetime.fromtimestamp(p.stat().st_mtime,timezone.utc)<cutoff: p.unlink()
print(payload,end='')
if not out['all_dns_ok'] or not out['all_http_ok'] or not out['tls_ok']:
    raise SystemExit(1)
