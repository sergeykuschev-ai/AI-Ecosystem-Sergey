# Sequential SEO P1 implementation — 14 October 2026

Owner-approved scope: seven stages in order; preserve commerce, production catalog, public indexing and existing German tunnel. Search demand and search-platform processing remain unverified. Evidence root: `/opt/vozdooh/state/seo-p1-20261014/`. No search engine submissions or outbound notifications are authorized by this implementation.

## Stage 1 — mobile overflow

Baseline: clean `a672dfd7`; running web revision `3a2a8374`, image `sha256:4c0371eb260fd83bfb65a993a6d64387416ca67c4de90da72082453ebbb718ff`. Live health HTTP 200. The gift collection heading's unbroken first word exceeds its 12ch box. Live document widths at 320/375/390/430px: 392/395/396/430px. The new browser regression fails against unchanged production at 320px.

Mobile collection headings now use the available content width and can wrap long words. Desktop rules, font size, colors and spacing remain unchanged; overflow is not hidden. Opt-in regression: source `/tmp/vozdooh-header-browser-env.sh`, then run `scripts/verify-seo-layout-browser.cjs` with `VOZDOOH_QA_URL`, optional `VOZDOOH_QA_PROXY` and `VOZDOOH_QA_OUTPUT`. It checks ten public routes at 320/375/390/430/1280px, waits for fonts and records 390/1280px screenshots. Only same-origin GET requests are allowed.

Release gates and deployed revision/image/rollback will be recorded after fresh verification.

Fresh `npm run verify` passed (exit 0). The candidate passed all 50 route/viewport combinations; 390/1280 screenshots are in `task1/candidate/` and the gift collection was visually inspected. Regression fails before and passes after the fix. Deployment gate passed; only the web target will be built and replaced. Existing compose's web-only recreation has a short startup interval; rollback retains the prior web image and never restarts the worker.
