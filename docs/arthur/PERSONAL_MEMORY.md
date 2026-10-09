# Explicit personal memory

## Repository status

Arthur can store explicit personal notes in the existing versioned Core memory
table. This implementation has not been enabled or deployed on the production
host. It does not import historical conversations or automatically add inferred
facts to memory. Ordinary personal questions can retrieve matching explicit notes
using the conservative lexical lookup described below.

## Owner commands

| Command | Result |
|---|---|
| `Запомни: английский по вторникам` | Persist an explicit note |
| `Что ты обо мне помнишь?` | List active explicit notes |
| `Что ты помнишь про английский?` | Search active notes |
| `Исправь память: английский по вторникам → английский по четвергам` | Archive the selected version and create its replacement |
| `Забудь: английский по четвергам` | Remove the selected note from active retrieval |

Notes accept up to 2000 characters. Matching ignores case, whitespace variation
and the difference between `ё` and `е`. Exact matches take priority over substring
matches. Multiple matches require clarification and cause no mutation. The
existing `Запомни, что жду ...` waiting-task command retains its original meaning.

Forgetting archives a note; it is **not physical erasure**. Previous versions and
audit snapshots remain in the database. Confidence 1 represents the user's
explicit instruction, not independent verification of the note's contents.

## Persistence and boundaries

Active notes use `personal.note:` keys, personal domain, and sensitive classification.
Each record has an owner, source, timestamps and an audit event. Telegram always
uses the configured canonical profile, not an owner supplied by the message.
Owner filtering occurs in SQL. The internal API uses the existing shared token
and is intended for trusted services, not direct access by arbitrary end users.

Mutations lock the active owner profile and commit the note, audit and command
receipt together. A Telegram update ID becomes the source reference. Receipts
prevent a repeated update from resurrecting a subsequently edited or forgotten
note. Receipt records contain operation/status rather than note text and are
excluded from the personal-memory endpoint. A database failure rolls back all
changes. A failed or timed-out call never produces a success confirmation.

Read replies show explicitly saved records with their save dates. Responses are
escaped and bounded for Telegram. Writes use deterministic commands; LLM planning
cannot invoke write capabilities. With the feature disabled, explicit memory
commands report that no change was performed rather than falling back to chat.

## Activation

1. Deploy the updated Core API before the Gateway. No additional memory migration
   is required; the existing profile, memory and audit tables are used.
2. Configure the existing Core URL/token and canonical owner profile. Verify that
   exactly one Telegram user ID is allowed.
3. Set `ARTHUR_PERSONAL_MEMORY_ENABLED=true` and rebuild/restart the Gateway.
4. Save a harmless test note, restart the services, read it, edit it and forget it.
   Check the active version and audit. Repeat the original update to verify replay
   protection. Turning the flag off disables commands but preserves stored data.

The switch defaults to false and is independent of personal notification flags.

## Acceptance

```sh
npm run test:arthur
node scripts/arthur/check-personal-memory.js
```

The SQL check requires a test/CI database through `ARTHUR_DATABASE_URL`. It creates
a disposable schema, applies existing migrations, checks restart persistence,
versioning, ambiguous selections, owner isolation, replay protection, transactional
rollback and authenticated HTTP calls, then removes the schema. CI runs it on
PostgreSQL 16.

## Ordinary personal questions

Questions such as `Когда у меня английский?` or
`Какая у меня цель по английскому?` use the read-only `recall` capability.
Existing task, waiting, mail and business commands retain their routing.
The parser requires a question word and an explicit first-person possessive
reference. General advice and questions about other people do not trigger recall.

`GET /v1/personal-memory?ownerId=...&query=...&mode=related` filters only active
personal notes for that owner, before the existing 50-record response limit.
The default `substring` mode preserves explicit list/edit/forget behavior.
Related lookup removes common question words and normalizes case, `ё`, and a
limited set of Russian endings. Every remaining word must occur in the note.
There are no embeddings or synonym expansion; paraphrases may have no match.
A query without meaningful words returns no records, never the entire memory.
An unsupported mode returns a validation error. Latest records appear first.

The reply quotes at most five matches with the record ID, save date in
Asia/Vladivostok and original command reference when present. The same source
fields appear in answer source metadata. Notes are escaped, bounded and returned
without model inference, so embedded instructions are treated as quoted data.
Previously stored statements are explicitly distinguished from currently verified
facts. No match, a disabled feature or an unavailable database yields a clear
unconfirmed result rather than a conversational guess. Recall does not write,
change or automatically retain any new fact.

Deploy the updated Core API before the updated Gateway. The existing
`ARTHUR_PERSONAL_MEMORY_ENABLED` flag controls both explicit commands and recall;
there is no additional flag or migration. Semantic retrieval, cross-turn topic
resolution, automatic model-context injection and calendar verification remain
future work.
