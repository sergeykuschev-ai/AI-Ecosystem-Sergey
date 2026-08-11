# Arthur Master Architecture

AI-Ecosystem-Sergey

---

## 1. Mission

Arthur = единый личный и бизнес AI-assistant Сергея.

Он объединяет управление личными делами и бизнес-операциями через один identity, один memory layer, один orchestrator и один AI gateway.

---

## 2. Core Principle

> One Arthur.
> Many skills.
> One identity.
> One memory architecture.
> One access-control layer.
> One AI gateway.

Не создавать множество независимых помощников для каждой задачи. Каждый новый модуль добавляется как skill существующего Arthur, если нет серьёзной архитектурной причины создавать отдельный service.

---

## 3. Layers

### Channels

- Telegram (production)
- future Web UI
- future mobile / native UI
- future voice

↓

### Arthur Core

- Identity
- Memory
- Planner
- Orchestrator
- Permissions
- Audit
- Observability

↓

### Skills

- Purchasing
- Assortment
- Pricing
- KPI
- Analytics
- Tasks
- Calendar
- Documents
- Stores
- Employees
- 1C
- Website
- SEO / GEO
- etc.

↓

### AI Gateway

- OmniRoute

↓

### Models

- OpenAI Codex
- Kimi
- future local model
- future independent server intelligence

---

## 4. Personal Assistant Roadmap

### Phase 1

- conversation
- identity
- memory
- tasks
- reminders
- calendar

### Phase 2

- documents
- email
- travel
- personal projects
- English
- knowledge base

### Phase 3

- proactive planning
- daily briefing
- follow-ups
- decision history
- cross-project context

---

## 5. Business Roadmap

1. Purchasing
2. Assortment Manager
3. Pricing
4. KPI
5. Store Analytics
6. Employees
7. 1C Assistant
8. Website / SEO / GEO
9. SMM / Marketing
10. Finance

---

## 6. Memory Architecture

Разделить:

- short-term conversation state
- long-term owner memory
- business rules
- decision history
- project state
- operational facts
- sensitive / private data

Arthur не должен слепо передавать всю память модели.

Memory retrieval должен быть scoped и contextual.

---

## 7. Safety Architecture

- LLM не получает прямые credentials.
- LLM не получает unrestricted DB access.
- Skills являются controlled boundary.
- Business-changing actions требуют permissions / confirmation там, где это необходимо.

---

## 8. Independence

Долгосрочная цель: Arthur не должен зависеть от одной AI-company.

OmniRoute остаётся abstraction layer.

Поддерживать:

- primary cloud AI
- secondary cloud AI
- local / private model
- future own server reasoning model

---

## 9. Infrastructure

- **Mac** = development
- **Windows server** = production application layer
- **foreign Ubuntu server** = secure external connectivity / proxy layer
- **GitHub** = source control / deploy transport

---

## 10. Canonical Rule

> Новый модуль добавляется как skill существующего Arthur, если нет серьёзной архитектурной причины создавать отдельный service.

Не создавать отдельного "нового Артура".
