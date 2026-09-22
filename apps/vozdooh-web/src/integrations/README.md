# VOZDOOH integration boundary

External systems must be connected through adapters that implement contracts from `src/catalog` and `src/commerce`.

Planned boundaries:
- catalog source;
- inventory / 1C synchronization;
- order persistence;
- payment gateway;
- delivery provider;
- analytics and event export.

Provider credentials belong in environment secrets. Do not import AmurskMarket services or configuration into this app.
