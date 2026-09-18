#!/bin/sh
set -eu

BASE=/var/backups/sergey-architecture
STATE="$BASE/offhost-last.json"
STAGING="$BASE/offhost-staging"
RECIPIENTS=/root/.ssh/authorized_keys
REMOTE_HOST=89.125.19.70
REMOTE_PORT=2222
REMOTE_USER=root
REMOTE_KEY=/root/.ssh/instagram_germany
REMOTE_DIR=/srv/sergey-backups/incoming
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

command -v age >/dev/null
command -v scp >/dev/null
command -v ssh >/dev/null
[ -s "$RECIPIENTS" ]
[ -s "$BASE/last.json" ]

mkdir -p "$STAGING"
chmod 700 "$STAGING"
WORK=$(mktemp -d "$STAGING/run.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

eval "$(python3 - "$BASE/last.json" <<'PY'
import json, shlex, sys
data=json.load(open(sys.argv[1]))
for env,key in [('STORES','stores_web'),('KPI','business_kpi'),('UPLOADS','uploads')]:
    value=data.get(key)
    if not isinstance(value,str) or not value:
        raise SystemExit(f'missing {key} in last.json')
    print(f"{env}={shlex.quote(value)}")
PY
)"

PURCHASING=$(find /opt/miska-purchasing/backups -maxdepth 1 -type f -name 'miska-purchasing-*.tar.gz' -printf '%T@ %p\n' \
  | sort -nr | head -1 | cut -d' ' -f2-)

for file in "$STORES" "$KPI" "$UPLOADS" "$PURCHASING"; do
  [ -n "$file" ] && [ -s "$file" ] || { echo "missing backup input: $file" >&2; exit 1; }
done

cp "$STORES" "$WORK/stores-web.dump"
cp "$KPI" "$WORK/business-kpi.dump"
cp "$UPLOADS" "$WORK/directus-uploads.tar.gz"
cp "$PURCHASING" "$WORK/miska-purchasing.tar.gz"

python3 - "$WORK" "$STAMP" "$STORES" "$KPI" "$UPLOADS" "$PURCHASING" <<'PY'
import hashlib, json, os, sys
work, stamp, *sources = sys.argv[1:]
names=['stores-web.dump','business-kpi.dump','directus-uploads.tar.gz','miska-purchasing.tar.gz']
items=[]
for name,src in zip(names,sources):
    path=os.path.join(work,name)
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    items.append({'name':name,'source':src,'bytes':os.path.getsize(path),'sha256':h.hexdigest()})
manifest={'created_at':stamp,'format':'sergey-offhost-v1','items':items}
with open(os.path.join(work,'manifest.json'),'w') as f:
    json.dump(manifest,f,ensure_ascii=False,indent=2)
    f.write('\n')
PY

ARCHIVE="$STAGING/sergey-offhost-$STAMP.tar.gz"
ENCRYPTED="$ARCHIVE.age"
tar -C "$WORK" -czf "$ARCHIVE" manifest.json stores-web.dump business-kpi.dump directus-uploads.tar.gz miska-purchasing.tar.gz
age -R "$RECIPIENTS" -o "$ENCRYPTED.tmp" "$ARCHIVE"
head -1 "$ENCRYPTED.tmp" | grep -qx 'age-encryption.org/v1'
mv "$ENCRYPTED.tmp" "$ENCRYPTED"
chmod 600 "$ENCRYPTED"
rm -f "$ARCHIVE"

SIZE=$(stat -c %s "$ENCRYPTED")
REMOTE_FREE_KB=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$REMOTE_PORT" -i "$REMOTE_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "df -Pk '$REMOTE_DIR' | awk 'NR==2 {print \$4}'")
NEEDED_KB=$(( (SIZE + 1023) / 1024 + 512000 ))
[ "$REMOTE_FREE_KB" -gt "$NEEDED_KB" ] || { echo "off-host target low on disk" >&2; exit 1; }

REMOTE_NAME=$(basename "$ENCRYPTED")
scp -q -P "$REMOTE_PORT" -i "$REMOTE_KEY" -o BatchMode=yes "$ENCRYPTED" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/$REMOTE_NAME.tmp"

LOCAL_SHA=$(sha256sum "$ENCRYPTED" | awk '{print $1}')
REMOTE_SHA=$(ssh -o BatchMode=yes -p "$REMOTE_PORT" -i "$REMOTE_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "sha256sum '$REMOTE_DIR/$REMOTE_NAME.tmp' | awk '{print \$1}'")
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || { echo "off-host checksum mismatch" >&2; exit 1; }

ssh -o BatchMode=yes -p "$REMOTE_PORT" -i "$REMOTE_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "chmod 600 '$REMOTE_DIR/$REMOTE_NAME.tmp' &&
   mv '$REMOTE_DIR/$REMOTE_NAME.tmp' '$REMOTE_DIR/$REMOTE_NAME' &&
   rm -f '$REMOTE_DIR/offhost-smoke.age' &&
   find '$REMOTE_DIR' -maxdepth 1 -type f -name 'sergey-offhost-*.tar.gz.age' -mtime +7 -delete"

python3 - "$STATE.tmp" "$REMOTE_HOST" "$REMOTE_DIR/$REMOTE_NAME" "$SIZE" "$LOCAL_SHA" <<'PY'
import json, sys
out,host,path,size,sha=sys.argv[1:]
data={'checked_at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z'),
      'status':'ok','remote_host':host,'remote_path':path,'bytes':int(size),'sha256':sha}
with open(out,'w') as f:
    json.dump(data,f,indent=2); f.write('\n')
PY
mv "$STATE.tmp" "$STATE"
chmod 600 "$STATE"
rm -f "$ENCRYPTED"

printf 'off-host backup ok: %s bytes -> %s:%s\n' "$SIZE" "$REMOTE_HOST" "$REMOTE_DIR/$REMOTE_NAME"
