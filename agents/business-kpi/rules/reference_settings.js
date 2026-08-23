'use strict';

const MISKA_AUGUST_2026_SETTINGS = Object.freeze({
  version: 1,
  effectiveFrom: '2026-08-01',
  effectiveTo: null,
  source: 'KPI_Миска_08.2026_ИТОГ_эквайринг_включает_QR_BACKUP.xlsx',
  targets: Object.freeze({
    shiftRevenue: 24000,
    sellerShifts: 15,
    averageCheck: 1200,
    itemsPerReceipt: 2.5,
    upsellReceiptShare: 0.3,
    treatsRevenue: 1200,
    treatsReceiptShare: 0.2,
    qrShare: null,
  }),
  weights: Object.freeze({
    shiftPlan: 30,
    averageCheck: 20,
    itemsPerReceipt: 15,
    upsell: 20,
    treats: 15,
  }),
  levels: Object.freeze([
    Object.freeze({ name: 'Отлично', minimumScore: 95, bonusBase: 7000 }),
    Object.freeze({ name: 'Хорошо+', minimumScore: 90, bonusBase: 5000 }),
    Object.freeze({ name: 'Хорошо', minimumScore: 85, bonusBase: 4000 }),
    Object.freeze({ name: 'Минимум', minimumScore: 75, bonusBase: 2500 }),
    Object.freeze({ name: 'Без премии', minimumScore: 0, bonusBase: 0 }),
  ]),
  qrCoefficientTiers: Object.freeze([
    Object.freeze({ upperExclusive: 0.1, coefficient: 0.95 }),
    Object.freeze({ upperExclusive: 0.15, coefficient: 1 }),
    Object.freeze({ upperExclusive: 0.2, coefficient: 1.025 }),
    Object.freeze({ upperExclusive: 0.25, coefficient: 1.05 }),
    Object.freeze({ upperExclusive: null, coefficient: 1.075 }),
  ]),
  fees: Object.freeze({ acquiring: 0.022, qr: 0.007 }),
  payment: Object.freeze({ qrIncludedInAcquiring: true }),
  unresolved: Object.freeze([
    'Excel Settings does not define a standalone target QR share; QR is represented by coefficient tiers.',
  ]),
});

module.exports = { MISKA_AUGUST_2026_SETTINGS };
