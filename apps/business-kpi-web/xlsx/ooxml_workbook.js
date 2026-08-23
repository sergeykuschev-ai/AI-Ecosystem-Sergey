'use strict';

const { unzipSync } = require('fflate');

function xmlText(bytes) {
  return bytes ? Buffer.from(bytes).toString('utf8') : null;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTagPrefixes(xml) {
  return xml ? xml.replace(/<(\/?)\w+:/g, '<$1') : xml;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return null;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), match =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), item =>
      decodeXml(item[1])
    ).join('')
  );
}

function parseCell(cellXml, sharedStrings) {
  const openTag = cellXml.match(/^<c\b[^>]*>/)?.[0] || '';
  const type = attribute(openTag, 't');
  const formula = cellXml.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] || null;
  const inline = cellXml.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1];
  const raw = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  let value = null;
  if (inline !== undefined) {
    value = Array.from(inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), item =>
      decodeXml(item[1])
    ).join('');
  } else if (raw !== undefined) {
    const decoded = decodeXml(raw);
    if (type === 's') value = sharedStrings[Number(decoded)] ?? null;
    else if (type === 'b') value = decoded === '1';
    else if (type === 'str' || type === 'e') value = decoded;
    else value = decoded === '' ? null : Number(decoded);
  }
  return { value, formula: formula ? decodeXml(formula) : null, error: type === 'e' };
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const cells = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    const rowCells = [];
    let implicitColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const cellXml = cellMatch[0];
      const openTag = cellXml.match(/^<c\b[^>]*>/)?.[0] || cellXml;
      const reference = attribute(openTag, 'r');
      const index = reference ? columnIndex(reference) : implicitColumn;
      if (index === null) continue;
      const cell = parseCell(cellXml, sharedStrings);
      row[index] = cell.value;
      rowCells[index] = { ...cell, reference };
      implicitColumn = index + 1;
    }
    rows.push(row);
    cells.push(rowCells);
  }
  return { rows, cells };
}

function normalizeTarget(target) {
  const withoutPrefix = target.replace(/^\.\.\//, '').replace(/^\//, '');
  return withoutPrefix.startsWith('xl/') ? withoutPrefix : `xl/${withoutPrefix}`;
}

function parseWorkbook(buffer) {
  let archive;
  try {
    archive = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    throw new TypeError(`Malformed XLSX archive: ${error.message}`, { cause: error });
  }
  const workbookXml = stripTagPrefixes(xmlText(archive['xl/workbook.xml']));
  const relationshipsXml = xmlText(archive['xl/_rels/workbook.xml.rels']);
  if (!workbookXml || !relationshipsXml) {
    throw new TypeError('Unsupported XLSX: workbook metadata is missing');
  }
  const relationships = new Map();
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    relationships.set(attribute(match[0], 'Id'), normalizeTarget(attribute(match[0], 'Target')));
  }
  const sharedStrings = parseSharedStrings(stripTagPrefixes(xmlText(archive['xl/sharedStrings.xml'])));
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)) {
    const name = attribute(match[0], 'name');
    const relationId = attribute(match[0], 'r:id');
    const path = relationships.get(relationId);
    const sheetXml = path && stripTagPrefixes(xmlText(archive[path]));
    if (!name || !sheetXml) continue;
    sheets.push({ name, path, ...parseSheet(sheetXml, sharedStrings) });
  }
  if (sheets.length === 0) throw new TypeError('Unsupported XLSX: no readable worksheets');
  return { sheets };
}

module.exports = {
  columnIndex,
  decodeXml,
  parseWorkbook,
  stripTagPrefixes,
};
