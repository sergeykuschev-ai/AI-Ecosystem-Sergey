# Business KPI isolated PostgreSQL test stack

This stack is test-only. It does not extend `docker/arthur/compose.yml`, does
not connect to the `arthur` database, and does not reuse
`arthur_postgres_data`.

## Prepare the server

Run all commands from the repository root. Copy the environment template and
replace every placeholder locally on the server:

```bash
cp docker/business-kpi/.env.test.example docker/business-kpi/.env.test
chmod 600 docker/business-kpi/.env.test
```

Use a URL-safe test password because the compose file constructs a PostgreSQL
URL. Keep the database name `business_kpi_test`. Set
`BUSINESS_KPI_TEST_XLSX_ROOT` to an absolute host directory containing the four
reviewed May-August XLSX files. The directory is mounted read-only and is not
copied into the image.

## Start and inspect

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test up -d --build postgres business-kpi-web
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test ps
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test logs -f postgres business-kpi-migrate business-kpi-web
```

The migration service waits for PostgreSQL and runs only
`apps/business-kpi-web/storage/run-migrations.js`. The Web endpoint is bound to
`127.0.0.1:3220` by default. PostgreSQL port 5432 is not published.

Run migrations again safely when required:

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test run --rm business-kpi-migrate
```

## PostgreSQL integration and persistence

The full integration phase resets only the `business_kpi` schema inside the
guarded `business_kpi_test` database, imports May-August, and leaves a
persistence probe in the database:

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test --profile integration run --rm business-kpi-test
```

Restart both services without deleting the volume, wait for health, then run
the persistence verification phase:

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test restart postgres
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test restart business-kpi-web
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test up -d --wait postgres business-kpi-web
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test --profile integration run --rm -e BUSINESS_KPI_POSTGRES_PHASE=verify-persistence business-kpi-test
```

## Stop and teardown

Stop without removing containers:

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test stop
```

Safe teardown removes containers and the test network but preserves
`business_kpi_test_postgres_data`:

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test down
```

The following command is destructive and must be run only after explicit owner
approval. It permanently deletes the isolated test volume and all test data:

```bash
docker compose -f docker/business-kpi/compose.test.yml --env-file docker/business-kpi/.env.test down -v
```
