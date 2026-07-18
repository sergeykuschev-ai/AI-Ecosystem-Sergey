const { normalize } = require('../parsers/minmax_parser');

const STRATEGIC_BRAND_FRAGMENTS = [
  'award',
  'craftia',
  'mnyams',
  'мнямс',
  'cat fedor',
  'кота федора',
  'galena',
  'япон',
  'tofu',
];

const DELIVERY_THRESHOLD = 70000;

function isStrategic(name) {
  const text = normalize(name);
  return STRATEGIC_BRAND_FRAGMENTS.some(fragment => text.includes(fragment));
}

module.exports = { STRATEGIC_BRAND_FRAGMENTS, DELIVERY_THRESHOLD, isStrategic };
