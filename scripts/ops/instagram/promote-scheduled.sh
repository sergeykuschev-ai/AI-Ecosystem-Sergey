#!/bin/bash
set -euo pipefail
profile=${1:?profile required}
case "$profile" in miska|default) ;; *) exit 2;; esac

B=/opt/instagram-automation/$profile
S="$B/scheduled"
I="$B/inbox"
mkdir -p "$S" "$I" "$B/logs"
shopt -s nullglob
now=$(date -u +%s)

for cap in "$S"/*.caption.txt; do
  base=${cap%.caption.txt}
  file=${base##*/}
  stamp=${file%%__*}
  name=${file#*__}

  if [[ ! "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || [ "$name" = "$file" ]; then
    continue
  fi

  due=$(date -u -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null || echo 0)
  [ "$due" -le "$now" ] || continue

  media=""
  ext=""
  for e in jpg jpeg png mp4 mov m4v; do
    if [ -f "$S/$file.$e" ]; then
      media="$S/$file.$e"
      ext="$e"
      break
    fi
  done

  [ -n "$media" ] || continue
  [ ! -e "$I/$name.caption.txt" ] || continue

  mv "$media" "$I/$name.$ext"
  mv "$cap" "$I/$name.caption.txt"
  echo "$(date -Is) RELEASED $profile $name" >>"$B/logs/schedule.log"
done
