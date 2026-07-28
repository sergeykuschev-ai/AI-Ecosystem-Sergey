#!/usr/bin/env bash

set -u

PORT=3210
INTERFACE_URL="http://127.0.0.1:${PORT}"
SCRIPT_DIRECTORY="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd
)"
REPOSITORY_ROOT="$(
  cd -- "${SCRIPT_DIRECTORY}/.." >/dev/null 2>&1 && pwd
)"
SERVER_PID=""

print_error() {
  printf '\nОшибка: %s\n' "$1" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    print_error "не найдена команда $1. Установите Node.js и повторите запуск."
    return 1
  fi
}

is_purchasing_web_ready() {
  curl \
    --fail \
    --silent \
    --show-error \
    --max-time 1 \
    "${INTERFACE_URL}/" 2>/dev/null |
    grep -q 'id="run-form"'
}

is_port_in_use() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

open_interface() {
  printf 'Открываю интерфейс: %s\n' "${INTERFACE_URL}"
  if ! open "${INTERFACE_URL}"; then
    print_error "не удалось открыть браузер. Откройте адрес вручную: ${INTERFACE_URL}"
    return 1
  fi
}

stop_started_server() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    printf '\nОстанавливаю локальный сервер AI-закупщика...\n'
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

if [[ -z "${SCRIPT_DIRECTORY}" || -z "${REPOSITORY_ROOT}" ]]; then
  print_error "не удалось определить корень репозитория."
  exit 1
fi

if [[ ! -f "${REPOSITORY_ROOT}/package.json" ]]; then
  print_error "рядом со скриптом не найден package.json репозитория."
  exit 1
fi

if ! require_command node || ! require_command npm; then
  printf 'Скачать Node.js можно на https://nodejs.org/\n' >&2
  exit 1
fi

for command_name in curl grep lsof open; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    print_error "не найдена системная команда ${command_name}."
    exit 1
  fi
done

if ! cd -- "${REPOSITORY_ROOT}"; then
  print_error "не удалось перейти в корень репозитория."
  exit 1
fi

printf 'AI-закупщик: локальный запуск для macOS\n'
printf 'Репозиторий: %s\n' "${REPOSITORY_ROOT}"

if is_purchasing_web_ready; then
  printf 'Сервер AI-закупщика уже работает на порту %s.\n' "${PORT}"
  open_interface
  exit $?
fi

if is_port_in_use; then
  print_error "порт ${PORT} занят другим приложением. Освободите порт и повторите запуск."
  exit 1
fi

printf 'Запускаю локальный сервер AI-закупщика...\n'
printf 'Для остановки сервера нажмите Control+C в этом окне.\n\n'

trap stop_started_server INT TERM EXIT
npm run purchasing:web &
SERVER_PID=$!

for ((attempt = 1; attempt <= 60; attempt += 1)); do
  if is_purchasing_web_ready; then
    printf '\nСервер готов.\n'
    open_interface
    wait "${SERVER_PID}"
    exit $?
  fi

  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    wait "${SERVER_PID}"
    server_status=$?
    print_error "сервер завершился до запуска интерфейса (код ${server_status})."
    exit "${server_status}"
  fi

  sleep 0.25
done

print_error "сервер не стал доступен за 15 секунд."
exit 1
