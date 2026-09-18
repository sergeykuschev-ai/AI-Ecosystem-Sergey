'use strict';

/**
 * Owner-review compaction (read-only, deterministic).
 *
 * Turns the review_triage owner queue into a compact decision list for the
 * owner: business SKU -> package decisions + individual decisions ->
 * total owner decisions. This module NEVER recalculates Min/Max, order
 * quantities, canonical values or reason codes, and it never invents data.
 * It only groups positions that review_triage has already confirmed as
 * genuine owner business decisions.
 *
 * Data/linkage positions (unknown stock, identity problems, missing
 * supplier data, duplicates, unconfirmed EXIT, canonical unmatched) are
 * excluded by an explicit deterministic invariant and never become owner
 * decisions. Positions whose owner decision is BLOCKED_BY_DATA (data/linkage
 * defect or missing calculated quantity, per review_triage) keep their
 * signals but are reported separately and never enter packages/individuals.
 * Grouping is signal-combination based plus fixed business package rules;
 * there is deliberately no fuzzy/name matching.
 *
 * No LLM, no timestamps, no randomness: identical input -> identical output.
 */

const crypto = require('node:crypto');

const COMPACTOR_VERSION = 'owner-review-compactor-v2';

// Signal-combination groups. Every business position lands in exactly one.
const SIGNAL_GROUPS = Object.freeze({
  POLICY_ONLY: 'POLICY_ONLY',
  POLICY_PLUS_COMMERCIAL: 'POLICY_PLUS_COMMERCIAL',
  POLICY_PLUS_LARGE: 'POLICY_PLUS_LARGE',
  POLICY_PLUS_COMMERCIAL_PLUS_LARGE: 'POLICY_PLUS_COMMERCIAL_PLUS_LARGE',
  COMMERCIAL_ONLY: 'COMMERCIAL_ONLY',
  COMMERCIAL_PLUS_LARGE: 'COMMERCIAL_PLUS_LARGE',
  LARGE_ONLY: 'LARGE_ONLY',
  OTHER_OWNER_DECISION: 'OTHER_OWNER_DECISION',
});

const LINKAGE_REASONS = Object.freeze({
  ARTICLE: 'article',
  EXIT: 'exit',
  IDENTITY: 'identity',
});

const LINKAGE_REASON_LABELS_RU = Object.freeze({
  [LINKAGE_REASONS.ARTICLE]: 'нет артикула / стабильного идентификатора',
  [LINKAGE_REASONS.EXIT]: 'EXIT без подтверждённого canonical EXIT',
  [LINKAGE_REASONS.IDENTITY]: 'дубль / неоднозначная идентификация',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function display(value, fallback = null) {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shortHash(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Evidence parsing (read-only, key=value lines produced by review_triage).
// ---------------------------------------------------------------------------

function parseEvidence(evidence) {
  const parsed = {
    freeStock: null,
    projectedDays: null,
    avgWeeklySales: null,
    supplierRecommendsOrder: false,
  };
  for (const raw of asArray(evidence)) {
    if (typeof raw !== 'string') continue;
    if (raw.startsWith('free_stock=')) {
      const value = raw.slice('free_stock='.length);
      parsed.freeStock = value === 'unknown' ? null : finiteNumber(Number(value));
    } else if (raw.startsWith('projected_days=')) {
      parsed.projectedDays = finiteNumber(Number(raw.slice('projected_days='.length)));
    } else if (raw.startsWith('large_inventory_days=')) {
      const value = finiteNumber(Number(raw.slice('large_inventory_days='.length)));
      if (value !== null) parsed.projectedDays = value;
    } else if (raw.startsWith('avg_weekly_sales=')) {
      parsed.avgWeeklySales = finiteNumber(Number(raw.slice('avg_weekly_sales='.length)));
    } else if (raw.startsWith('reason_codes=')) {
      const codes = raw.slice('reason_codes='.length).replace(/^\[|\]$/g, '');
      parsed.supplierRecommendsOrder =
        codes.split(',').map(code => code.trim()).includes('supplier_recommends_order');
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Canonical lookup (exact supplier_sku only; fuzzy matching is forbidden).
// ---------------------------------------------------------------------------

function canonicalItemsByArticle(canonicalMatrix) {
  const items = Array.isArray(canonicalMatrix)
    ? canonicalMatrix
    : asArray(canonicalMatrix?.items);
  const byArticle = new Map();
  for (const item of items) {
    const article = display(item?.supplier_sku);
    if (article && !byArticle.has(article)) byArticle.set(article, item);
  }
  return byArticle;
}

// ---------------------------------------------------------------------------
// Business vs DATA_OR_LINKAGE (explicit deterministic invariant).
// ---------------------------------------------------------------------------

/**
 * A position is a data/linkage problem (never an owner decision) when:
 *   - supplier_sku/article is absent or 'UNKNOWN';
 *   - it carries an exit_candidate signal without a confirmed canonical
 *     EXIT assortment_status;
 *   - it carries duplicate_* evidence or the DATA_ERROR_IDENTITY reason.
 */
function classifyOwnerItem(item, canonicalByArticle) {
  const article = display(item?.supplier_sku);
  if (!article || article === 'UNKNOWN') {
    return { group: 'data_or_linkage', linkageReason: LINKAGE_REASONS.ARTICLE };
  }
  const signals = asArray(item?.owner_signals);
  if (signals.includes('exit_candidate')) {
    const canonical = canonicalByArticle.get(article);
    if (canonical?.assortment_status !== 'EXIT') {
      return { group: 'data_or_linkage', linkageReason: LINKAGE_REASONS.EXIT };
    }
  }
  const evidence = asArray(item?.evidence);
  if (evidence.some(line => typeof line === 'string' && line.startsWith('duplicate_')) ||
      item?.reason_code === 'DATA_ERROR_IDENTITY') {
    return { group: 'data_or_linkage', linkageReason: LINKAGE_REASONS.IDENTITY };
  }
  return { group: 'business', linkageReason: null };
}

// ---------------------------------------------------------------------------
// Signal-combination grouping (mutually exclusive, no double counting).
// ---------------------------------------------------------------------------

function signalGroupFor(signals) {
  const hasPolicy = signals.includes('approved_policy_conflict');
  const hasCommercial = signals.includes('commercial_review');
  const hasLarge = signals.includes('large_inventory_review');
  if (hasPolicy && hasCommercial && hasLarge) return SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL_PLUS_LARGE;
  if (hasPolicy && hasCommercial) return SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL;
  if (hasPolicy && hasLarge) return SIGNAL_GROUPS.POLICY_PLUS_LARGE;
  if (hasPolicy) return SIGNAL_GROUPS.POLICY_ONLY;
  if (hasCommercial && hasLarge) return SIGNAL_GROUPS.COMMERCIAL_PLUS_LARGE;
  if (hasCommercial) return SIGNAL_GROUPS.COMMERCIAL_ONLY;
  if (hasLarge) return SIGNAL_GROUPS.LARGE_ONLY;
  return SIGNAL_GROUPS.OTHER_OWNER_DECISION;
}

// ---------------------------------------------------------------------------
// Package rules. A position joins a package only when the FULL business
// condition holds; a shared reason_code alone is never sufficient.
// Numeric conditions on missing evidence fields stay undecided (fail-safe
// towards the package only where the business rule tolerates it, otherwise
// the position stays individual).
// ---------------------------------------------------------------------------

const PACKAGE_DEFINITIONS = Object.freeze([
  {
    id: 'PKG1',
    decision_type: 'POLICY_CONFIRM_UNVERIFIED',
    business_question:
      'Подтвердить ли действующие canonical Min/Max (provenance не подтверждена реестром) как решение владельца, или принять свежий 12-недельный расчёт?',
    decision_options: [
      'Подтвердить действующие Min/Max как owner policy (после подтверждения provenance повторные вопросы прекратятся)',
      'Принять свежий расчёт Min/Max',
    ],
    recommended_action:
      'Владелец подтверждает или заменяет действующую canonical-политику SKU; автоматическое применение запрещено.',
  },
  {
    id: 'PKG2',
    decision_type: 'COMMERCIAL_ACCEPT_CALC',
    business_question:
      'Заказать по расчёту агента, а не по рекомендации поставщика (везде дефицит, умеренные продажи, покрытие без экстремальной проекции)?',
    decision_options: [
      'Пакетно принять расчёт агента',
      'Принять рекомендацию поставщика',
      'Не заказывать',
    ],
    recommended_action:
      'Владелец выбирает основу заказа (расчёт / рекомендация поставщика / отказ) для всего пакета; применение вне пакета запрещено.',
  },
  {
    id: 'PKG3',
    decision_type: 'POLICY_LARGE_VERIFIED_ORDER',
    business_question:
      'Заказывать ли при подтверждённой owner-политике (provenance в реестре), если проектируемое покрытие склада большое?',
    decision_options: [
      'Заказать по утверждённой политике несмотря на покрытие',
      'Отложить заказ',
    ],
    recommended_action:
      'Владелец решает, действует ли подтверждённая политика при большом покрытии; автозаказ не выполняется.',
  },
  {
    id: 'PKG4',
    decision_type: 'POLICY_COMMERCIAL_VERIFIED',
    business_question:
      'Применить подтверждённую owner-политику (provenance в реестре) и заказать по расчёту при рекомендации поставщика?',
    decision_options: [
      'Да, применить подтверждённую политику и заказать по расчёту',
      'Нет, пересмотреть политику или основу заказа',
    ],
    recommended_action:
      'Владелец подтверждает согласованный расчёт и политику; изменение Min/Max напрямую запрещено.',
  },
]);

function packageIdForItem(item, canonicalByArticle, parsed, verifiedSessionIds) {
  const signals = asArray(item?.owner_signals);
  const key = signals.join(',');
  const article = display(item?.supplier_sku);
  const canonical = article ? canonicalByArticle.get(article) : null;

  if (key === 'approved_policy_conflict') {
    // Verified provenance must have auto-resolved the conflict upstream; if
    // it did not, stay conservative and keep the position individual.
    const changedBy = display(canonical?.rule_changed_by);
    if (changedBy && verifiedSessionIds.has(changedBy)) return null;
    return 'PKG1';
  }
  if (key === 'commercial_review') {
    if (!parsed.supplierRecommendsOrder) return null;
    if (parsed.projectedDays !== null && parsed.projectedDays > 120) return null;
    if (parsed.avgWeeklySales !== null && parsed.avgWeeklySales > 2) return null;
    return 'PKG2';
  }
  if (key === 'approved_policy_conflict,large_inventory_review') {
    const changedBy = display(canonical?.rule_changed_by);
    if (!changedBy || !verifiedSessionIds.has(changedBy)) return null;
    if (parsed.freeStock === null || parsed.freeStock >= 9) return null;
    return 'PKG3';
  }
  if (key === 'approved_policy_conflict,commercial_review') {
    const changedBy = display(canonical?.rule_changed_by);
    if (!changedBy || !verifiedSessionIds.has(changedBy)) return null;
    const hasFullPolicy =
      canonical?.min_stock != null &&
      canonical?.target_stock != null &&
      canonical?.max_stock != null;
    if (!hasFullPolicy) return null;
    if (!parsed.supplierRecommendsOrder) return null;
    return 'PKG4';
  }
  return null;
}

function businessQuestionForIndividual(signalGroup) {
  const questions = {
    [SIGNAL_GROUPS.POLICY_ONLY]:
      'Подтвердить действующую canonical-политику или принять свежий расчёт?',
    [SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL]:
      'Конфликт политики и рекомендации поставщика: по чему заказывать и действует ли политика?',
    [SIGNAL_GROUPS.POLICY_PLUS_LARGE]:
      'Конфликт политики и большого покрытия: заказывать ли по утверждённой политике?',
    [SIGNAL_GROUPS.POLICY_PLUS_COMMERCIAL_PLUS_LARGE]:
      'Тройной конфликт (политика + поставщик + большой запас): разобрать поштучно.',
    [SIGNAL_GROUPS.COMMERCIAL_ONLY]:
      'Расчёт или рекомендация поставщика: по чему заказывать?',
    [SIGNAL_GROUPS.COMMERCIAL_PLUS_LARGE]:
      'Заказывать ли рекомендуемое количество при большом проектируемом покрытии?',
    [SIGNAL_GROUPS.LARGE_ONLY]:
      'Заказывать ли при большом покрытии склада?',
    [SIGNAL_GROUPS.OTHER_OWNER_DECISION]:
      'Требуется индивидуальное решение владельца по сигналам позиции.',
  };
  return questions[signalGroup] || questions[SIGNAL_GROUPS.OTHER_OWNER_DECISION];
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

/**
 * Compacts the review_triage owner queue into package + individual decisions.
 *
 * @param {object} triageReport - result of triageReviewQueue (items required).
 * @param {object} [options]
 * @param {Array|{items: Array}} [options.canonicalMatrix] - canonical matrix
 *   items (exact supplier_sku matching only).
 * @param {Array<string>|Set<string>} [options.verifiedOwnerSessionIds] -
 *   owner-review session ids with verified provenance.
 * @returns {object} compaction contract (see README of the module above).
 */
function compactOwnerReview(triageReport, options = {}) {
  if (!triageReport || typeof triageReport !== 'object') {
    throw new TypeError('compactOwnerReview requires a triage report object.');
  }
  const items = asArray(triageReport.items);
  const canonicalByArticle = canonicalItemsByArticle(options.canonicalMatrix);
  const verifiedSessionIds = new Set(
    options.verifiedOwnerSessionIds instanceof Set
      ? options.verifiedOwnerSessionIds
      : asArray(options.verifiedOwnerSessionIds).map(String)
  );

  // Step 1: owner queue only; DATA_OR_LINKAGE excluded via invariant.
  // Only ACTIVE owner decisions are decidable: positions whose triage status
  // is BLOCKED_BY_DATA (or carries no explicit ACTIVE status — legacy or
  // malformed input, fail-safe) are kept in a separate blocked bucket and
  // never grouped into packages/individuals.
  const seenRowIdentities = new Set();
  const business = [];
  const exclusions = [];
  const blocked = [];
  for (const item of items) {
    if (item?.requires_owner_decision !== true) continue;
    if (!item || typeof item !== 'object') continue;
    const identityKey = display(item.row_identity) || display(item.supplier_sku);
    if (identityKey && seenRowIdentities.has(identityKey)) continue;
    if (identityKey) seenRowIdentities.add(identityKey);

    // Structural linkage exclusions come first: a position without an
    // article, with duplicate evidence or an unconfirmed canonical EXIT can
    // never be a business decision regardless of its lifecycle status.
    const classification = classifyOwnerItem(item, canonicalByArticle);
    if (classification.group === 'data_or_linkage') {
      exclusions.push({
        row_identity: display(item.row_identity),
        article: display(item.supplier_sku),
        name: display(item.name),
        linkage_reason: classification.linkageReason,
        linkage_reason_label: LINKAGE_REASON_LABELS_RU[classification.linkageReason],
      });
      continue;
    }

    if (item.owner_decision_status !== 'ACTIVE') {
      blocked.push({
        row_identity: display(item.row_identity),
        article: display(item.supplier_sku),
        name: display(item.name),
        sku_id: display(item.sku_id),
        supplier: display(item.supplier),
        reason_code: display(item.reason_code),
        owner_signals: asArray(item.owner_signals),
        blocker: display(item.owner_decision_blocker) || 'status_not_active',
        recommended_action: display(item.recommended_action),
        note:
          'После исправления данных может потребоваться решение владельца',
      });
      continue;
    }

    business.push(item);
  }

  // Step 2: deterministic grouping; each rowIdentity counted exactly once.
  const groups = Object.fromEntries(Object.values(SIGNAL_GROUPS).map(group => [group, 0]));
  const packageMembers = new Map(PACKAGE_DEFINITIONS.map(def => [def.id, []]));
  const individuals = [];
  for (const item of business) {
    const signals = asArray(item.owner_signals);
    const signalGroup = signalGroupFor(signals);
    groups[signalGroup] += 1;
    const parsed = parseEvidence(item.evidence);
    const packageId = packageIdForItem(item, canonicalByArticle, parsed, verifiedSessionIds);
    if (packageId) {
      packageMembers.get(packageId).push({ item, parsed });
      continue;
    }
    const identity = display(item.row_identity) || display(item.supplier_sku);
    individuals.push({
      decision_id: `dec-${shortHash(identity)}`,
      row_identity: display(item.row_identity),
      article: display(item.supplier_sku),
      sku_id: display(item.sku_id),
      sku_id_source: display(item.sku_id_source),
      name: display(item.name),
      supplier: display(item.supplier),
      owner_signals: signals,
      signal_group: signalGroup,
      business_question: businessQuestionForIndividual(signalGroup),
      evidence: asArray(item.evidence),
      recommended_action: display(item.recommended_action),
    });
  }

  // Step 3: assemble packages (sorted by package_id for order independence).
  // A package must cover at least two positions: a single member carries no
  // decision economy and stays an individual decision.
  const packages = [];
  for (const definition of PACKAGE_DEFINITIONS) {
    let members = packageMembers.get(definition.id);
    if (members.length === 0) continue;
    if (members.length < 2) {
      for (const member of members) {
        const signals = asArray(member.item.owner_signals);
        const signalGroup = signalGroupFor(signals);
        const identity = display(member.item.row_identity) || display(member.item.supplier_sku);
        individuals.push({
          decision_id: `dec-${shortHash(identity)}`,
          row_identity: display(member.item.row_identity),
          article: display(member.item.supplier_sku),
          sku_id: display(member.item.sku_id),
          sku_id_source: display(member.item.sku_id_source),
          name: display(member.item.name),
          supplier: display(member.item.supplier),
          owner_signals: signals,
          signal_group: signalGroup,
          business_question: businessQuestionForIndividual(signalGroup),
          evidence: asArray(member.item.evidence),
          recommended_action: display(member.item.recommended_action),
        });
      }
      members = [];
      continue;
    }
    const sorted = [...members].sort((a, b) => {
      const aKey = display(a.item.supplier_sku) || display(a.item.row_identity);
      const bKey = display(b.item.supplier_sku) || display(b.item.row_identity);
      return aKey.localeCompare(bKey, 'ru');
    });
    const articles = sorted.map(member => display(member.item.supplier_sku)).filter(Boolean);
    const rowIdentities = sorted.map(member => display(member.item.row_identity)).filter(Boolean);
    const skuIds = sorted.map(member => display(member.item.sku_id)).filter(Boolean);
    const projectedDays = sorted
      .map(member => member.parsed.projectedDays)
      .filter(value => value !== null)
      .sort((a, b) => a - b);
    const freeStocks = sorted
      .map(member => member.parsed.freeStock)
      .filter(value => value !== null)
      .sort((a, b) => a - b);
    const evidenceSummaryParts = [`SKU в пакете: ${articles.join(', ')}`];
    if (freeStocks.length > 0) {
      evidenceSummaryParts.push(`остаток: ${freeStocks[0]}–${freeStocks[freeStocks.length - 1]} шт`);
    }
    if (projectedDays.length > 0) {
      evidenceSummaryParts.push(
        `проекция покрытия: ${projectedDays[0]}–${projectedDays[projectedDays.length - 1]} дн`
      );
    }
    packages.push({
      package_id: definition.id,
      decision_type: definition.decision_type,
      business_question: definition.business_question,
      owner_signals: sorted[0] ? asArray(sorted[0].item.owner_signals) : [],
      row_identities: rowIdentities,
      articles,
      sku_ids: skuIds,
      count: sorted.length,
      content_hash: shortHash(rowIdentities.join('|')),
      evidence_summary: evidenceSummaryParts.join('; '),
      recommended_action: definition.recommended_action,
      decision_options: [...definition.decision_options],
    });
  }

  // Deterministic ordering everywhere.
  individuals.sort((a, b) => a.decision_id.localeCompare(b.decision_id));
  exclusions.sort((a, b) => (a.article || a.row_identity || '')
    .localeCompare(b.article || b.row_identity || '', 'ru'));
  blocked.sort((a, b) => (a.article || a.row_identity || '')
    .localeCompare(b.article || b.row_identity || '', 'ru'));

  // Invariant re-check: no excluded or blocked identity inside
  // packages/individuals.
  const excludedKeys = new Set(
    exclusions.map(entry => entry.row_identity || entry.article).filter(Boolean)
  );
  const blockedKeys = new Set(
    blocked.map(entry => entry.row_identity || entry.article).filter(Boolean)
  );
  for (const pkg of packages) {
    for (const identity of pkg.row_identities) {
      if (excludedKeys.has(identity)) {
        throw new Error(`compaction invariant violated: ${identity} is both data_or_linkage and packaged`);
      }
      if (blockedKeys.has(identity)) {
        throw new Error(`compaction invariant violated: ${identity} is both blocked_by_data and packaged`);
      }
    }
  }
  for (const individual of individuals) {
    if (excludedKeys.has(individual.row_identity || individual.article)) {
      throw new Error(`compaction invariant violated: ${individual.row_identity} is both data_or_linkage and individual`);
    }
    if (blockedKeys.has(individual.row_identity || individual.article)) {
      throw new Error(`compaction invariant violated: ${individual.row_identity} is both blocked_by_data and individual`);
    }
  }

  return {
    compactor_version: COMPACTOR_VERSION,
    read_only: true,
    source_run_id: display(triageReport.source_run_id),
    owner_queue_sku_count: business.length + exclusions.length + blocked.length,
    business_sku_count: business.length,
    blocked_by_data_count: blocked.length,
    data_or_linkage_count: exclusions.length,
    package_decision_count: packages.length,
    package_sku_count: packages.reduce((sum, pkg) => sum + pkg.count, 0),
    individual_decision_count: individuals.length,
    total_owner_decision_count: packages.length + individuals.length,
    groups,
    packages,
    individuals,
    exclusions,
    blocked,
  };
}

module.exports = {
  COMPACTOR_VERSION,
  SIGNAL_GROUPS,
  LINKAGE_REASONS,
  classifyOwnerItem,
  signalGroupFor,
  compactOwnerReview,
};
