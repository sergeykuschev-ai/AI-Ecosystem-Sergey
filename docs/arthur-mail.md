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
- `findMessagesFromSender({ mailboxId?, businessContext?, sender, since?, limit? })`.

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

The “important Miska mail today” view is deterministic. It scores current-day
and unread messages, known aliases, business subject tokens, and conservative
response-candidate wording. It does not use an AI importance classifier.
Repeated messages are grouped by normalized sender plus normalized subject.
Groups of three or more remain represented in metadata and appear as one noise
line with their exact count. PayMaster-style repeated payment notifications are
penalized so they do not outrank supplier or business-subject mail without
additional positive signals.

Subjects and snippets are untrusted input. Mail responses use bounded
deterministic `responseText`; the synthesizer excludes message payloads,
addresses, snippets, raw MIME, and attachments from AI synthesis input.

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
