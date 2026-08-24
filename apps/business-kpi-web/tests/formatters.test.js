'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  percentInput,
  percentValue,
  formatPercent,
  formatMoneyAxis,
  UNAVAILABLE,
} = require('../public/formatters');

test('percentInput converts backend ratio to UI percentage', () => {
  assert.equal(percentInput(0.3), 30);
  assert.equal(percentInput(0.022), 2.2);
  assert.equal(percentInput(0.007), 0.7);
  assert.equal(percentInput(1), 100);
  assert.equal(percentInput(null), '');
  assert.equal(percentInput(''), '');
});

test('percentValue converts UI percentage to backend ratio', () => {
  assert.equal(percentValue('30'), 0.3);
  assert.equal(percentValue('2.2'), 0.022);
  assert.equal(percentValue('0.7'), 0.007);
  assert.equal(percentValue('100'), 1);
  assert.equal(percentValue(''), null);
  assert.equal(percentValue(null), null);
  assert.ok(Number.isNaN(percentValue('abc')));
});

test('formatPercent and percentInput round-trip for typical values', () => {
  const values = [0.3, 0.2, 0.022, 0.007, 0.1, 0.25, 1];
  for (const value of values) {
    const input = percentInput(value);
    const back = percentValue(String(input));
    assert.ok(Math.abs(back - value) < 0.0001, `round-trip failed for ${value}: ${back}`);
  }
});

test('formatMoneyAxis produces readable Y-axis labels', () => {
  assert.equal(formatMoneyAxis(null), UNAVAILABLE);
  assert.equal(formatMoneyAxis(0), '0 ₽');
  assert.equal(formatMoneyAxis(500), '500 ₽');
  assert.equal(formatMoneyAxis(999), '999 ₽');
  assert.equal(formatMoneyAxis(1_000), '1 тыс. ₽');
  assert.equal(formatMoneyAxis(1_500), '2 тыс. ₽');
  assert.equal(formatMoneyAxis(999_999), '1 000 тыс. ₽');
  assert.equal(formatMoneyAxis(1_000_000), '1 млн ₽');
  assert.equal(formatMoneyAxis(2_500_000), '3 млн ₽');
  assert.equal(formatMoneyAxis(1_234_567_890), '1 235 млн ₽');
});
