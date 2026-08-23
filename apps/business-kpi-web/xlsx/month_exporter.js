'use strict';

const { strToU8, zipSync } = require('fflate');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellXml(value, row, column, style = 0) {
  const reference = `${columnName(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${reference}" s="${style}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows, options = {}) {
  const widths = options.widths || [];
  const body = rows.map((row, rowIndex) => {
    const style = rowIndex === 0 ? 1 : 0;
    return `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const moneyColumns = options.moneyColumns || [];
      const customStyle = options.styleFor?.(rowIndex, columnIndex, value) || 0;
      const cellStyle = style || customStyle || (moneyColumns.includes(columnIndex) ? 2 : 0);
      return cellXml(value, rowIndex + 1, columnIndex, cellStyle);
    }).join('')}</row>`;
  }).join('');
  const columns = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join('');
  const lastColumn = columnName(Math.max(0, ...rows.map(row => row.length - 1)));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${rows.length}"/><cols>${columns}</cols>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${body}</sheetData><autoFilter ref="A1:${lastColumn}${rows.length}"/>
</worksheet>`;
}

function exportMonthWorkbook(input) {
  const shiftRows = [[
    'Дата', 'Продавец', 'Источник', 'Наличные', 'Эквайринг', 'QR',
    'Historical revenue', 'Revenue source', 'Выручка backend', 'Чеки',
    'Средний чек backend', 'Продано товаров', 'Товаров/чек backend',
    'Чеки с допродажей', 'Лакомства', 'Чеки с лакомствами', 'KPI',
    'Уровень', 'Комментарий',
  ]];
  for (const shift of input.shifts) {
    shiftRows.push([
      shift.shiftDate,
      shift.employeeName,
      shift.source,
      shift.cash,
      shift.acquiring,
      shift.qr,
      shift.historicalRevenue,
      shift.revenueSource,
      shift.metrics?.revenue ?? null,
      shift.receipts,
      shift.metrics?.averageCheck ?? null,
      shift.itemsSold,
      shift.metrics?.itemsPerReceipt ?? null,
      shift.upsellReceipts,
      shift.treatsRevenue,
      shift.treatsReceipts,
      shift.metrics?.kpiScore ?? null,
      shift.metrics?.kpiLevel ?? null,
      shift.comment,
    ]);
  }
  const month = input.dashboard.month;
  const summaryRows = [
    ['Business KPI — месячный экспорт', `${input.year}-${String(input.month).padStart(2, '0')}`],
    ['Магазин', input.storeName],
    ['Экспортирован UTC', input.exportedAt],
    ['План', month.plan],
    ['Выручка backend', month.revenue],
    ['Чеки', month.receipts],
    ['Средний чек backend', month.averageCheck],
    ['Смены', month.shiftsCount],
    ['Продано товаров', month.itemsSold],
    ['Товаров/чек backend', month.itemsPerReceipt],
    ['Payment breakdown available', month.paymentBreakdownAvailable],
    ['QR share', month.qrShare],
    ['Settings status', input.dashboard.settingsStatus],
  ];
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Shifts" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="# ##0.00 [$₽-419]"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF205C46"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(shiftRows, {
      widths: [12, 22, 18, 14, 14, 12, 18, 20, 18, 10, 18, 17, 18, 18, 14, 19, 12, 16, 36],
      moneyColumns: [3, 4, 5, 6, 8, 10, 14],
    })),
    'xl/worksheets/sheet2.xml': strToU8(sheetXml(summaryRows, {
      widths: [34, 24],
      styleFor: (row, column) => {
        if (column !== 1) return 0;
        if ([3, 4, 6].includes(row)) return 2;
        if (row === 11) return 3;
        return 0;
      },
    })),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

module.exports = { exportMonthWorkbook };
