'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  renderReviewTriage,
  reviewTriageBanner,
  reviewTriageMinMaxText,
  reviewTriageUrl,
} = require('../public/app');

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const appSource = fs.readFileSync(
  path.resolve(__dirname, '../public/app.js'),
  'utf8'
);
const htmlSource = fs.readFileSync(
  path.resolve(__dirname, '../public/index.html'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.resolve(__dirname, '../public/styles.css'),
  'utf8'
);

function fakeElement(tagName = 'div') {
  return {
    tagName,
    children: [],
    hidden: false,
    textContent: '',
    className: '',
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
  };
}

function collectText(element) {
  const parts = [];
  const walk = node => {
    if (node.textContent) parts.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  walk(element);
  return parts.join('\n');
}

function isTechnical(node) {
  return typeof node.className === 'string' &&
    node.className.includes('review-triage-technical');
}

// Текст видимой карточки без технического блока: внутренние коды не должны
// попадать в основной текст владельца.
function collectMainText(element) {
  const parts = [];
  const walk = node => {
    if (isTechnical(node)) return;
    if (node.textContent) parts.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  walk(element);
  return parts.join('\n');
}

function collectTechnicalText(element) {
  const parts = [];
  const walk = node => {
    if (node.textContent) parts.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  const find = node => {
    if (isTechnical(node)) {
      walk(node);
      return;
    }
    for (const child of node.children || []) find(child);
  };
  find(element);
  return parts.join('\n');
}

function collectTags(element, acc = []) {
  acc.push(element.tagName);
  for (const child of element.children || []) collectTags(child, acc);
  return acc;
}

function triageElements() {
  return {
    reviewTriage: fakeElement('details'),
    reviewTriageState: fakeElement('p'),
    reviewTriageContent: fakeElement('div'),
    reviewTriageTotal: fakeElement('strong'),
    reviewTriageSubtitle: fakeElement('span'),
    reviewTriagePackages: fakeElement('div'),
    reviewTriagePackagesEmpty: fakeElement('p'),
    reviewTriageIndividuals: fakeElement('div'),
    reviewTriageIndividualsEmpty: fakeElement('p'),
    reviewTriageBlocked: fakeElement('div'),
    reviewTriageBlockedEmpty: fakeElement('p'),
    reviewTriageBlockedSummary: fakeElement('summary'),
    reviewTriageExclusions: fakeElement('div'),
    reviewTriageExclusionsEmpty: fakeElement('p'),
    reviewTriageExclusionsSummary: fakeElement('summary'),
  };
}

function compactionPayload(overrides = {}) {
  const compaction = {
    compactor_version: 'owner-review-compactor-v2',
    read_only: true,
    source_run_id: RUN_ID,
    owner_queue_sku_count: 63,
    business_sku_count: 60,
    blocked_by_data_count: 2,
    data_or_linkage_count: 7,
    package_decision_count: 4,
    package_sku_count: 20,
    individual_decision_count: 28,
    total_owner_decision_count: 32,
    groups: {},
    packages: [
      {
        package_id: 'PKG1',
        decision_type: 'POLICY_CONFIRM_UNVERIFIED',
        business_question: 'Подтвердить ли действующие Min/Max?',
        owner_signals: ['approved_policy_conflict'],
        row_identities: ['row-1', 'row-2'],
        articles: ['ART-1', 'ART-2'],
        sku_ids: [],
        count: 2,
        content_hash: 'abc',
        evidence_summary: 'SKU в пакете: ART-1, ART-2',
        recommended_action: 'Владелец подтверждает или заменяет политику.',
        decision_options: ['Подтвердить Min/Max', 'Принять свежий расчёт'],
        members: [
          {
            row_identity: 'row-1',
            article: 'ART-1',
            sku_id: 'SKU-1',
            name: 'Корм сухой',
            supplier: 'Зооград',
            free_stock: 4,
            min_stock: 2,
            target_stock: 5,
            max_stock: 9,
            sales: 14,
            recommended_qty: 3,
            supplier_recommended_qty: 6,
            canonical_match: true,
            provenance: 'owner-session-1',
          },
          {
            row_identity: 'row-2',
            article: 'ART-2',
            sku_id: null,
            name: null,
            supplier: 'Зооград',
            free_stock: null,
            min_stock: null,
            target_stock: null,
            max_stock: null,
            sales: null,
            recommended_qty: null,
            supplier_recommended_qty: null,
            canonical_match: false,
            provenance: null,
          },
        ],
      },
    ],
    individuals: [
      {
        decision_id: 'dec-one',
        row_identity: 'row-9',
        article: 'ART-9',
        sku_id: 'SKU-9',
        sku_id_source: 'report_internal_product_id',
        name: 'Корм «<script>alert(1)</script>»',
        supplier: 'Зооград',
        owner_signals: ['commercial_review'],
        signal_group: 'COMMERCIAL_ONLY',
        business_question: 'Расчёт или рекомендация поставщика?',
        evidence: [
          'free_stock=unknown',
          'pending_quantity=4',
          'owner_signals=[commercial_review]',
        ],
        recommended_action: 'Владелец выбирает основу заказа.',
        free_stock: null,
        min_stock: 2,
        target_stock: 5,
        max_stock: 9,
        sales: 14,
        recommended_qty: 4,
        supplier_recommended_qty: 7,
        canonical_match: true,
        provenance: 'owner-session-1',
      },
      {
        decision_id: 'dec-two',
        row_identity: 'row-10',
        article: 'ART-10',
        sku_id: null,
        name: 'Игрушка с остатком',
        supplier: 'Зооград',
        owner_signals: ['large_inventory_review'],
        signal_group: 'LARGE_ONLY',
        business_question: 'Заказывать ли при большом покрытии?',
        evidence: ['free_stock=12'],
        recommended_action: 'Владелец решает про большое покрытие.',
        free_stock: 12,
        min_stock: null,
        target_stock: null,
        max_stock: null,
        sales: null,
        recommended_qty: null,
        supplier_recommended_qty: null,
        canonical_match: false,
        provenance: null,
      },
    ],
    blocked: [
      {
        row_identity: 'row-30',
        article: 'ART-30',
        name: 'Позиция без матрицы',
        sku_id: null,
        supplier: 'Зооград',
        reason_code: 'MATRIX_UNMATCHED',
        owner_signals: ['commercial_review'],
        blocker: 'data_or_linkage',
        recommended_action: 'Сопоставить товар с canonical-матрицей.',
        note: 'После исправления данных может потребоваться решение владельца',
        free_stock: 1,
        min_stock: null,
        target_stock: null,
        max_stock: null,
        sales: null,
        recommended_qty: null,
        supplier_recommended_qty: null,
        canonical_match: false,
        provenance: null,
      },
      {
        row_identity: 'row-31',
        article: 'ART-31',
        name: 'Позиция без количества',
        sku_id: null,
        supplier: 'Зооград',
        reason_code: 'OWNER_DECISION_REQUIRED',
        owner_signals: ['commercial_review'],
        blocker: 'missing_recommended_quantity',
        recommended_action: 'Требуется решение владельца.',
        note: 'После исправления данных может потребоваться решение владельца',
        free_stock: 2,
        min_stock: 1,
        target_stock: 2,
        max_stock: 4,
        sales: 3,
        recommended_qty: null,
        supplier_recommended_qty: 2,
        canonical_match: true,
        provenance: null,
      },
    ],
    exclusions: [
      {
        row_identity: 'row-20',
        article: 'ART-20',
        name: 'Позиция без связи',
        linkage_reason: 'exit',
        linkage_reason_label: 'EXIT без подтверждённого canonical EXIT',
      },
      {
        row_identity: 'row-21',
        article: 'ART-21',
        name: 'Дубль',
        linkage_reason: 'identity',
        linkage_reason_label: 'дубль / неоднозначная идентификация',
      },
    ],
    ...overrides,
  };
  return {
    run_id: RUN_ID,
    calculation_version: 'test-version-9',
    available: true,
    summary: {
      comparison: { manual_queue_total_before: 100, real_owner_decisions_after: 32 },
      categories: { OWNER_DECISION_REQUIRED: 30 },
      sections: { owner_decisions: 32 },
    },
    compaction,
  };
}

test('reviewTriageUrl builds only for a valid run id', () => {
  assert.equal(
    reviewTriageUrl(RUN_ID),
    `/api/v1/runs/${RUN_ID}/review-triage`
  );
  assert.equal(reviewTriageUrl('not-a-uuid'), null);
  assert.equal(reviewTriageUrl(null), null);
});

test('banner text uses compaction numbers verbatim without client grouping', () => {
  const banner = reviewTriageBanner(compactionPayload().compaction);
  assert.equal(banner.total, 'Сейчас нужно принять 32 решения');
  assert.equal(
    banner.subtitle,
    '60 бизнес-позиций → 4 пакетных + 28 индивидуальных' +
    ' · 2 заблокировано проблемами данных (решение после исправления)' +
    ' · 7 проблем данных (не решения владельца)'
  );
  // Arbitrary values are rendered as-is: no arithmetic/grouping on client.
  const fake = reviewTriageBanner({
    business_sku_count: 999,
    package_decision_count: 3,
    individual_decision_count: 5,
    total_owner_decision_count: 8,
    blocked_by_data_count: 4,
    data_or_linkage_count: 77,
  });
  assert.match(fake.subtitle, /999 бизнес-позиций/);
  assert.match(fake.subtitle, /3 пакетных \+ 5 индивидуальных/);
  assert.match(fake.subtitle, /4 заблокировано проблемами данных/);
  assert.match(fake.subtitle, /77 проблем данных/);
  // Без заблокированных — блок не показывается.
  const noBlocked = reviewTriageBanner({
    business_sku_count: 1,
    package_decision_count: 1,
    individual_decision_count: 0,
    total_owner_decision_count: 1,
    blocked_by_data_count: 0,
  });
  assert.equal(noBlocked.subtitle.includes('заблокировано'), false);
  assert.equal(reviewTriageBanner(null), null);
  assert.equal(reviewTriageBanner({}), null);
});

test('reviewTriageMinMaxText keeps unknown components unknown, never zero', () => {
  assert.equal(reviewTriageMinMaxText(2, 5, 9), '2 / 5 / 9');
  assert.equal(reviewTriageMinMaxText(null, null, null), null);
  assert.equal(reviewTriageMinMaxText(2, null, 9), '2 / — / 9');
});

test('render shows banner, packages, individuals, blocked and exclusions', () => {
  const elements = triageElements();
  const rendered = renderReviewTriage(
    { createElement: tag => fakeElement(tag) },
    elements,
    compactionPayload()
  );
  assert.equal(rendered, true);
  assert.equal(elements.reviewTriage.hidden, false);
  assert.equal(elements.reviewTriageState.hidden, true);
  assert.equal(elements.reviewTriageContent.hidden, false);
  assert.match(elements.reviewTriageTotal.textContent, /Сейчас нужно принять 32 решения/);
  assert.match(elements.reviewTriageSubtitle.textContent, /60 бизнес-позиций/);
  assert.match(
    elements.reviewTriageSubtitle.textContent,
    /2 заблокировано проблемами данных/
  );
  // Счётчики сворачиваемых разделов данных.
  assert.equal(
    elements.reviewTriageBlockedSummary.textContent,
    'Сначала нужно исправить данные — 2'
  );
  assert.equal(
    elements.reviewTriageExclusionsSummary.textContent,
    'Другие проблемы данных — 2'
  );

  assert.equal(elements.reviewTriagePackages.children.length, 1);
  assert.equal(elements.reviewTriagePackagesEmpty.hidden, true);
  const packageText = collectText(elements.reviewTriagePackages);
  assert.match(packageText, /2 товаров: Какой расчёт считать основным\?/);
  assert.match(packageText, /Пакетное решение · 2 товаров/);
  assert.match(
    packageText,
    /Для этих товаров ранее использовались одни Min\/Max/
  );
  assert.match(packageText, /Почему объединены:/);
  assert.match(packageText, /Рекомендация системы:/);
  assert.match(packageText, /оставить действующую политику Min\/Max/);
  assert.match(packageText, /принять свежий расчёт Min\/Max/);
  assert.match(
    packageText,
    /Корм сухой — Артикул поставщика: ART-1 — \(остаток 4 · Min\/Target\/Max 2 \/ 5 \/ 9 · продажи 28 дн\. 14 · расчёт закупщика 3 · рекомендация поставщика 6\)/
  );
  // Участник без данных: без выдуманных нулей.
  assert.match(
    packageText,
    /Артикул поставщика: ART-2 — \(остаток нет данных/
  );

  assert.equal(elements.reviewTriageIndividuals.children.length, 2);
  assert.equal(elements.reviewTriageIndividualsEmpty.hidden, true);
  const individualText = collectText(elements.reviewTriageIndividuals);
  assert.match(individualText, /Корм «<script>alert\(1\)<\/script>»/);
  assert.match(
    individualText,
    /Артикул поставщика: ART-9 · sku_id: SKU-9 · Поставщик: Зооград/
  );
  assert.match(individualText, /Факты:/);
  assert.match(individualText, /Почему нужен Сергей:/);
  assert.match(individualText, /Рекомендация системы:/);
  assert.match(individualText, /Варианты решения:/);

  // BLOCKED_BY_DATA: отдельный раздел, явно не активное решение.
  assert.equal(elements.reviewTriageBlocked.children.length, 2);
  assert.equal(elements.reviewTriageBlockedEmpty.hidden, true);
  const blockedText = collectText(elements.reviewTriageBlocked);
  assert.match(blockedText, /Не найдено правило закупки для товара/);
  assert.match(blockedText, /Позиция без матрицы · Артикул поставщика: ART-30/);
  assert.match(blockedText, /Что нужно исправить:/);
  assert.match(blockedText, /Решение Сергея сейчас не требуется\./);
  assert.match(
    blockedText,
    /После исправления данных может потребоваться решение владельца/
  );

  assert.equal(elements.reviewTriageExclusions.children.length, 2);
  assert.equal(elements.reviewTriageExclusionsEmpty.hidden, true);
  const exclusionText = collectText(elements.reviewTriageExclusions);
  assert.match(exclusionText, /Статус исключения товара не подтверждён/);
  assert.match(exclusionText, /Один артикул связан с несколькими товарами/);
  assert.match(exclusionText, /Нужно решение Сергея сейчас: нет\./);
  assert.match(exclusionText, /ART-20/);
});

test('technical codes stay available but never appear in owner-facing text', () => {
  const elements = triageElements();
  renderReviewTriage(
    { createElement: tag => fakeElement(tag) },
    elements,
    compactionPayload()
  );
  const technicalCodes = [
    /MATRIX_UNMATCHED/,
    /commercial_review/,
    /approved_policy_conflict/,
    /POLICY_CONFIRM_UNVERIFIED/,
    /decision_type/,
    /owner_signals/,
    /provenance/,
    /business_question/,
    /row_identity/,
    /linkage_reason/,
    /canonical/i,
    /owner policy/i,
    /EXIT без подтверждённого canonical EXIT/,
  ];
  for (const container of [
    elements.reviewTriagePackages,
    elements.reviewTriageIndividuals,
    elements.reviewTriageBlocked,
    elements.reviewTriageExclusions,
  ]) {
    const mainText = collectMainText(container);
    for (const pattern of technicalCodes) {
      assert.doesNotMatch(
        mainText,
        pattern,
        `technical pattern ${pattern} leaked into owner text`
      );
    }
  }
  // Внутренние коды не удалены, а доступны в техническом блоке
  // активных решений и заблокированных позиций.
  const allTechnical = [
    collectTechnicalText(elements.reviewTriagePackages),
    collectTechnicalText(elements.reviewTriageIndividuals),
    collectTechnicalText(elements.reviewTriageBlocked),
  ].join('\n');
  assert.notEqual(allTechnical.trim(), '');
  assert.match(allTechnical, /MATRIX_UNMATCHED/);
  assert.match(allTechnical, /commercial_review/);
  assert.match(allTechnical, /approved_policy_conflict/);
  assert.match(allTechnical, /POLICY_CONFIRM_UNVERIFIED/);
  assert.match(allTechnical, /owner_signals=/);
});

test('recommendedQty above Max gets a clear conflict explanation', () => {
  const payload = compactionPayload();
  payload.compaction.individuals = [
    {
      decision_id: 'dec-8608',
      row_identity: 'row-8608',
      article: '8608',
      sku_id: 'SKU-8608',
      name: 'Зверьё моё Опилки',
      supplier: 'Зооград',
      owner_signals: ['approved_policy_conflict'],
      business_question: 'Подтвердить ли превышение Max?',
      evidence: ['free_stock=0', 'pending_quantity=13'],
      recommended_action: 'Владелец решает про превышение Max.',
      free_stock: 0,
      min_stock: 2,
      target_stock: 2,
      max_stock: 4,
      sales: 6,
      recommended_qty: 13,
      supplier_recommended_qty: 4,
      canonical_match: true,
      provenance: null,
    },
  ];
  const elements = triageElements();
  renderReviewTriage(
    { createElement: tag => fakeElement(tag) },
    elements,
    payload
  );
  const card = elements.reviewTriageIndividuals.children[0];
  const mainText = collectMainText(card);
  assert.match(
    mainText,
    /Закупщик предлагает заказать 13 шт\., хотя действующий Max — 4 шт\./
  );
  assert.match(
    mainText,
    /Не применять 13 шт\. автоматически/
  );
  assert.match(mainText, /оставить действующую политику Min\/Max/);
  assert.match(mainText, /принять свежий расчёт/);
  // Факты пришли как есть: 0 — это 0, а не «нет данных».
  const stockField = findFactField(card, 'Остаток');
  assert.equal(stockField.children[1].textContent, '0');
  const recField = findFactField(card, 'Расчёт закупщика');
  assert.equal(recField.children[1].textContent, '13');
  // Числа upstream не изменены.
  assert.doesNotMatch(mainText, /14 шт|заказать 14/);
});

function findFactField(card, label) {
  const find = node => {
    if (
      node.children?.length === 2 &&
      node.children[0].textContent === label
    ) {
      return node;
    }
    for (const child of node.children || []) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const field = find(card);
  assert.ok(field, `fact field «${label}» not found`);
  return field;
}

test('unknown values render as «нет данных», never as zero', () => {
  const elements = triageElements();
  renderReviewTriage(
    { createElement: tag => fakeElement(tag) },
    elements,
    compactionPayload()
  );
  const firstCard = elements.reviewTriageIndividuals.children[0];
  const stockField = findFactField(firstCard, 'Остаток');
  assert.equal(stockField.children[1].textContent, 'нет данных');
  // Вторая карточка: recommended_qty и продажи = null → «нет данных», не 0.
  const secondCard = elements.reviewTriageIndividuals.children[1];
  assert.equal(
    findFactField(secondCard, 'Расчёт закупщика').children[1].textContent,
    'нет данных'
  );
  assert.equal(
    findFactField(secondCard, 'Продано за 28 дней').children[1].textContent,
    'нет данных'
  );
  assert.equal(
    findFactField(secondCard, 'Текущая политика Min/Target/Max')
      .children[1].textContent,
    'нет данных'
  );
});

test('individual card renders presentation fields from the API payload', () => {
  const elements = triageElements();
  renderReviewTriage(
    { createElement: tag => fakeElement(tag) },
    elements,
    compactionPayload()
  );
  const firstCard = elements.reviewTriageIndividuals.children[0];
  // Min/Target/Max, продажи, рекомендации — пришли в payload, клиент не
  // дёргает /items и ничего не пересчитывает.
  assert.equal(
    findFactField(firstCard, 'Текущая политика Min/Target/Max')
      .children[1].textContent,
    '2 / 5 / 9'
  );
  assert.equal(
    findFactField(firstCard, 'Продано за 28 дней').children[1].textContent,
    '14'
  );
  assert.equal(
    findFactField(firstCard, 'Расчёт закупщика').children[1].textContent,
    '4'
  );
  assert.equal(
    findFactField(firstCard, 'Рекомендация поставщика').children[1].textContent,
    '7'
  );
});

test('render block contains no write controls', () => {
  const elements = triageElements();
  renderReviewTriage(
    { createElement: tag => fakeElement(tag) },
    elements,
    compactionPayload()
  );
  const forbidden = new Set([
    'button', 'input', 'select', 'textarea', 'form', 'a',
  ]);
  for (const container of [
    elements.reviewTriagePackages,
    elements.reviewTriageIndividuals,
    elements.reviewTriageBlocked,
    elements.reviewTriageExclusions,
  ]) {
    for (const tag of collectTags(container)) {
      assert.equal(forbidden.has(tag), false, `forbidden tag ${tag}`);
    }
  }
});

test('unavailable payload renders a soft message without breaking the screen', () => {
  for (const payload of [null, { available: false }, {}]) {
    const elements = triageElements();
    const rendered = renderReviewTriage(
      { createElement: tag => fakeElement(tag) },
      elements,
      payload
    );
    assert.equal(rendered, false);
    assert.equal(elements.reviewTriage.hidden, false);
    assert.equal(elements.reviewTriageState.hidden, false);
    assert.equal(
      elements.reviewTriageState.textContent,
      'Разбор недоступен для этого run.'
    );
    assert.equal(elements.reviewTriageContent.hidden, true);
  }
});

test('frontend module exposes review triage helpers and markup hooks', () => {
  assert.match(appSource, /function renderReviewTriage\(/);
  assert.match(appSource, /function reviewTriageUrl\(/);
  assert.match(appSource, /\/api\/v1\/runs\/\$\{runId\}\/review-triage/);
  assert.ok(htmlSource.includes('id="review-triage"'));
  assert.ok(htmlSource.includes('Разбор ручной очереди'));
  assert.ok(htmlSource.includes('id="review-triage-packages"'));
  assert.ok(htmlSource.includes('id="review-triage-individuals"'));
  assert.ok(htmlSource.includes('id="review-triage-blocked"'));
  assert.ok(htmlSource.includes('id="review-triage-blocked-summary"'));
  assert.ok(htmlSource.includes('id="review-triage-exclusions-summary"'));
  assert.ok(htmlSource.includes('Сначала нужно исправить данные'));
  assert.ok(htmlSource.includes('Другие проблемы данных'));
  // Разделы данных сворачиваемые и по умолчанию закрытые.
  assert.ok(htmlSource.includes('review-triage-collapsible'));
  assert.ok(cssSource.includes('.review-triage-card-attention'));
  assert.ok(cssSource.includes('.review-triage-technical pre'));
  assert.ok(cssSource.includes('.review-triage-card-blocked'));
  assert.equal(htmlSource.includes('review-triage-save'), false);
});
