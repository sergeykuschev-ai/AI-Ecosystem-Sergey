# Yandex Webmaster API runbook

This integration uses the official Yandex Webmaster API v4. It discovers the OAuth user and the verified `https://amurskmarket.ru` host automatically. It does not use scraping and does not store credentials or personal data.

## One-time OAuth setup

1. Sign in to the Yandex account that owns the verified site in Yandex Webmaster.
2. Register an application in Yandex OAuth and add the Webmaster permissions `webmaster:hostinfo` and `webmaster:verify`, as required by the official Yandex Webmaster authorization guide. Follow the current Yandex OAuth documentation when completing the authorization flow.
3. Save the resulting access token in the deployment platform's secret store. Do not put it in source control, command arguments, shell history, build arguments, or a public `NEXT_PUBLIC_*` variable.
4. Expose it to the command process at runtime as `YANDEX_WEBMASTER_TOKEN`.

Example where the token is supplied by an approved secret manager:

```sh
export YANDEX_WEBMASTER_TOKEN="$(approved-secret-manager read yandex-webmaster-token)"
npm run yandex-webmaster -- status
```

The command never prints the token or API response bodies from failed requests. Rotate or revoke the token in Yandex OAuth if it may have been exposed.

## Commands

Run commands from `apps/stores-web`:

```sh
# Verification, diagnostics, sitemap/indexing summary, re-crawl quota and queue
npm run yandex-webmaster -- status

# Last 30 days as JSON, or an explicit period as baseline CSV
npm run yandex-webmaster -- queries
npm run yandex-webmaster -- queries --from 2026-08-01 --to 2026-08-31 --format csv

# Safe preview: no token and no network request are required
npm run yandex-webmaster -- recrawl --dry-run

# The only mode that sends POST requests
npm run yandex-webmaster -- recrawl --submit
```

The approved re-crawl list is maintained in `lib/seo/key-urls.ts`. Submission is rejected whenever `CI` is set. When the API exposes a quota remainder, submission stops before the first POST unless the whole approved list fits. Tests and builds do not invoke the CLI and use mocked fetch implementations only.

JSON/CSV query output contains query text and aggregate impressions, clicks, CTR, and position exposed by the API; it contains no account identifiers or personal data. Redirect retained baselines to an access-controlled analytics location.

## Failures and recovery

- `401 AUTHENTICATION_FAILED`: refresh or replace the token.
- `403 ACCESS_DENIED`: confirm site ownership and OAuth read/write permissions.
- `404 RESOURCE_NOT_FOUND`: confirm the site remains registered and verified.
- `409 ALREADY_QUEUED`: the URL is already awaiting re-crawl; do not retry immediately.
- `429 RATE_LIMITED`: inspect the quota returned by `status`; respect `retryAfterSeconds` when present and retry later.

Always run `recrawl --dry-run` for review before a submission. The real command reports the quota snapshot and per-URL API result so an operator can audit the action.
