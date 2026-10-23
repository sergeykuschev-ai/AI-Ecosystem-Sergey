# VOZDOOH 1C CommerceML receiver

Isolated receiver for the standard 1C website catalog exchange used by VOZDOOH.
It accepts catalog exchange only and stages uploaded files before any publication.

Endpoint: `/api/1c/exchange`.
Supported modes: `checkauth`, `init`, `file`, `import`.
Authentication: HTTP Basic for `checkauth`, followed by a signed session cookie.
