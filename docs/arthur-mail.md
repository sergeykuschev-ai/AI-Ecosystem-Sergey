# Arthur Mail: Yandex IMAP setup

Arthur Mail Stage 2A provides a provider-neutral, read-only IMAP adapter for
the `miska-yandex` mailbox. The mailbox remains disabled by default. This stage
does not contain credentials and does not perform a live Yandex connection.

## Read-only boundary

The adapter connects with TLS, validates the server certificate, and opens
`INBOX` with `readOnly: true`, which makes ImapFlow use IMAP `EXAMINE` instead
of a writable `SELECT`. It searches only for unseen messages and performs
bounded `BODY.PEEK` reads. Only a bounded `text/plain` part is downloaded; when
plain text is absent, a bounded `text/html` part may be converted to plain text
without executing HTML or scripts. Attachments are never requested.

The adapter exposes only `listUnreadMail`. It does not expose or call `STORE`,
`EXPUNGE`, `MOVE`, `COPY`, `APPEND`, SMTP, send, reply, archive, or mark-read
operations.

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

## Controlled connection: future stage

Do not perform these steps as part of Stage 2A. For the controlled connection:

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
