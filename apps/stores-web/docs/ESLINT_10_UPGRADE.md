# ESLint 10 Upgrade Evaluation (Blocked)

Date: 2026-09-10
Issue: stores-web coordinated Next.js 16 + ESLint 10 update
Status: **BLOCKED — no safe compatible combination exists; do not force.**

## Evaluated combination

| Package           | Current (kept) | Evaluated      | Result   |
| ----------------- | -------------- | -------------- | -------- |
| next              | 16.3.3         | 16.3.4         | fine     |
| eslint-config-next| 16.3.3         | 16.3.4         | fine     |
| eslint            | 9.34.0         | 10.10.0        | blocked  |

Latest stable Next.js 16.x is `16.3.4`; matching `eslint-config-next@16.3.4`
declares peer `eslint >=9.0.0` (covers 10.x) and depends on
`eslint-plugin-react ^7.37.0`.

## Blocking dependency

`eslint-plugin-react@7.37.5` is the newest published release (no 8.x, no
prerelease with a fix). Its peer range is `^3 || ^4 || ^5 || ^6 || ^7 || ^8 ||
^9.7` — ESLint 10 is not declared or supported.

With ESLint 10 installed, every `react/*` rule crashes while loading:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
    at resolveBasedir (eslint-plugin-react/lib/util/version.js:31)
```

This is the same failure recorded before this evaluation. ESLint 10 removed the
deprecated `context.getFilename()`-style compat API that
`eslint-plugin-react@7.37.x` still calls.

`eslint-config-next@16.4.0-canary.25` (latest canary checked) still pins
`eslint-plugin-react ^7.37.0`, so no published eslint-config-next — stable or
canary — supports ESLint 10 today.

npm resolves the install only by auto-overriding three undeclared peer ranges
(`eslint-plugin-react`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`),
i.e. the tree is only installable with peer conflicts silently overridden.
That does not satisfy "smallest compatible upgrade set, no force upgrades".

## Decision

Reverted to the previous working set: `next@16.3.3`, `eslint-config-next@16.3.3`,
`eslint@9.34.0`. No source or config changes were made.

## Unblock conditions

Re-evaluate when either:

1. `eslint-plugin-react` publishes a release whose peer range includes ESLint 10
   (fixing the `contextOrFilename.getFilename` crash), and `eslint-config-next`
   16.x picks it up; then the minimal set is
   `eslint@10.x` + `next@16.3.x` + `eslint-config-next@16.3.x`.
2. A future Next.js 16.x release vendors or replaces the react plugin with an
   ESLint 10-compatible one.
