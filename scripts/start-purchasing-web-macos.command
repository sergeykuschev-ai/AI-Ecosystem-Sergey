#!/usr/bin/env bash
set -u

REMOTE_URL="https://miska-purchasing.tailc31347.ts.net:8443"
printf 'AI-закупщик: серверная production-версия\n'
printf 'Адрес: %s\n' "$REMOTE_URL"
printf 'Локальный сервер на Mac больше не запускается.\n'
printf 'Для доступа должен быть включён Tailscale.\n\n'

if ! command -v curl >/dev/null 2>&1 || ! command -v open >/dev/null 2>&1; then
  printf 'Ошибка: на macOS не найдены curl/open.\n' >&2
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 5 "$REMOTE_URL/" | grep -q 'id="run-form"'; then
  printf 'Ошибка: production-закупщик недоступен. Проверьте, что Tailscale включён.\n' >&2
  exit 1
fi

printf 'Production-закупщик доступен. Открываю интерфейс.\n'
exec open "$REMOTE_URL"
