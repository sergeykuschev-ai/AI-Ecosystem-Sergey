(function initializeXlsxExporter(globalObject, factory) {
  'use strict';

  const compression = typeof module !== 'undefined' && module.exports
    ? require('fflate')
    : globalObject?.fflate;
  const publicApi = factory(compression);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }
  if (globalObject) globalObject.PurchasingXlsxExporter = publicApi;
})(typeof window === 'undefined' ? null : window, function buildApi(fflate) {
  'use strict';

  const XLSX_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const SUPPLIER_ORDER_FILE_NAME = 'optimized-supplier-order.xlsx';
  const REMOVED_ITEMS_FILE_NAME = 'optimized-removed-items.xlsx';
  const SUPPLIER_SHEET_NAME = 'Заказ поставщику';
  const REMOVED_SHEET_NAME = 'Исключённые позиции';
  const EXPORTABLE_STATUSES = new Set(['OPTIMIZED', 'UNCHANGED']);

  function escapeXml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  function finiteNumber(value, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${fieldName} must be a finite number.`);
    }
    return value;
  }

  function quantity(value, fieldName) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(
        `${fieldName} must be a non-negative integer.`
      );
    }
    return value;
  }

  function validateOptimizationResult(result) {
    if (
      !result ||
      typeof result !== 'object' ||
      !EXPORTABLE_STATUSES.has(result.status) ||
      !Array.isArray(result.items) ||
      !Array.isArray(result.removedItems)
    ) {
      throw new TypeError(
        'An OPTIMIZED or UNCHANGED optimization result is required.'
      );
    }
  }

  function columnName(index) {
    let value = index + 1;
    let name = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  function textCell(columnIndex, rowNumber, value, styleId = 0) {
    const reference = `${columnName(columnIndex)}${rowNumber}`;
    return `<c r="${reference}" s="${styleId}" t="inlineStr">` +
      `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  function numberCell(columnIndex, rowNumber, value, styleId = 0) {
    const reference = `${columnName(columnIndex)}${rowNumber}`;
    return `<c r="${reference}" s="${styleId}"><v>${
      finiteNumber(value, reference)
    }</v></c>`;
  }

  function headerRow(headers) {
    return `<row r="1" ht="30" customHeight="1">${
      headers.map((header, index) =>
        textCell(index, 1, header, 1)
      ).join('')
    }</row>`;
  }

  function worksheetXml(options) {
    const {
      columnWidths,
      dataRows,
      headers,
      totalRow = null,
    } = options;
    const sheetRows = [headerRow(headers), ...dataRows];
    if (totalRow) sheetRows.push(totalRow);
    const lastRow = 1 + dataRows.length + (totalRow ? 1 : 0);
    const lastColumn = columnName(headers.length - 1);
    const filterLastRow = Math.max(1, 1 + dataRows.length);
    const columns = columnWidths.map((width, index) =>
      `<col min="${index + 1}" max="${index + 1}" ` +
      `width="${width}" customWidth="1"/>`
    ).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet ' +
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" ' +
      'state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      `<cols>${columns}</cols>` +
      `<sheetData>${sheetRows.join('')}</sheetData>` +
      `<autoFilter ref="A1:${lastColumn}${filterLastRow}"/>` +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" ' +
      'header="0.3" footer="0.3"/>' +
      '</worksheet>';
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet ' +
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1">' +
      '<numFmt numFmtId="164" formatCode="#,##0.00 &quot;₽&quot;"/>' +
      '</numFmts>' +
      '<fonts count="3">' +
      '<font><sz val="11"/><name val="Calibri"/><family val="2"/>' +
      '<scheme val="minor"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/>' +
      '<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF102515"/>' +
      '<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF4CAF50"/>' +
      '<bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin">' +
      '<color rgb="FFD9E4DC"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
      '</cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" ' +
      'applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="center" vertical="center" wrapText="1"/>' +
      '</xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" ' +
      'applyNumberFormat="1"><alignment horizontal="right"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" ' +
      'applyFont="1" applyBorder="1"/>' +
      '<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" ' +
      'applyFont="1" applyBorder="1" applyNumberFormat="1">' +
      '<alignment horizontal="right"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1">' +
      '<cellStyle name="Normal" xfId="0" builtinId="0"/>' +
      '</cellStyles><dxfs count="0"/>' +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" ' +
      'defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>';
  }

  function contentTypesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types ' +
      'xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ' +
      'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.' +
      'spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.' +
      'spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.' +
      'spreadsheetml.styles+xml"/>' +
      '</Types>';
  }

  function packageRelationshipsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships ' +
      'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
      'relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }

  function workbookRelationshipsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships ' +
      'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
      'relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
      'relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  function workbookXml(sheetName) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook ' +
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/' +
      'relationships">' +
      '<bookViews><workbookView/></bookViews>' +
      `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" ` +
      'r:id="rId1"/></sheets>' +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      '</workbook>';
  }

  function createWorkbook(sheetName, sheetXml) {
    if (
      !fflate ||
      typeof fflate.zipSync !== 'function' ||
      typeof fflate.strToU8 !== 'function'
    ) {
      throw new TypeError('fflate ZIP support is unavailable.');
    }
    const xml = value => fflate.strToU8(value);
    return fflate.zipSync({
      '[Content_Types].xml': xml(contentTypesXml()),
      '_rels/.rels': xml(packageRelationshipsXml()),
      'xl/workbook.xml': xml(workbookXml(sheetName)),
      'xl/_rels/workbook.xml.rels': xml(workbookRelationshipsXml()),
      'xl/styles.xml': xml(stylesXml()),
      'xl/worksheets/sheet1.xml': xml(sheetXml),
    }, { level: 6 });
  }

  function buildOptimizedSupplierOrderXlsx(result) {
    validateOptimizationResult(result);
    const items = result.items.filter(
      item => item?.optimizedQuantity > 0
    );
    const dataRows = items.map((item, index) => {
      const rowNumber = index + 2;
      return `<row r="${rowNumber}">` +
        textCell(0, rowNumber, item.sku) +
        textCell(1, rowNumber, item.name) +
        numberCell(
          2,
          rowNumber,
          quantity(
            item.optimizedQuantity,
            `items[${index}].optimizedQuantity`
          )
        ) +
        numberCell(
          3,
          rowNumber,
          finiteNumber(item.price, `items[${index}].price`),
          2
        ) +
        numberCell(
          4,
          rowNumber,
          finiteNumber(
            item.optimizedAmount,
            `items[${index}].optimizedAmount`
          ),
          2
        ) +
        '</row>';
    });
    const totalRowNumber = dataRows.length + 2;
    const totalRow = `<row r="${totalRowNumber}">` +
      textCell(0, totalRowNumber, '', 3) +
      textCell(1, totalRowNumber, 'ИТОГО', 3) +
      textCell(2, totalRowNumber, '', 3) +
      textCell(3, totalRowNumber, '', 3) +
      numberCell(
        4,
        totalRowNumber,
        finiteNumber(result.optimizedTotal, 'optimizedTotal'),
        4
      ) +
      '</row>';
    const sheetXml = worksheetXml({
      headers: [
        'Артикул',
        'Наименование',
        'Количество',
        'Цена, ₽',
        'Сумма, ₽',
      ],
      columnWidths: [18, 55, 14, 16, 18],
      dataRows,
      totalRow,
    });
    return createWorkbook(SUPPLIER_SHEET_NAME, sheetXml);
  }

  function buildOptimizedRemovedItemsXlsx(result) {
    validateOptimizationResult(result);
    const dataRows = result.removedItems.map((item, index) => {
      const rowNumber = index + 2;
      return `<row r="${rowNumber}">` +
        textCell(0, rowNumber, item?.sku) +
        textCell(1, rowNumber, item?.name) +
        numberCell(
          2,
          rowNumber,
          quantity(
            item?.originalQuantity,
            `removedItems[${index}].originalQuantity`
          )
        ) +
        numberCell(
          3,
          rowNumber,
          quantity(
            item?.removedQuantity,
            `removedItems[${index}].removedQuantity`
          )
        ) +
        numberCell(
          4,
          rowNumber,
          finiteNumber(
            item?.removedAmount,
            `removedItems[${index}].removedAmount`
          ),
          2
        ) +
        textCell(
          5,
          rowNumber,
          'Исключено при оптимизации бюджета'
        ) +
        '</row>';
    });
    const sheetXml = worksheetXml({
      headers: [
        'Артикул',
        'Наименование',
        'Исходное количество',
        'Убрано из заказа',
        'Сумма сокращения, ₽',
        'Причина исключения',
      ],
      columnWidths: [18, 55, 19, 18, 22, 38],
      dataRows,
    });
    return createWorkbook(REMOVED_SHEET_NAME, sheetXml);
  }

  function createOptimizedXlsxFiles(result) {
    return {
      supplierOrder: {
        name: SUPPLIER_ORDER_FILE_NAME,
        type: XLSX_CONTENT_TYPE,
        content: buildOptimizedSupplierOrderXlsx(result),
      },
      removedItems: {
        name: REMOVED_ITEMS_FILE_NAME,
        type: XLSX_CONTENT_TYPE,
        content: buildOptimizedRemovedItemsXlsx(result),
      },
    };
  }

  return {
    REMOVED_ITEMS_FILE_NAME,
    REMOVED_SHEET_NAME,
    SUPPLIER_ORDER_FILE_NAME,
    SUPPLIER_SHEET_NAME,
    XLSX_CONTENT_TYPE,
    buildOptimizedRemovedItemsXlsx,
    buildOptimizedSupplierOrderXlsx,
    createOptimizedXlsxFiles,
    escapeXml,
  };
});
