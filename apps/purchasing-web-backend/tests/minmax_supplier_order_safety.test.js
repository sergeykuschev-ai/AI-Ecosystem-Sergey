'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SupplierOrderService,
  MINMAX_SAFETY_BLOCKED_MESSAGE,
} = require('../application/supplier_order_service');
const {
  SUPPLIER_ORDER_BLOCKED_CODE,
  SupplierOrderError,
} = require('../../../agents/purchasing/services/supplier_order');

function serviceWithSafety(minMaxSafety) {
  return new SupplierOrderService({
    queryService: {},
    registry: {
      getAgentResult() {
        return [{ json: { adapter_diagnostics: { minMaxSafety } } }];
      },
    },
  });
}

test('supplier order export is blocked when required MinMax SKUs are missing', () => {
  const service = serviceWithSafety({
    blockingIssueCount: 2,
    blockingIssues: [
      { key: 'award-pouch-urinary-85' },
      { key: 'award-pouch-healthy-growth-85' },
    ],
  });

  assert.throws(
    () => service.assertMinMaxSafety('run-1'),
    error =>
      error instanceof SupplierOrderError &&
      error.code === SUPPLIER_ORDER_BLOCKED_CODE &&
      error.message === MINMAX_SAFETY_BLOCKED_MESSAGE &&
      error.details.blocking_issue_count === 2
  );
});

test('supplier order export is allowed when MinMax safety has no blocking issues', () => {
  const service = serviceWithSafety({
    blockingIssueCount: 0,
    blockingIssues: [],
  });

  assert.doesNotThrow(() => service.assertMinMaxSafety('run-1'));
});

test('legacy runs without MinMax safety diagnostics remain compatible', () => {
  const service = new SupplierOrderService({
    queryService: {},
    registry: { getAgentResult: () => [{ json: {} }] },
  });

  assert.doesNotThrow(() => service.assertMinMaxSafety('run-legacy'));
});
