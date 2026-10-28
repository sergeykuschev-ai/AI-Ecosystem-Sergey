# VOZDOOH public TLS route recovery candidate

Related: [issue #282](https://github.com/sergeykuschev-ai/AI-Ecosystem-Sergey/issues/282). Prepared 28 October 2026. This directory is a reviewable operational recovery proposal. It does not change the tracked application, live Caddyfile, container images, certificates, or running services.

## Confirmed incident

The active Caddy configuration and its mounted source file no longer contain vozdooh27.ru or www.vozdooh27.ru. Only the three AmurskMarket host matches remain. The live file was modified at 11:04:17 UTC on 28 October. Public TLS probes from the tested direct and German-proxy routes fail after ClientHello, before an HTTP response or certificate is returned.

The existing vozdooh-web-domain container remains healthy on port 3411. Read-only upstream requests return HTTP 200 for health, robots.txt and sitemap.xml. Robots permits public crawling and the sitemap has 195 URLs. The persisted apex and www certificate files contain the correct respective names and expire on 25 December 2026. This checks public certificate metadata only; no private key was exported.

## Exact proposed change

Append the two original VOZDOOH host blocks from the saved 6 October Caddyfile. The apex proxies to the existing vozdooh-web-domain:3411 upstream; www redirects to the canonical HTTPS apex while preserving the URI.

Use restore-vozdooh-only.patch against the current live configuration. Do not replace the entire live file with an older backup or with the repository's historical Caddyfile: those are different baselines and can discard current AmurskMarket behavior.

Expected current live file: /opt/stores-web/app/Caddyfile

- SHA-256 before: ffeb771e21062176054633aab768bec8a6eb373037c537aeedd48c246b26a35f
- SHA-256 of the full proposed candidate: 1a43fc86651addd11a5013db88e2468206dd19f0509dafa540ae9485663aee08

Any mismatch requires a new comparison and review. Never force-apply against concurrent edits.

## Validation already performed

The exact existing Caddy v2.9.1 binary adapted the full candidate successfully. Parsed host matches add only vozdooh27.ru and www.vozdooh27.ru. Existing host-route semantics are identical, ignoring Caddy's generated route-group identifiers. The candidate is append-only relative to the live baseline.

Private staging used the same Caddy binary, a listener bound only to loopback, a temporary locally trusted test certificate, and read-only requests to the existing upstream. TLS verification stayed enabled:

- health: HTTP 200;
- robots.txt: HTTP 200, public crawling permitted;
- sitemap.xml: HTTP 200, 195 URL entries;
- www /catalog?issue282=readonly: HTTP 301 to https://vozdooh27.ru/catalog?issue282=readonly.

The temporary server was stopped. The live Caddyfile remained byte-for-byte unchanged. This staging proves the restored route semantics and upstream availability. It does not prove the public production certificate will be loaded until an authorized production reload and external checks occur.

Independent Kimi review of the candidate and these evidence files is a separate required gate; its result is recorded separately. Self-review is not that gate.

## Release and rollback gates

No production release is authorized by this draft. After owner approval and a passing independent review, the trusted operator must:

1. Recheck the live-file hash, active configuration, expected upstream, and certificate metadata. Preserve a dated, hashed rollback copy. Stop on a conflicting edit.
2. Reproduce the reviewed candidate and verify its exact hash. Validate it with the existing Caddy binary before changing production.
3. Preserve the existing file bind mount: a host-side atomic path replacement can leave the running container bound to the old inode. Use the established deployment convention or a locked in-place update of the already mounted file, followed by the existing Caddy reload procedure. Do not recreate containers or alter other services.
4. Verify externally, with certificate validation enabled, the apex and www TLS handshakes, canonical redirect, homepage, robots, sitemap and a representative product page. Confirm the AmurskMarket routes and CMS access behavior remain unchanged.
5. On a failed reload or failed regression gate, restore the exact saved baseline through the same bind-mount-safe procedure and reload. Report the failed gate; never substitute a new stack, loosen TLS, or retry with another model.

Keep the GitHub issue open: restoring public HTTPS is not the same as proving index recovery.

## Webmaster findings and uncertainty

A fresh read-only request for the verified HTTPS apex returned summary searchable_pages_count=0, while in-search/samples returned count=67 with older October crawl timestamps. The diagnostics report NO_SITEMAPS PRESENT since 10 October; the robot-discovered sitemap list is empty, but a user-added https://vozdooh27.ru/sitemap.xml entry exists from 4 October.

Explicit TOTAL_SHOWS and TOTAL_CLICKS history requests return zero-valued series for the last 28 and 90 complete days. This differs from the older collector's empty arrays, which were obtained without explicit query indicators. Metrica search visits are a separate measure.

These contradictory API snapshots do not prove that every page is absent from search today, and today's TLS outage does not establish the cause of an earlier zero summary. After HTTPS recovery, reconcile freshness and history, inspect sitemap processing and verified crawler logs, then prepare any necessary narrowly scoped follow-up. This proposal does not submit sitemap, request recrawl, alter robots, or modify Webmaster settings.

Primary API references: [summary](https://yandex.ru/dev/webmaster/doc/ru/reference/host-id-summary), [diagnostics](https://yandex.ru/dev/webmaster/doc/ru/reference/host-diagnostics-get), [sitemaps](https://yandex.ru/dev/webmaster/doc/ru/reference/host-sitemaps-get), [query history](https://yandex.ru/dev/webmaster/doc/ru/reference/host-search-queries-history-all).
