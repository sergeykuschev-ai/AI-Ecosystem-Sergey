# Issue 310: bounded historical URL migration

Candidate baseline: `d321cfd97301270b6e374621e76d8df6e93404f5`; app tree
`a0d3307d6e8e0903e19600654f8d039e36f600e0`.

The owner reports 300 unique URLs in the 27 November CSV: 291 historical
ROBOTS_HOST_ERROR and nine LOW_DEMAND. Historical errors do not establish current
blocking. The five approved historical URLs returned final GET 404 on that date;
their exact replacement identities returned 200 and belong to the 202-URL sitemap.
These are supplied evidence, not live checks performed in this candidate.

`src/seo/historicalRedirects.ts` contains only those five mappings, with both
candle-category slash forms. The existing Next.js proxy returns HTTP 301 for
GET/HEAD with a fixed relative Location, empty body and no forwarded query.
A Response status supports explicit 301 without relying on the redirect helper's
default permanent 308. Other methods and unmatched paths pass through. No decoding,
prefix matching, product guessing or request-derived redirect destination is used.
Existing `/catalog` pagination behavior remains separate.

Framework slash/URL normalization occurs outside this policy. The candidate does
not change global normalization settings. A trailing-slash category request may
receive Next.js's normalization 308 before the allowlisted 301; confirm the chain
in isolated HTTP runtime checks. Encoded or malformed inputs are rejected by exact
policy matching; any framework preprocessing/rejection needs runtime verification.

Dependency-free checks on Node 24:

```powershell
node --test tests/historical-redirects.test.cjs
```

These execute actual policy/proxy source using native TypeScript stripping with
a Response double and the actual pagination policy. They cover mapping, GET/HEAD,
non-read methods, query removal, fixed destinations, no policy loops, unmatched
paths, different sizes, encoded/malformed paths and pagination branch preservation.
They do not certify Next.js matcher compilation, URL preprocessing or real HTTP
GET/HEAD parity. Existing pagination tests exercise the real policy with dependencies.

Local node_modules (including bundled Next.js guides) and rg are absent. No
dependency installation or network access is authorized. Full verify/CI, isolated
HTTP checks and independent QA remain with the orchestrator. No commit, push or
deployment is part of this candidate.

Local results: all three focused tests passed; `git diff --check` passed.
`npm.cmd run verify` was attempted and stopped at the missing `typescript` module
before typecheck, lint or build could run. The PowerShell `npm` launcher was blocked
by the existing execution policy; using the installed `.cmd` launcher required no
policy or system changes.

Follow-up: reconcile the remaining historical URLs against exact product identity,
including brand, fragrance, format and size. Verify each source and destination
and obtain approval before extending the allowlist. The 225g Siberian Pine Forest
must not redirect to a 515g product; no such mapping is included.
