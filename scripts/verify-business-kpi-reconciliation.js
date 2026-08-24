'use strict';

const { PostgresBusinessKpiStore } = require('../apps/business-kpi-web/storage/postgres_business_kpi_store');

const EXPECTED = {
  5: { revenue: 739091.20, receipts: 727 },
  6: { revenue: 736517.85, receipts: 715 },
  7: { revenue: 794937.10, receipts: 735 },
  8: { revenue: 593037.60, receipts: 437 },
};

const EPSILON = 0.01;

async function main() {
  const databaseUrl = process.env.BUSINESS_KPI_DATABASE_URL || process.env.ARTHUR_DATABASE_URL;
  if (!databaseUrl) {
    console.error('BUSINESS_KPI_DATABASE_URL or ARTHUR_DATABASE_URL is required');
    process.exitCode = 1;
    return;
  }
  const store = new PostgresBusinessKpiStore({ databaseUrl });
  try {
    const storeId = process.env.BUSINESS_KPI_STORE_ID;
    if (!storeId) {
      console.error('BUSINESS_KPI_STORE_ID is required');
      process.exitCode = 1;
      return;
    }
    let allPass = true;
    for (const [month, expected] of Object.entries(EXPECTED)) {
      const result = await store.client.query(
        `SELECT
          COALESCE(SUM(
            CASE
              WHEN revenue_source = 'historical_total' AND historical_revenue IS NOT NULL
              THEN historical_revenue
              ELSE COALESCE(cash_amount, 0) + COALESCE(acquiring_amount, 0)
            END
          ), 0) AS revenue,
          COALESCE(SUM(receipts), 0) AS receipts
         FROM business_kpi.shifts
         WHERE store_id = $1
           AND EXTRACT(YEAR FROM shift_date) = 2026
           AND EXTRACT(MONTH FROM shift_date) = $2
           AND archived_at IS NULL`,
        [storeId, month]
      );
      const revenue = Number(result.rows[0].revenue);
      const receipts = Number(result.rows[0].receipts);
      const revenueOk = Math.abs(revenue - expected.revenue) < EPSILON;
      const receiptsOk = receipts === expected.receipts;
      const status = revenueOk && receiptsOk ? 'PASS' : 'FAIL';
      if (!revenueOk || !receiptsOk) allPass = false;
      console.log(
        `2026-${String(month).padStart(2, '0')} ${status}: ` +
        `revenue ${revenue.toFixed(2)} / ${expected.revenue.toFixed(2)}, ` +
        `receipts ${receipts} / ${expected.receipts}`
      );
    }
    process.exitCode = allPass ? 0 : 1;
  } finally {
    await store.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
