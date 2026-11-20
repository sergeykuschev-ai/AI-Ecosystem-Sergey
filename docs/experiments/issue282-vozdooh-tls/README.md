# VOZDOOH HTTPS recovery and Webmaster investigation

Related: [issue #282](https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/issues/282). Current status: **29 October 2026**.

VOZDOOH public HTTPS was restored on 28 October after the owner's explicit approval, private staging and a separate independent Kimi review. The subsequent read-only investigation found explicit service limitations in Yandex Webmaster. **The API summary value 0 is not a reliable proof of current total deindexing.** The actual current index size remains unconfirmed.

## Verified production recovery

The active shared Caddyfile had lost both VOZDOOH domain blocks. Before recovery, tested direct and German-proxy routes failed TLS before receiving a certificate or HTTP response, while the existing application upstream remained healthy.

The approved append-only patch restored:
- www.vozdooh27.ru: permanent redirect to the HTTPS apex, preserving the URI;
- vozdooh27.ru: reverse proxy to the existing vozdooh-web-domain:3411 upstream.

The exact candidate passed adaptation with the existing Caddy 2.9.1 binary, private TLS staging and independent Kimi QA with no blocking findings. The operator rechecked the live baseline, saved a protected backup, preserved the file bind mount inode during the write and performed a normal Caddy reload. Containers, application code and images were unchanged.

- Baseline SHA-256: ffeb771e21062176054633aab768bec8a6eb373037c537aeedd48c246b26a35f
- Applied candidate SHA-256: 1a43fc86651addd11a5013db88e2468206dd19f0509dafa540ae9485663aee08
- Finished: 2026-10-28T13:06:08Z
- Backup: /opt/vozdooh/backups/issue282-tls-20261028T130602Z
- Result: applied and verified; rollback was not needed.

External checks from Germany and Mac verified the public TLS certificate. Homepage, product, robots and sitemap returned 200; www returned 301 and HTTP upgraded to HTTPS with 308. Existing AmurskMarket/CMS/Miska route results were preserved. Homepage and product source HTML contained H1, index/follow and correct canonical URLs, with no global X-Robots-Tag noindex.

These are historical recovery records. Do not reapply the patch blindly or replace the whole live file with an old backup. Any future production change needs a fresh baseline, reviewed candidate and the owner's authorization. Use the protected backup and the bind-mount-safe procedure if a separately justified rollback is required.

## Webmaster service limitations confirmed on 29 October

The authenticated Webmaster interface for the correct verified HTTPS site shows:
- Dashboard: data updates are temporarily unavailable; displayed search updates end on 10 October.
- Diagnostics: data updates and report export are temporarily unavailable.
- Sitemap: read-only mode; adding a sitemap and requesting its recrawl are unavailable. The existing sitemap is **queued for processing**, with the displayed added date **04.10.2026**.
- Pages in search: graphs/export are unavailable and data may be delayed. All-pages and excluded-pages tabs are disabled; visible changes are dated 10 October.

The banners link to [Yandex's infrastructure incident notice](https://yandex.ru/company/news/09-10-2026-01). These tool-specific warnings confirm a freshness problem; they do not establish that the actual search crawler or search index is fully stopped.

A fresh API HTTP response still reports summary 0 versus 67 in-search records dated 8–10 October. All 67 records occur in today's sitemap. The robot-discovered sitemap list is empty; the user-added entry exists, and the UI now explains its queued state. NO_SITEMAPS has an old last-state-update timestamp of 10 October, rather than a fresh verified post-recovery finding.

Explicit query history requests for 1–28 October and 31 July–28 October return zero-valued show/click series, with no average-position series. The popular-query response itself ends on **6 October**, despite a requested end date of 28 October. CTR is undefined for zero reported impressions. These data cannot establish current traffic or full-period reporting completeness. Metrica aggregates were collected separately for the owner; visits are a different measure.

The existing daily public audit at 2026-10-29T05:31:21Z scanned all 195 sitemap URLs: all returned 200, with no HTTP errors or technical findings recorded by that audit. This is a point-in-time check, not a guarantee against future errors.

## Evidence and remaining gate

- [Exact operational patch](restore-vozdooh-only.patch)
- [Staging and validation](validation.json)
- [Independent Kimi review](independent-qa.json)
- [Approved deployment and external checks](deployment.json)
- [29 October indexing and service-status evidence](indexation-20261029.json)

No new production change, sitemap resubmission, recrawl request, logging change, scheduler or model fallback was performed during the 29 October continuation. HTTP access logging was not configured, so actual verified YandexBot hits cannot be established from missing logs.

Keep #282 open. Once Webmaster updates and tools recover, recheck processing of the existing sitemap and dated URL/index/query data. A bounded recrawl should be considered only if fresh evidence warrants it. Neither 0 nor the stale count 67 is a confirmed current index size, and index recovery has not been claimed.

API references: [summary](https://yandex.ru/dev/webmaster/doc/ru/reference/host-id-summary), [sitemaps](https://yandex.ru/dev/webmaster/doc/ru/reference/host-sitemaps-get), [query history](https://yandex.ru/dev/webmaster/doc/ru/reference/host-search-queries-history-all), [popular queries and returned date limits](https://yandex.ru/dev/webmaster/doc/ru/reference/host-search-queries-popular).
