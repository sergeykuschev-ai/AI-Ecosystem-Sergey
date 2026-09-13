'use strict';

/**
 * Human-readable HTML owner-review report (read-only presentation layer).
 *
 * Renders the finished review_triage report and owner_review_compaction
 * into a single self-contained HTML page that Sergey can open locally in a
 * browser. This module NEVER recalculates anything: all numbers come from
 * the triage/compaction artifacts, the canonical matrix is only read for
 * display, and unknown values render as "нет данных" — never as 0.
 *
 * No business logic lives here: no approval buttons, no forms, no network
 * calls, no external scripts or styles. Native <details> provides
 * collapsible sections, so the page works with JavaScript disabled.
 */

const REPORT_VERSION = 'owner-review-report-v1';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function display(value, fallback = 'нет данных') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function formatDays(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return String(Math.round(value));
}

function formatMoney(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${value.toLocaleString('ru-RU')} ₽`;
}

/** Unknown numeric values render explicitly, never as 0. */
function cell(value, format = formatNumber) {
  const formatted = format(value);
  return formatted === null
    ? '<span class="unknown">нет данных</span>'
    : escapeHtml(formatted);
}

// ---------------------------------------------------------------------------
// Evidence helpers (read-only key=value lines produced by review_triage).
// ---------------------------------------------------------------------------

function parseTriageEvidence(evidence) {
  const parsed = { freeStock: null, pendingQuantity: null, unitPrice: null };
  for (const raw of asArray(evidence)) {
    if (typeof raw !== 'string') continue;
    if (raw.startsWith('free_stock=')) {
      const value = raw.slice('free_stock='.length);
      parsed.freeStock = value === 'unknown' ? null : Number(value);
    } else if (raw.startsWith('pending_quantity=')) {
      const value = raw.slice('pending_quantity='.length);
      parsed.pendingQuantity = value === 'unknown' ? null : Number(value);
    } else if (raw.startsWith('unit_price=')) {
      parsed.unitPrice = Number(raw.slice('unit_price='.length));
    }
  }
  for (const key of Object.keys(parsed)) {
    if (!Number.isFinite(parsed[key])) parsed[key] = null;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Detail lookups (exact row_identity / supplier_sku only; no fuzzy matching).
// ---------------------------------------------------------------------------

function buildDetailsIndex(manualReview) {
  const byIdentity = new Map();
  const byArticle = new Map();
  for (const item of asArray(manualReview?.items)) {
    if (!item || typeof item !== 'object') continue;
    if (item.rowIdentity && !byIdentity.has(item.rowIdentity)) {
      byIdentity.set(item.rowIdentity, item);
    }
    if (item.article && !byArticle.has(item.article)) {
      byArticle.set(item.article, item);
    }
  }
  return { byIdentity, byArticle };
}

function detailFor(triageItem, detailsIndex) {
  const byIdentity = detailsIndex.byIdentity.get(triageItem?.row_identity);
  if (byIdentity) return byIdentity;
  const article = triageItem?.supplier_sku;
  return article ? detailsIndex.byArticle.get(article) || null : null;
}

function canonicalByArticle(canonicalMatrix) {
  const items = Array.isArray(canonicalMatrix)
    ? canonicalMatrix
    : asArray(canonicalMatrix?.items);
  const map = new Map();
  for (const item of items) {
    const article = item?.supplier_sku ? String(item.supplier_sku) : null;
    if (article && !map.has(article)) map.set(article, item);
  }
  return map;
}

function triageItemByIdentity(triage) {
  const map = new Map();
  for (const item of asArray(triage?.items)) {
    const key = item?.row_identity || item?.supplier_sku;
    if (key && !map.has(key)) map.set(String(key), item);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Styles (internal working report; no corporate branding).
// ---------------------------------------------------------------------------

const STYLES = `
:root {
  --ready: #1a7f37; --ready-bg: #e7f6ec;
  --data: #9a6700; --data-bg: #fff4e0;
  --package: #0a5fb4; --package-bg: #e8f1fb;
  --individual: #6b3fb3; --individual-bg: #f1ebfb;
  --ink: #1f2733; --muted: #5c6b7a; --line: #d8dfe6; --bg: #f6f8fa;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  color: var(--ink); background: var(--bg); line-height: 1.45; }
.page { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 0; }
h3 { font-size: 1rem; margin: 0; }
.meta { color: var(--muted); font-size: .9rem; margin-bottom: 1rem; }
.meta code { background: #eceff3; padding: .1rem .35rem; border-radius: .25rem; }
.headline { background: linear-gradient(135deg, #123a6d, #0a5fb4); color: #fff;
  border-radius: .6rem; padding: 1.1rem 1.25rem; margin: 1rem 0 1.25rem; }
.headline .big { font-size: 2rem; font-weight: 700; display: block; }
.headline .sub { opacity: .9; font-size: .95rem; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: .6rem; margin: 1rem 0 1.25rem; }
.tile { border: 1px solid var(--line); border-radius: .5rem; background: #fff;
  padding: .65rem .8rem; }
.tile .n { font-size: 1.35rem; font-weight: 700; display: block; }
.tile .l { color: var(--muted); font-size: .8rem; }
.tile.ready .n { color: var(--ready); } .tile.data .n { color: var(--data); }
.tile.package .n { color: var(--package); } .tile.individual .n { color: var(--individual); }
nav.toc { display: flex; flex-wrap: wrap; gap: .5rem; margin: 0 0 1.5rem; }
nav.toc a { font-size: .88rem; text-decoration: none; padding: .35rem .8rem;
  border-radius: 999px; border: 1px solid var(--line); background: #fff; color: var(--ink); }
.badge { display: inline-block; font-size: .75rem; font-weight: 600;
  padding: .15rem .55rem; border-radius: 999px; margin-right: .35rem; }
.badge.ready { background: var(--ready-bg); color: var(--ready); }
.badge.data { background: var(--data-bg); color: var(--data); }
.badge.package { background: var(--package-bg); color: var(--package); }
.badge.individual { background: var(--individual-bg); color: var(--individual); }
section.block { margin: 1.5rem 0; }
details { border: 1px solid var(--line); border-radius: .5rem; background: #fff;
  margin: .6rem 0; overflow: hidden; }
details > summary { cursor: pointer; padding: .7rem .9rem; font-weight: 600;
  list-style: none; display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; }
details > summary::before { content: "▸"; color: var(--muted); }
details[open] > summary::before { content: "▾"; }
details.package > summary { background: var(--package-bg); }
details.individual > summary { background: var(--individual-bg); }
details.data > summary { background: var(--data-bg); }
details.ready > summary { background: var(--ready-bg); }
.body { padding: .8rem .9rem; border-top: 1px solid var(--line); }
table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--line);
  vertical-align: top; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.table-wrap { overflow-x: auto; }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: .4rem .9rem; font-size: .87rem; margin: .4rem 0 .6rem; }
.fields dt { color: var(--muted); font-size: .78rem; margin: 0; }
.fields dd { margin: 0; font-weight: 500; }
dl.fields { margin: 0; }
ul.evidence { margin: .4rem 0 0; padding-left: 1.1rem; font-size: .82rem;
  color: var(--muted); }
.unknown { color: var(--muted); font-style: italic; }
.q { font-size: .9rem; margin: .15rem 0 .5rem; }
.note { color: var(--muted); font-size: .85rem; }
footer { margin-top: 2.5rem; color: var(--muted); font-size: .8rem; }
`;

// ---------------------------------------------------------------------------
// Section renderers.
// ---------------------------------------------------------------------------

function renderProductRow(triageItem, detailsIndex, canonicalMap) {
  const detail = triageItem ? detailFor(triageItem, detailsIndex) : null;
  const evidence = triageItem ? parseTriageEvidence(triageItem.evidence) : { freeStock: null, pendingQuantity: null, unitPrice: null };
  const article = triageItem?.supplier_sku ?? detail?.article ?? null;
  const canonical = article ? canonicalMap.get(String(article)) : null;
  const stock = evidence.freeStock ?? (typeof detail?.evidence?.free_stock === 'number' ? detail.evidence.free_stock : null);
  const recommendedQty = detail?.rollout_recommended_quantity ?? evidence.pendingQuantity;
  const supplierRecommendedQty =
    typeof detail?.evidence?.supplier_recommended_qty === 'number'
      ? detail.evidence.supplier_recommended_qty
      : null;
  const avgSales = typeof detail?.evidence?.average_weekly_sales === 'number'
    ? detail.evidence.average_weekly_sales
    : null;
  const projectedDays = typeof detail?.evidence?.projected_days_of_stock === 'number'
    ? detail.evidence.projected_days_of_stock
    : null;
  return `<tr>
<td><strong>${escapeHtml(display(article, '—'))}</strong>${triageItem?.sku_id ? `<br><span class="note">sku_id: ${escapeHtml(triageItem.sku_id)}</span>` : ''}</td>
<td>${escapeHtml(display(triageItem?.name ?? detail?.name))}</td>
<td>${escapeHtml(display(triageItem?.supplier ?? detail?.supplier))}</td>
<td>${cell(stock)}</td>
<td>${cell(canonical?.min_stock)}/${cell(canonical?.target_stock)}/${cell(canonical?.max_stock)}</td>
<td>${cell(detail?.suggested_minimum_shelf_stock)}/${cell(detail?.suggested_target_stock)}/${cell(detail?.suggested_maximum_stock)}</td>
<td>${cell(avgSales)}</td>
<td>${cell(projectedDays, formatDays)}</td>
<td>${cell(recommendedQty)}</td>
<td>${cell(supplierRecommendedQty)}</td>
<td>${cell(evidence.unitPrice, formatMoney)}</td>
</tr>`;
}

const PRODUCT_TABLE_HEAD = `<div class="table-wrap"><table>
<thead><tr>
<th>Артикул</th><th>Товар</th><th>Поставщик</th><th>Остаток</th>
<th>Min/Target/Max (canonical)</th><th>Min/Target/Max (расчёт)</th>
<th>Продажи/нед</th><th>Покрытие, дн</th><th>Заказ (расчёт)</th>
<th>Реком. поставщика</th><th>Цена</th>
</tr></thead><tbody>`;

function renderPackageCard(pkg, triageByKey, detailsIndex, canonicalMap) {
  const rows = pkg.row_identities
    .map(identity => triageByKey.get(String(identity)) || null)
    .map(triageItem => renderProductRow(triageItem, detailsIndex, canonicalMap))
    .join('\n');
  return `<details class="package">
<summary><span class="badge package">пакет</span> ${escapeHtml(pkg.package_id)} — ${escapeHtml(pkg.decision_type)} — ${pkg.count} SKU</summary>
<div class="body">
<p class="q"><strong>Вопрос:</strong> ${escapeHtml(pkg.business_question)}</p>
<p class="note"><strong>Почему объединены:</strong> ${escapeHtml(pkg.evidence_summary)}</p>
<p class="note"><strong>Рекомендация:</strong> ${escapeHtml(pkg.recommended_action)}</p>
<p class="note"><strong>Варианты:</strong> ${pkg.decision_options.map(escapeHtml).join(' · ')}</p>
${PRODUCT_TABLE_HEAD}
${rows}
</tbody></table></div>
</details>`;
}

function renderIndividualCard(individual, triageByKey, detailsIndex, canonicalMap) {
  const triageItem = triageByKey.get(String(individual.row_identity)) || null;
  const detail = triageItem ? detailFor(triageItem, detailsIndex) : null;
  const evidence = triageItem ? parseTriageEvidence(triageItem.evidence) : { freeStock: null, pendingQuantity: null, unitPrice: null };
  const canonical = individual.article ? canonicalMap.get(String(individual.article)) : null;
  const stock = evidence.freeStock ?? (typeof detail?.evidence?.free_stock === 'number' ? detail.evidence.free_stock : null);
  const recommendedQty = detail?.rollout_recommended_quantity ?? evidence.pendingQuantity;
  const supplierRecommendedQty =
    typeof detail?.evidence?.supplier_recommended_qty === 'number'
      ? detail.evidence.supplier_recommended_qty
      : null;
  const avgSales = typeof detail?.evidence?.average_weekly_sales === 'number'
    ? detail.evidence.average_weekly_sales
    : null;
  const projectedDays = typeof detail?.evidence?.projected_days_of_stock === 'number'
    ? detail.evidence.projected_days_of_stock
    : null;
  const stockDays = typeof detail?.evidence?.stock_days === 'number'
    ? detail.evidence.stock_days
    : null;
  const canonicalValues = canonical
    ? `${display(canonical.min_stock, '—')}/${display(canonical.target_stock, '—')}/${display(canonical.max_stock, '—')}`
    : 'нет данных';
  const provenanceLine = triageItem
    ? asArray(triageItem.evidence).find(line => typeof line === 'string' && line.startsWith('policy_provenance='))
    : null;
  return `<details class="individual">
<summary><span class="badge individual">индивидуально</span> ${escapeHtml(individual.article || '—')} — ${escapeHtml(individual.name || '')} <span class="note">[${individual.owner_signals.map(escapeHtml).join(', ')}]</span></summary>
<div class="body">
<dl class="fields">
<div><dt>Артикул</dt><dd>${escapeHtml(display(individual.article))}</dd></div>
<div><dt>sku_id</dt><dd>${escapeHtml(display(individual.sku_id))}</dd></div>
<div><dt>Поставщик</dt><dd>${escapeHtml(display(individual.supplier))}</dd></div>
<div><dt>Остаток</dt><dd>${cell(stock)}</dd></div>
<div><dt>Min/Target/Max (canonical)</dt><dd>${escapeHtml(canonicalValues)}</dd></div>
<div><dt>Min/Target/Max (расчёт)</dt><dd>${cell(detail?.suggested_minimum_shelf_stock)}/${cell(detail?.suggested_target_stock)}/${cell(detail?.suggested_maximum_stock)}</dd></div>
<div><dt>Продажи в неделю</dt><dd>${cell(avgSales)}</dd></div>
<div><dt>Покрытие склада, дн</dt><dd>${cell(stockDays, formatDays)}</dd></div>
<div><dt>Проекция покрытия, дн</dt><dd>${cell(projectedDays, formatDays)}</dd></div>
<div><dt>Заказ по расчёту</dt><dd>${cell(recommendedQty)}</dd></div>
<div><dt>Рекомендация поставщика</dt><dd>${cell(supplierRecommendedQty)}</dd></div>
<div><dt>Приоритет review</dt><dd>${escapeHtml(display(triageItem?.evidence?.find?.((l) => typeof l === 'string' && l.startsWith('owner_review_priority='))?.split('=')[1]))}</dd></div>
</dl>
${provenanceLine ? `<p class="note"><strong>Provenance политики:</strong> ${escapeHtml(provenanceLine.slice('policy_provenance='.length))}</p>` : ''}
<p class="q"><strong>Вопрос:</strong> ${escapeHtml(individual.business_question)}</p>
<p class="note"><strong>Рекомендация:</strong> ${escapeHtml(display(individual.recommended_action))}</p>
<ul class="evidence">${individual.evidence.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
</div>
</details>`;
}

function linkageGroupLabel(reason) {
  const labels = {
    article: 'Нет артикула / идентификатора',
    exit: 'EXIT без подтверждённого canonical EXIT',
    identity: 'Дубль / неоднозначная идентификация',
  };
  return labels[reason] || 'Прочие проблемы связи';
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {object} input.triage - triageReviewQueue result.
 * @param {object} input.compaction - owner_review_compaction result.
 * @param {Array|{items: Array}} [input.canonicalMatrix] - read-only display.
 * @param {object} [input.manualReview] - run manual-review.json (optional,
 *   keyed by rowIdentity/article for card details; absent fields render as
 *   "нет данных").
 * @returns {string} self-contained HTML document.
 */
function renderOwnerReviewHtml({ triage, compaction, canonicalMatrix, manualReview }) {
  if (!triage || typeof triage !== 'object') {
    throw new TypeError('renderOwnerReviewHtml requires a triage report.');
  }
  if (!compaction || typeof compaction !== 'object') {
    throw new TypeError('renderOwnerReviewHtml requires an owner_review_compaction result.');
  }
  const detailsIndex = buildDetailsIndex(manualReview);
  const canonicalMap = canonicalByArticle(canonicalMatrix);
  const triageByKey = triageItemByIdentity(triage);

  const comparison = triage.comparison || {};
  const readyItems = asArray(triage.sections?.ready?.items);
  const dataProblemItems = asArray(triage.sections?.data_problems?.items);
  const matrixGapItems = asArray(triage.sections?.matrix_gaps?.items);

  // Data/linkage inside the owner queue (compaction exclusions), grouped by reason.
  const linkageGroups = new Map();
  for (const exclusion of asArray(compaction.exclusions)) {
    const label = linkageGroupLabel(exclusion.linkage_reason);
    if (!linkageGroups.has(label)) linkageGroups.set(label, []);
    linkageGroups.get(label).push(exclusion);
  }

  const readyRows = readyItems
    .map(item => `<tr><td>${escapeHtml(display(item.supplier_sku))}</td><td>${escapeHtml(display(item.name))}</td><td>${escapeHtml(display(item.reason))}</td></tr>`)
    .join('\n');

  const groupEntries = Object.entries(compaction.groups || {}).filter(([, count]) => count > 0);

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Закупщик «Миски» — разбор закупки ${escapeHtml(compaction.source_run_id || '')}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
<header>
<h1>Закупщик «Миски» — разбор закупки</h1>
<p class="meta">Run: <code>${escapeHtml(display(compaction.source_run_id))}</code> · расчёт: ${escapeHtml(display(triage.calculation_version))} · отчёт сформирован из read-only triage + compaction (${escapeHtml(compaction.compactor_version || '')})</p>
</header>

<div class="headline">
<span class="big">Нужно принять ${compaction.total_owner_decision_count} решения</span>
<span class="sub">${compaction.business_sku_count} бизнес-позиций → ${compaction.package_decision_count} пакетных + ${compaction.individual_decision_count} индивидуальных · ${compaction.data_or_linkage_count} проблем данных (не решения владельца)</span>
</div>

<div class="tiles">
<div class="tile ready"><span class="n">${comparison.ready ?? 0}</span><span class="l">готово без решения владельца</span></div>
<div class="tile data"><span class="n">${(comparison.data_problems ?? 0) + (comparison.matrix_gaps ?? 0)}</span><span class="l">проблемы данных / связи (все разделы)</span></div>
<div class="tile package"><span class="n">${compaction.package_decision_count}</span><span class="l">пакетных решений (${compaction.package_sku_count} SKU)</span></div>
<div class="tile individual"><span class="n">${compaction.individual_decision_count}</span><span class="l">индивидуальных решений</span></div>
<div class="tile"><span class="n">${compaction.total_owner_decision_count}</span><span class="l">всего решений Сергея</span></div>
</div>

<nav class="toc">
<a href="#ready">Готово (${comparison.ready ?? 0})</a>
<a href="#data-problems">Проблемы данных / связи</a>
<a href="#packages">Пакетные решения (${compaction.package_decision_count})</a>
<a href="#individuals">Индивидуальные решения (${compaction.individual_decision_count})</a>
</nav>

<section class="block" id="ready">
<h2><span class="badge ready">готово</span> Готово без решения владельца — ${comparison.ready ?? 0}</h2>
<details class="ready"><summary>Показать список (${readyItems.length})</summary>
<div class="body table-wrap"><table>
<thead><tr><th>Артикул</th><th>Товар</th><th>Причина готовности</th></tr></thead>
<tbody>
${readyRows || '<tr><td colspan="3" class="unknown">Нет позиций.</td></tr>'}
</tbody></table></div></details>
</section>

<section class="block" id="data-problems">
<h2><span class="badge data">данные</span> Проблемы данных / связи — не решения владельца</h2>
<p class="note">В очереди владельца: ${compaction.data_or_linkage_count} позиций исключены из решений (исправляются данными, а не бизнес-выбором).</p>
${Array.from(linkageGroups.entries()).map(([label, entries]) => `<details class="data"><summary>${escapeHtml(label)} — ${entries.length}</summary>
<div class="body table-wrap"><table>
<thead><tr><th>Артикул</th><th>Товар</th><th>Причина</th></tr></thead>
<tbody>
${entries.map(entry => `<tr><td>${escapeHtml(display(entry.article))}</td><td>${escapeHtml(display(entry.name))}</td><td>${escapeHtml(entry.linkage_reason_label || label)}</td></tr>`).join('\n')}
</tbody></table></div></details>`).join('\n')}
<details class="data"><summary>Прочие проблемы данных из разбора — ${dataProblemItems.length} · разрывы связи с матрицей — ${matrixGapItems.length}</summary>
<div class="body table-wrap"><table>
<thead><tr><th>Артикул</th><th>Товар</th><th>Причина</th></tr></thead>
<tbody>
${[...dataProblemItems, ...matrixGapItems].map(item => `<tr><td>${escapeHtml(display(item.supplier_sku))}</td><td>${escapeHtml(display(item.name))}</td><td>${escapeHtml(display(item.reason))}</td></tr>`).join('\n') || '<tr><td colspan="3" class="unknown">Нет позиций.</td></tr>'}
</tbody></table></div></details>
</section>

<section class="block" id="packages">
<h2><span class="badge package">пакеты</span> Пакетные решения — ${compaction.package_decision_count}</h2>
${asArray(compaction.packages).map(pkg => renderPackageCard(pkg, triageByKey, detailsIndex, canonicalMap)).join('\n') || '<p class="note">Нет пакетных решений.</p>'}
</section>

<section class="block" id="individuals">
<h2><span class="badge individual">индивидуально</span> Индивидуальные решения — ${compaction.individual_decision_count}</h2>
${groupEntries.length > 0 ? `<p class="note">Группы сигналов: ${groupEntries.map(([group, count]) => `${escapeHtml(group)} ${count}`).join(' · ')}</p>` : ''}
${asArray(compaction.individuals).map(individual => renderIndividualCard(individual, triageByKey, detailsIndex, canonicalMap)).join('\n') || '<p class="note">Нет индивидуальных решений.</p>'}
</section>

<footer>Read-only отчёт (${escapeHtml(REPORT_VERSION)}). Решения здесь не применяются: canonical, Min/Max, количества заказа и 1С не изменяются. Источник: review_triage + owner_review_compaction текущего run.</footer>
</div>
</body>
</html>
`;
  return html;
}

module.exports = {
  REPORT_VERSION,
  renderOwnerReviewHtml,
  escapeHtml,
};
