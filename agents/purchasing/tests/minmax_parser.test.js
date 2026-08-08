const assert = require('node:assert/strict');
const { test } = require('node:test');

const { toNumber, getNum } = require('../parsers/minmax_parser');

test('toNumber returns null for null, undefined, empty, and whitespace', () => {
  assert.strictEqual(toNumber(null), null);
  assert.strictEqual(toNumber(undefined), null);
  assert.strictEqual(toNumber(''), null);
  assert.strictEqual(toNumber('   '), null);
});

test('toNumber parses plain integers', () => {
  assert.strictEqual(toNumber('1234'), 1234);
  assert.strictEqual(toNumber('0'), 0);
  assert.strictEqual(toNumber(1234), 1234);
});

test('toNumber parses dot decimal numbers', () => {
  assert.strictEqual(toNumber('1234.56'), 1234.56);
  assert.strictEqual(toNumber('0.5'), 0.5);
  assert.strictEqual(toNumber('.5'), 0.5);
});

test('toNumber parses comma decimal numbers', () => {
  assert.strictEqual(toNumber('1234,56'), 1234.56);
  assert.strictEqual(toNumber('0,75'), 0.75);
});

test('toNumber parses space thousands', () => {
  assert.strictEqual(toNumber('1 234'), 1234);
  assert.strictEqual(toNumber('12 345'), 12345);
  assert.strictEqual(toNumber('1 234 567'), 1234567);
});

test('toNumber parses mixed space thousands with comma decimal', () => {
  assert.strictEqual(toNumber('1 234,56'), 1234.56);
});

test('toNumber parses mixed comma thousands with dot decimal', () => {
  assert.strictEqual(toNumber('1,234.56'), 1234.56);
  assert.strictEqual(toNumber('1,234,567.89'), 1234567.89);
});

test('toNumber parses mixed dot thousands with comma decimal', () => {
  assert.strictEqual(toNumber('1.234,56'), 1234.56);
  assert.strictEqual(toNumber('1.234.567,89'), 1234567.89);
});

test('toNumber preserves negative numbers', () => {
  assert.strictEqual(toNumber('-1234'), -1234);
  assert.strictEqual(toNumber('-1234.56'), -1234.56);
  assert.strictEqual(toNumber('-1234,56'), -1234.56);
  assert.strictEqual(toNumber('-1 234,56'), -1234.56);
  assert.strictEqual(toNumber('-1,234.56'), -1234.56);
  assert.strictEqual(toNumber('-'), null);
});

test('toNumber rejects NaN, Infinity, and garbage', () => {
  assert.strictEqual(toNumber(Number.NaN), null);
  assert.strictEqual(toNumber(Number.POSITIVE_INFINITY), null);
  assert.strictEqual(toNumber('NaN'), null);
  assert.strictEqual(toNumber('abc'), null);
  assert.strictEqual(toNumber('12abc34'), null);
  assert.strictEqual(toNumber('1 234 USD'), null);
});

test('toNumber rejects ambiguous repeated comma format', () => {
  assert.notStrictEqual(toNumber('1,234,567'), 1.234567);
  assert.strictEqual(toNumber('1,234,567'), null);
  assert.strictEqual(toNumber('1,234,567,890'), null);
});

test('toNumber rejects ambiguous repeated dot format', () => {
  assert.strictEqual(toNumber('1.234.567'), null);
  assert.strictEqual(toNumber('1.234.567.890'), null);
});

test('toNumber rejects ambiguous single separator with three trailing digits', () => {
  assert.strictEqual(toNumber('1,234'), null);
  assert.strictEqual(toNumber('1.234'), null);
});

test('toNumber rejects invalid grouping when both separators are present', () => {
  assert.strictEqual(toNumber('12,34.56'), null);
  assert.strictEqual(toNumber('1234,567.89'), null);
});

test('getNum returns null for missing keys and parses present keys', () => {
  assert.strictEqual(getNum({}, ['value']), null);
  assert.strictEqual(getNum({ other: '42' }, ['value']), null);
  assert.strictEqual(getNum({ value: '1234,56' }, ['value']), 1234.56);
  assert.strictEqual(getNum({ value: '1,234,567' }, ['value']), null);
});
