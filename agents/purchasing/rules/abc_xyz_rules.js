const { clean } = require('../parsers/minmax_parser');

function normalizeClass(value) {
  return clean(value).toUpperCase().replace(/\s/g, '').replace(/\\/g, '/');
}

function isPriorityABC(abc, xyz) {
  const a = normalizeClass(abc);
  const x = normalizeClass(xyz);
  return a === 'A' && (x === 'X' || x === 'Y');
}

function isRiskyABC(abc, xyz) {
  const a = normalizeClass(abc);
  const x = normalizeClass(xyz);
  const combined = `${a}/${x}`;

  return (
    combined === 'D/D' ||
    combined === 'DD/ZZ' ||
    combined === 'C/Z' ||
    combined === 'D/Z' ||
    combined === 'D/Y'
  );
}

module.exports = { normalizeClass, isPriorityABC, isRiskyABC };
