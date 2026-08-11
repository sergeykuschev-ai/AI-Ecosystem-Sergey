# Project Status Snapshot — 2026-08-11

AI-Ecosystem-Sergey / Arthur

---

## 1. Общая архитектура

Рабочая цепочка:

```
Telegram
→ Arthur Telegram Gateway
→ Arthur Orchestrator
→ intent / skill routing
```

Если запрос требует специализированного skill:

```
→ registered skill
→ сейчас production skill: purchasing
```

Если запрос обычный conversational:

```
→ OmniRouteProvider
→ OmniRoute
→ combo arthur-fast
```

`arthur-fast`:

1. OpenAI Codex — GPT 5.6 Terra High
2. Kimi Code CLI — Kimi K3

Strategy: **Priority**.

Codex primary → при ошибке/недоступности → Kimi K3 fallback.

Failover реально проверен вручную в OmniRoute:

- при включённом Codex: `Resolved by: codex/gpt-5.6-terra-high`
- при временно отключённом Codex: Codex = ERROR, Kimi K3 = OK, `Resolved by: kimi-coding/k3`

Это считать подтверждённым production behavior OmniRoute.

---

## 2. Arthur

Arthur — единый AI-ассистент Сергея.

Уже реализовано:

- Telegram Gateway
- Arthur Core API
- Orchestrator
- AI Provider abstraction
- OmniRoute Provider
- conversational fallback
- deterministic routing
- LLM planner
- Purchasing skill
- Arthur Identity
- dynamic Capability Context
- structured logging
- PostgreSQL foundation

Arthur умеет:

- разговаривать естественным языком;
- определять необходимость skill;
- обращаться к специализированному purchasing;
- использовать общий интеллект через OmniRoute;
- знать свою роль;
- знать только реально registered capabilities;
- не заявлять о прямом доступе к БД, если его нет.

---

## 3. Arthur Identity

Артур — не просто Telegram bot.

Артур — персональный AI-ассистент Сергея и центральный управляющий AI-слой всей экосистемы.

Должен постепенно объединять:

**Личное:**

- задачи;
- календарь;
- напоминания;
- документы;
- поездки;
- английский;
- личные проекты;
- заметки;
- долгосрочную память;
- решения и предпочтения владельца.

**Бизнес:**

- Миска;
- Ампер;
- Вентиль;
- Метиз Маркет;
- закупки;
- ассортимент;
- цены;
- KPI;
- сотрудники;
- аналитика;
- документы;
- 1С;
- сайт;
- SEO;
- Local SEO;
- GEO / AI Search;
- маркетинг;
- CRM;
- финансы.

Главный архитектурный принцип:

> НЕ создавать множество независимых помощников.
> Должен существовать один Arthur, который использует специализированные skills/modules.

---

## 4. AI Routing

Arthur не должен напрямую зависеть от конкретной AI-модели.

```
Arthur
→ OmniRoute
→ combo/model routing
```

Production combo: `arthur-fast`.

Последняя runtime конфигурация:

```
ARTHUR_AI_PROVIDER=omniroute
OMNIROUTE_BASE_URL=http://omniroute:20128/v1
OMNIROUTE_MODEL=arthur-fast
OMNIROUTE_FAST_MODEL=arthur-fast
OMNIROUTE_REASONING_MODEL=arthur-fast
OMNIROUTE_CODE_MODEL=arthur-fast
```

API keys не фиксируются в документации.

---

## 5. OmniRoute

Production OmniRoute работает на Windows Docker server.

- Image: `diegosouzapw/omniroute:latest`
- Container: `omniroute`
- Port: `127.0.0.1:20128` → container `20128`
- Persistent volume: `omniroute-data` → `/app/data`
- Restart policy: `unless-stopped`
- Docker networks: `bridge` и `arthur-core_arthur_internal`

Arthur внутри Docker обращается: `http://omniroute:20128/v1`.

---

## 6. OmniRoute Providers

Подключены:

- OpenAI Codex
- Kimi Code CLI

Рабочая Kimi model: `kmc/k3` (Kimi K3).

Рабочая Codex model в `arthur-fast`: GPT 5.6 Terra High.

Credentials принадлежат OmniRoute. Arthur не должен знать credentials providers. Arthur использует отдельный OmniRoute inference API key.

Реальные секреты не фиксируются.

---

## 7. Windows Production Server

Repo: `C:\AI-Ecosystem\AI-Ecosystem-Sergey`

Docker production services:

- `arthur-core-api-1`
- `arthur-core-postgres-1`
- `arthur-core-telegram-gateway-1`
- `omniroute`

Также на сервере существуют:

- `purchasing-web-backend`
- `minmax-direct-mail-intake`
- `n8n`
- `open-webui`

Зафиксированы только реально подтверждённые сервисы.

---

## 8. Telegram

Telegram bot работает.

- Gateway: `arthur-core-telegram-gateway-1`
- Health port: `8788`
- Published: `127.0.0.1:8788`
- Telegram outbound использует proxy
- Telegram allow-list используется

Telegram Bot Token не фиксируется.

---

## 9. Сеть / туннели / proxy

На Windows работает локальный proxy/tunnel: `127.0.0.1:8443`.

Проверено:

- `TcpTestSucceeded = True`
- `127.0.0.1:8443 LISTENING`

Arthur `.env` использует:

```
HTTP_PROXY=http://host.docker.internal:8443
HTTPS_PROXY=http://host.docker.internal:8443
```

### Production incident / recovery note

OmniRoute изначально ошибочно был запущен на `host.docker.internal:8555`. Порт 8555 не слушался. Это приводило к `ECONNREFUSED 192.168.65.254:8555` и 502 для Codex и Kimi.

OmniRoute был безопасно пересоздан с сохранением:

- `omniroute-data`
- Codex auth
- Kimi auth
- `arthur-fast`

Proxy исправлен на `host.docker.internal:8443`. После этого AI-ответы Arthur восстановились.

---

## 10. Зарубежный server / tunnel

Существует зарубежный Ubuntu server, через который ранее уже строилась proxy-связность.

Известно:

- Ubuntu 24.04
- tinyproxy
- SSH
- использовался для доступа Telegram / внешних AI services

IP, credentials и SSH secrets не фиксируются.

Архитектурно:

```
Windows host
→ local proxy/tunnel :8443
→ foreign server / tinyproxy
→ external services
```

---

## 11. Mac Development

Основная development workstation: MacBook.

Repo: `~/Documents/GitHub/AI-Ecosystem-Sergey`

На Mac используются:

- Git
- GitHub
- Kimi CLI
- Codex CLI
- OmniRoute CLI
- development/test workflow

Production deploy:

```
Mac: commit / push
Windows: git pull + docker compose build/recreate
```

---

## 12. Purchasing

Arthur имеет registered skill: `purchasing`.

Operations:

- `getStatus`
- `getSummary`
- `getOwnerReview`
- `getFinalOrder`

### Production data status

Windows host directory:

```
C:\AI-Ecosystem\AI-Ecosystem-Sergey\output\purchasing-web\runs
```

пустая.

Docker mount:

- host: `output\purchasing-web\runs`
- container: `/opt/arthur/output/purchasing-web/runs`

`PURCHASING_RUNS_ROOT`: `/opt/arthur/output/purchasing-web/runs`

Mount и env проверены и корректны.

Arthur Purchasing показывает «нет завершённой закупки», потому что completed production run реально отсутствует. Это НЕ ошибка Arthur.

---

## 13. Purchasing Canonical Pipeline

Фактическая цепочка, обнаруженная последним аудитом:

```
input Excel / SmartZapas
→ validation / parsing
→ Min/Max
→ Assortment Policy
→ owner decisions
→ buildOwnerReviewModel()
→ buildOwnerReviewReport()
→ buildOwnerLearningReport()
→ buildRecommendationExplanations()
→ assertRunConsistency()
→ recordRuleEffectiveness()
→ registry.saveCompletedRun()
→ artifactStore.saveBundleArtifacts()
→ summary.json
→ items.json
→ owner-review-compact.json
→ run.json
```

Successful run:

```json
{
  "run_id": "<uuid>",
  "status": "completed",
  "stage": "complete",
  "completed_at": "...",
  "source": { "original_name": "..." },
  "warnings_count": 0
}
```

Arthur должен использовать только такой completed run.

---

## 14. Current Purchasing Blocker

Новый production run сейчас запускать **НЕЛЬЗЯ**, пока нет подтверждённой актуальной корректной SmartZapas Min/Max Excel export.

Ранее был реальный run:

- 403 SKU
- ≈ 89 159.68 ₽ order
- APPROVED
- ≈ 36 942.84 ₽ additional reserve

Но после обновления 1С Min/Max export стал некорректным.

Старый run НЕ считать автоматически текущим.

Следующий purchasing step:

1. Получить свежую корректную SmartZapas export.
2. Выполнить новый production purchasing run.
3. Проверить Arthur status / summary / owner review.

---

## 15. Security

Никогда не хранить в Git:

- Telegram Bot Token
- OmniRoute API key
- Codex credentials
- Kimi credentials
- Postgres passwords
- SSH credentials

Arthur знает только OmniRoute inference key.

Provider credentials принадлежат OmniRoute.

---

## 16. Current Verified State

- [OK] Telegram Gateway
- [OK] Arthur Core
- [OK] Conversational AI
- [OK] Arthur Identity
- [OK] Capability Awareness
- [OK] Purchasing Skill routing
- [OK] OmniRoute
- [OK] Codex
- [OK] Kimi K3
- [OK] arthur-fast
- [OK] Codex → Kimi failover
- [OK] Docker networking
- [OK] proxy :8443
- [OK] Arthur → OmniRoute
- [OK] Telegram → Arthur → AI → Telegram
- [PENDING] fresh SmartZapas production input
- [PENDING] new completed purchasing run
- [PENDING] real purchasing data visible through Telegram

---

## 17. Known Important Commits

Подтверждённые commits Arthur:

- `4730783` feat(arthur): add v1 foundation orchestrator and skills
- `2a659d5` feat(arthur): add telegram gateway with docker autostart
- `8e45b1f` fix(arthur): make database migrations production-safe
- `12714d1` fix(arthur): allow telegram gateway outbound network access
- `66312dc` fix(arthur): add proxy support for telegram api
- `a2caf31` feat(arthur): add omniroute ai reasoning provider
- `d448c1f` feat(arthur): integrate OmniRoute AI gateway
- `4bcd0f5` fix(arthur): handle OmniRoute responses and safe fallback
- `9b71cae` fix(arthur): force non-streaming OmniRoute responses
- `88adb94` feat(arthur): add identity and capability awareness
- `4652cb8` fix(arthur): read canonical purchasing runs
- `2c122ae` fix(arthur): enable conversational AI fallback

---

## CURRENT PRIORITIES

1. Получить корректную SmartZapas Min/Max Export.
2. Создать production Purchasing Run.
3. Проверить Purchasing через Arthur Telegram.
4. Ценообразование.
5. Arthur Personal Assistant.
6. Website.
7. SEO / GEO / AI Search.
8. CRM / Analytics.

---

## NEXT SESSION START HERE

1. Не трогать OmniRoute/proxy/Telegram — текущая инфраструктура работает.
2. Не создавать новый purchasing engine.
3. Следующая задача: получить корректный актуальный SmartZapas Min/Max export.
4. После этого: создать новый production purchasing run.
5. Проверить через Telegram: status, summary, owner review.
6. После завершения Purchasing: продолжить развитие Arthur Personal Assistant.
