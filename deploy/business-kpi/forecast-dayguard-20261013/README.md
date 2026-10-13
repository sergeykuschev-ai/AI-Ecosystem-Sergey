# Business KPI forecast day guard (2026-10-13)

## Problem and verified result

Production weekday_56d projection excluded the current date unconditionally. When there was no recorded October 13 shift, that day was absent from both recorded and projected sales.
October 2026 Miska: sales through October 12 = 345135.20 RUB (12 shifts), plan = 850000 RUB; old projection = 837665.83 RUB; fixed projection = 862043.06 RUB; remaining days = 19; daily requirement = 26571.83 RUB.
These numbers came from the production Business KPI dashboard API, and are a historical snapshot.

## Important version mismatch

Current GitHub main does not yet include all production Business KPI features (weekday_56d and B2B). Do not rebuild and replace the production image directly from main until parity is established.
Here the production overlay stores the exact tested module and test fixtures. The canonical module in main also has the no-shift-today remaining-days correction and tests, but retains its existing month_average forecast.

## Rebuild

Prerequisite: existing local Docker base image business-kpi-web:miska-five-courses-quiz-20261012, image ID sha256:5e891898daad84891e6dcad9a4a751f800fb6a4e5bc5d867a98cd7232cadcce8.
On authorized Docker host, from this directory:

    docker build -t business-kpi-web:forecast-dayguard-20261013 .
    docker run --rm --entrypoint node business-kpi-web:forecast-dayguard-20261013 --test /opt/business-kpi/agents/business-kpi/tests/aggregate_month.test.js /opt/business-kpi/agents/business-kpi/tests/forecast_day_guard.test.js

Tests: 15 passed, 0 failed in the derived image.
On the Windows host, the deployed Compose file is C:\AI-Ecosystem\local-services\business-kpi\business-kpi-compose.yml; service web uses business-kpi-web:forecast-dayguard-20261013. Only web was recreated. The Postgres volume was not changed.
Rollback: restore the old image tag in the Compose web service, then run from the compose directory:

    docker compose -f business-kpi-compose.yml --env-file business-kpi.env up -d --no-deps --no-build --force-recreate web

Original compose backup: C:\AI-Ecosystem\deploy-staging\business-kpi-forecast-20261013\business-kpi-compose.before.yml.

## Release invariants

1. If today's shift is missing, include today in the current month forecast and required-day denominator.
2. If today's sales are recorded, do not count their full-day forecast a second time.
3. Avoid division by zero on the last date of a month.
4. Leave historical-month calculations unchanged.
5. Preserve production B2B, seller academy, DB volume, and other existing features.

When the production model is ported back into the canonical tracked module, preserve the day guard and regression tests here. Never overwrite the production image with a stale GitHub source build.
