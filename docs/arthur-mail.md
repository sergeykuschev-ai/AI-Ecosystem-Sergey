# Arthur Mail: read-only search and Yandex IMAP setup

Arthur Mail provides a provider-neutral, read-only IMAP adapter for the
`miska-yandex` mailbox. The repository contains no credentials, and the mailbox
remains disabled by default in the checked-in configuration.

## Read-only boundary

The adapter connects with TLS, validates the server certificate, and opens
`INBOX` with `readOnly: true`, which makes ImapFlow use IMAP `EXAMINE` instead
of a writable `SELECT`. It performs whitelisted `SEARCH` queries and bounded
`BODY.PEEK` reads. Only a bounded `text/plain` part is downloaded; when
plain text is absent, a bounded `text/html` part may be converted to plain text
without executing HTML or scripts. Attachments are never requested.

MailSkill exposes only these read-only capabilities:

- `listUnreadMail({ mailboxId?, businessContext?, limit? })`;
- `listRecentMail({ mailboxId?, businessContext?, limit?, since? })`;
- `searchMail({ mailboxId?, businessContext?, from?, subject?, since?, unreadOnly?, limit? })`;
- `findMessagesFromSender({ mailboxId?, businessContext?, sender, since?, limit? })`;
- `summarizeImportantMail({ businessContext: "miska", since?, limit? })`.

Search filters are converted to an ImapFlow criteria object inside the adapter.
Raw IMAP commands or arbitrary query trees are rejected. Search is limited to
20 results; recent mail defaults to 24 hours, general search to 30 days, and
sender lookup to 7 days. The adapter does not expose or call `STORE`, `EXPUNGE`,
`MOVE`, `COPY`, `APPEND`, SMTP, send, reply, archive, or mark-read operations.

## Sender aliases and deterministic summaries

The provider-neutral sender alias registry initially contains text aliases for
Valta, Premium Pet, Zoograd, and Onikienko. It contains no inferred email
addresses. Known company lookup uses a bounded IMAP `OR` across configured
alias tokens in `From` and `Subject`, plus exact `From` matching for confirmed
addresses. Unknown senders are matched conservatively by display name or a
full subject phrase. Arthur never invents or automatically persists an address
discovered in mail.

The `summarizeImportantMail` capability is a deterministic management summary
for the Miska mailbox. `HIGH` means a known company alias, an allowed business
topic (price list, price, order, supply, availability, contract, document,
invoice, payment, debt, return, complaint, promotion, or confirmation), or
explicit action wording. Ordinary work and single service notices are `MEDIUM`.
Repeated automatic notifications, PayMaster payment notices, and newsletters
are `LOW`. Unread state is only a ranking signal: read business mail inside the
requested window is still included. No AI importance classifier is used.

Repeated messages are grouped only by normalized sender identity plus exact
normalized subject. Different subjects from the same supplier remain separate.
Each group records its count, latest timestamp, importance, and deterministic
reason. PayMaster-style repetitions appear as one line with the exact count
rather than filling the Telegram response.

The default important-mail window starts at 00:00 of the current calendar day
in `Asia/Vladivostok`. “Last 24 hours” and “last 7 days” are rolling windows and
are not treated as calendar-day aliases. At most 20 candidates are analyzed and
at most 5 important and 5 other entries are rendered. If the candidate cap is
reached, metadata and response text conservatively mark the summary as
truncated.

Summary text is constructed only from normalized `From`, `Subject`,
`receivedAt`, and the existing bounded snippet. It never reads attachments or
full message bodies and never claims that a reply is required; explicit action
wording is presented only as something that may need attention.

Subjects and snippets are untrusted input. Mail responses use bounded
deterministic `responseText`; the synthesizer excludes message payloads,
addresses, snippets, raw MIME, and attachments from AI synthesis input.

## Confirmed mail-to-task proposals

Mail reads never create tasks. When both MailSkill and the existing Arthur Core
`createTask` capability are registered, a successful sender lookup may propose
one task, and an important-mail summary may offer a bounded choice of up to
three important messages. `HIGH` importance is only a relevance signal and is
never treated as write permission.

Task titles are deterministic. The existing sender alias registry supplies the
company label, while allowed subject topics select conservative actions such as
`Проверить прайс Валты`. If no supported topic is present, Arthur proposes only
`Проверить письмо <компании>` or `Проверить письмо от <отправителя>`. No LLM
decides whether to create a task or generates the task title.

The proposal is stored in the existing in-memory conversation pending-action
store under the canonical owner plus `conversationId`. It contains only the
mailbox ID, a mail `sourceRef`, bounded subject/display fields, and the proposed
task title. It contains no message body, snippet, attachment, credentials, or
raw MIME. Mail proposals expire after ten minutes and are intentionally lost if
the single gateway restarts.

Exact replies `да`, `создай`, `создать`, `сделай`, `ок`, `хорошо`, and `давай`
confirm a single proposal. `нет`, `не надо`, `отмена`, and `не создавать`
discard it without a write. Numbered selection is required for ambiguous mail;
`Создай по Валте` may select one company from an important-mail summary. An
unrelated request clears the proposal and continues through normal routing.

Only confirmation creates the normal `arthur-core.createTask` plan. The Core
skill keeps canonical owner isolation, its existing exact-title/due-date
duplicate guard, audit behavior, and task defaults. The task receives a bounded
`mail:<provider>:<provider source reference>` source reference when available;
no schema change is required. Creating the task does not modify the source
message or its unread state.

## Configuration without credentials

Non-secret mailbox metadata is configured in `docker/arthur/.env`:

```dotenv
ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED=false
ARTHUR_MAILBOX_MISKA_YANDEX_ID=miska-yandex
ARTHUR_MAILBOX_MISKA_YANDEX_PROVIDER=yandex
ARTHUR_MAILBOX_MISKA_YANDEX_ACCOUNT_TYPE=work
ARTHUR_MAILBOX_MISKA_YANDEX_BUSINESS_CONTEXT=miska
ARTHUR_MAILBOX_MISKA_YANDEX_DISPLAY_NAME=Почта Миски
ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_HOST=imap.yandex.ru
ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_PORT=993
ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_TLS=true
ARTHUR_MAILBOX_MISKA_YANDEX_IMAP_FOLDER=INBOX
```

Username and app password must never be placed in `.env`. Compose reads them
from host files and mounts them only into `telegram-gateway` as Docker secrets.
The Arthur Core API, PostgreSQL, migration service, Purchasing services, and
other containers do not receive these files or mail configuration.

The checked-in files under `docker/arthur/secrets/*.example` are invalid
placeholders. Runtime registration rejects them. Real secret files are ignored
by Git and excluded from the Docker build context.

## Controlled production connection

For a controlled connection:

1. Enable IMAP access in Yandex Mail settings.
2. Create a dedicated Yandex app password of type **Mail**.
3. Store the mailbox username and app password in two protected production
   files outside the repository.
4. Set `ARTHUR_MAILBOX_MISKA_YANDEX_USERNAME_SECRET_SOURCE` and
   `ARTHUR_MAILBOX_MISKA_YANDEX_APP_PASSWORD_SECRET_SOURCE` to those host file
   paths. Compose will mount them only into `telegram-gateway`.
5. Set `ARTHUR_MAILBOX_MISKA_YANDEX_ENABLED=true`, rebuild/recreate only
   `telegram-gateway`, confirm health and sanitized logs, then run one controlled
   read-only Telegram smoke request for unread Miska mail.

If any required field or secret file is missing, unreadable, empty, or still a
placeholder, the real mail skill is not registered and no IMAP login is made.
