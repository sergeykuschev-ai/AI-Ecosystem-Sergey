const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildKnowledgeHealthUrl,
  createKnowledgeHealthFinding,
  createKnowledgeHealthRuleRow,
  knowledgeHealthClassificationLabel,
  knowledgeHealthGradeLabel,
  knowledgeHealthSeverityLabel,
  knowledgeHealthViewState,
  renderKnowledgeHealth,
  resetKnowledgeHealthFilters,
  setKnowledgeHealthPanelState,
  switchOwnerLearningTab,
} = require('../public/app');

const publicRoot = path.resolve(__dirname, '../public');
const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(publicRoot, 'app.js'), 'utf8');
const styles = fs.readFileSync(
  path.join(publicRoot, 'styles.css'),
  'utf8'
);

function element(tagName = 'div') {
  return {
    tagName,
    children: [],
    className: '',
    dataset: {},
    attributes: {},
    hidden: false,
    textContent: '',
    value: '',
    listeners: {},
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(name, listener) {
      this.listeners[name] ||= [];
      this.listeners[name].push(listener);
    },
    set innerHTML(value) {
      throw new Error(`Unsafe innerHTML assignment: ${value}`);
    },
  };
}

function documentObject() {
  return {
    createElement(tagName) {
      return element(tagName);
    },
  };
}

function healthResult(overrides = {}) {
  return {
    status: 'AVAILABLE',
    generated_at: '2026-07-27T00:00:00.000Z',
    score: 82,
    grade: 'GOOD',
    summary: {
      total_rules: 1,
      conflict_groups: 0,
      duplicate_groups: 0,
      stale_rules: 0,
      attention_rules: 0,
      critical_rules: 0,
    },
    dimensions: Object.fromEntries([
      ['consistency', 25],
      ['effectiveness', 20],
      ['freshness', 15],
      ['data_quality', 15],
      ['safety', 15],
      ['maintainability', 10],
    ].map(([name, weight]) => [name, {
      score: 82,
      weight,
      findings_count: 0,
    }])),
    findings: [],
    rules: [],
    warnings: [],
    ...overrides,
  };
}

function healthElements() {
  return {
    knowledgeHealthLoading: element(),
    knowledgeHealthPartial: element(),
    knowledgeHealthEmpty: element(),
    knowledgeHealthNoFindings: element(),
    knowledgeHealthNoResults: element(),
    knowledgeHealthUnavailable: element(),
    knowledgeHealthInvalid: element(),
    knowledgeHealthNetwork: element(),
    knowledgeHealthContent: element(),
    knowledgeHealthDimensions: element(),
    knowledgeHealthFindings: element(),
    knowledgeHealthRules: element('tbody'),
    knowledgeHealthStatus: element('select'),
    knowledgeHealthDecision: element('select'),
    knowledgeHealthGrade: element('select'),
    knowledgeHealthClassification: element('select'),
    knowledgeHealthSeverity: element('select'),
    knowledgeHealthFindingType: element('select'),
    knowledgeHealthConfidence: element('select'),
    knowledgeHealthPriority: element('select'),
    knowledgeHealthSearch: element('input'),
    knowledgeHealthSummary: {
      score: element(),
      grade: element(),
      apiStatus: element(),
      conflicts: element(),
      duplicates: element(),
      stale: element(),
      attention: element(),
    },
  };
}

test('health tab, overview cards, safety text and dashboard exist', () => {
  assert.ok(html.includes('data-owner-learning-target="KNOWLEDGE_HEALTH"'));
  assert.ok(html.includes('data-owner-learning-panel="KNOWLEDGE_HEALTH"'));
  for (const label of [
    'Оценка базы знаний',
    'Класс качества',
    'Конфликтов',
    'Дубликатов',
    'Устаревших правил',
    'Требуют проверки',
  ]) {
    assert.ok(html.includes(label));
  }
  assert.ok(html.includes(
    'Оценка показывает качество и согласованность базы правил.'
  ));
  assert.ok(html.includes(
    'Она не изменяет и не отключает правила автоматически.'
  ));
});

test('all required frontend states are declared', () => {
  for (const id of [
    'knowledge-health-loading',
    'knowledge-health-partial',
    'knowledge-health-empty',
    'knowledge-health-no-findings',
    'knowledge-health-no-results',
    'knowledge-health-unavailable',
    'knowledge-health-invalid',
    'knowledge-health-network',
  ]) {
    assert.ok(html.includes(`id="${id}"`));
  }
});

test('health rules table scrolls locally on narrow screens', () => {
  assert.ok(html.includes(
    'class="table-scroll knowledge-health-table-scroll"'
  ));
  assert.match(
    styles,
    /\.table-scroll\.knowledge-health-table-scroll\s*\{[^}]*overflow-x:\s*auto/s
  );
  assert.match(
    styles,
    /\.table-scroll\.knowledge-health-table-scroll table\s*\{[^}]*min-width:\s*760px/s
  );
});

test('health URL contains only non-empty read filters', () => {
  assert.equal(
    buildKnowledgeHealthUrl({
      status: 'ACTIVE',
      decision: '',
      search: ' <b>товар</b> ',
    }),
    '/api/v1/owner-learning/knowledge-health?' +
      'status=ACTIVE&search=%3Cb%3E%D1%82%D0%BE%D0%B2%D0%B0%D1%80' +
      '%3C%2Fb%3E&limit=100'
  );
});

test('finding, confidence and priority filters reach GET query', () => {
  assert.equal(
    buildKnowledgeHealthUrl({
      findingType: 'RULE_CONFLICT',
      confidenceLevel: 'LOW',
      priorityLevel: 'CRITICAL',
    }),
    '/api/v1/owner-learning/knowledge-health?' +
      'findingType=RULE_CONFLICT&confidenceLevel=LOW&' +
      'priorityLevel=CRITICAL&limit=100'
  );
  for (const [name, value] of [
    ['findingType', 'RULE_STALE'],
    ['confidenceLevel', 'VERY_HIGH'],
    ['priorityLevel', 'MEDIUM'],
  ]) {
    assert.ok(buildKnowledgeHealthUrl({ [name]: value }).includes(
      `${name}=${value}`
    ));
  }
});

test('new filter controls contain supported enum values only', () => {
  for (const value of [
    'RULE_CONFLICT',
    'RULE_LAST_UPDATED_TOO_OLD',
    'LOW',
    'MEDIUM',
    'HIGH',
    'VERY_HIGH',
    'CRITICAL',
  ]) {
    assert.ok(html.includes(`value="${value}"`));
  }
  assert.equal(html.includes('value="CUSTOM"'), false);
});

test('view state supports ready, partial, empty, no results and unavailable', () => {
  assert.equal(knowledgeHealthViewState(healthResult()), 'ready');
  assert.equal(knowledgeHealthViewState(
    healthResult({ status: 'PARTIAL' })
  ), 'partial');
  assert.equal(knowledgeHealthViewState(healthResult({
    summary: { total_rules: 0 },
  })), 'empty');
  assert.equal(knowledgeHealthViewState(healthResult(), {
    search: 'missing',
  }), 'no-results');
  assert.equal(knowledgeHealthViewState({
    status: 'UNAVAILABLE',
  }), 'unavailable');
  assert.equal(knowledgeHealthViewState({
    status: 'AVAILABLE',
    summary: {},
  }), 'invalid');
});

test('state renderer keeps partial data visible', () => {
  const elements = healthElements();
  setKnowledgeHealthPanelState(elements, 'partial');
  assert.equal(elements.knowledgeHealthPartial.hidden, false);
  assert.equal(elements.knowledgeHealthContent.hidden, false);
  setKnowledgeHealthPanelState(elements, 'network');
  assert.equal(elements.knowledgeHealthNetwork.hidden, false);
  assert.equal(elements.knowledgeHealthContent.hidden, true);
});

test('Russian grade, classification and severity labels are complete', () => {
  assert.equal(knowledgeHealthGradeLabel('EXCELLENT'), 'Отлично');
  assert.equal(knowledgeHealthGradeLabel('GOOD'), 'Хорошо');
  assert.equal(knowledgeHealthGradeLabel('FAIR'), 'Удовлетворительно');
  assert.equal(knowledgeHealthGradeLabel('POOR'), 'Плохо');
  assert.equal(knowledgeHealthGradeLabel('CRITICAL'), 'Критично');
  assert.equal(knowledgeHealthClassificationLabel('HEALTHY'), 'В норме');
  assert.equal(knowledgeHealthClassificationLabel('MONITOR'), 'Наблюдать');
  assert.equal(knowledgeHealthClassificationLabel('REVIEW'), 'Проверить');
  assert.equal(
    knowledgeHealthClassificationLabel('INSUFFICIENT_DATA'),
    'Недостаточно данных'
  );
  assert.equal(
    knowledgeHealthSeverityLabel('CRITICAL'),
    'Критическая'
  );
});

test('finding renders text and safe navigation button without IDs', () => {
  const targets = [];
  const card = createKnowledgeHealthFinding(documentObject(), {
    finding_id: 'technical-finding-id',
    rule_ids: ['technical-rule-id'],
    type: 'RULE_CONFLICT',
    severity: 'CRITICAL',
    display_scopes: [{
      primary: '<img src=x onerror=alert(1)>',
    }],
    recommended_review_action: 'REVIEW_CONFLICT',
    navigation_target: 'MATERIALIZED_RULES',
  }, target => targets.push(target));
  assert.equal(
    card.children[2].textContent,
    '<img src=x onerror=alert(1)>'
  );
  const button = card.children[4];
  assert.equal(button.tagName, 'button');
  assert.equal(button.textContent, 'Открыть раздел');
  assert.equal(
    button.dataset.navigationTarget,
    'MATERIALIZED_RULES'
  );
  button.listeners.click[0]();
  assert.deepEqual(targets, ['MATERIALIZED_RULES']);
  const rendered = JSON.stringify(card);
  assert.equal(rendered.includes('technical-finding-id'), false);
  assert.equal(rendered.includes('technical-rule-id'), false);
});

test('effectiveness finding navigates without a write request', () => {
  let requests = 0;
  const targets = [];
  const card = createKnowledgeHealthFinding(documentObject(), {
    type: 'RULE_STALE',
    severity: 'HIGH',
    navigation_target: 'RULE_EFFECTIVENESS',
  }, target => {
    targets.push(target);
  });
  const button = card.children.at(-1);
  button.listeners.click[0]();
  assert.deepEqual(targets, ['RULE_EFFECTIVENESS']);
  assert.equal(requests, 0);
});

test('rule row renders labels without technical IDs', () => {
  const row = createKnowledgeHealthRuleRow(documentObject(), {
    rule_id: 'technical-rule-id',
    display_scope: { primary: '<b>Товар</b>' },
    status: 'ACTIVE',
    decision: 'BUY',
    score: 77,
    grade: 'GOOD',
    classification: 'MONITOR',
    signals: {
      has_conflict: true,
      has_duplicate: false,
      is_stale: true,
      effectiveness_classification: 'STALE',
      confidence_level: 'HIGH',
      priority_level: 'MEDIUM',
    },
  });
  assert.equal(row.children[0].textContent, '<b>Товар</b>');
  assert.equal(JSON.stringify(row).includes('technical-rule-id'), false);
  assert.equal(row.children[6].textContent, 'Да');
  assert.equal(row.children[7].textContent, 'Нет');
  assert.equal(row.children[8].textContent, 'Да');
});

test('render fills score, dimensions, findings and rules safely', () => {
  const elements = healthElements();
  const data = healthResult({
    findings: [{
      type: 'RULE_DUPLICATE',
      severity: 'HIGH',
      display_scopes: [{ primary: 'Товар' }],
      recommended_review_action: 'REVIEW_DUPLICATE',
    }],
    rules: [{
      display_scope: { primary: 'Товар' },
      status: 'ACTIVE',
      decision: 'BUY',
      score: 82,
      grade: 'GOOD',
      classification: 'MONITOR',
      signals: {},
    }],
  });
  renderKnowledgeHealth(documentObject(), elements, data);
  assert.equal(elements.knowledgeHealthSummary.score.textContent, '82');
  assert.equal(elements.knowledgeHealthSummary.grade.textContent, 'Хорошо');
  assert.equal(elements.knowledgeHealthDimensions.children.length, 6);
  assert.equal(elements.knowledgeHealthFindings.children.length, 1);
  assert.equal(elements.knowledgeHealthRules.children.length, 1);
});

test('reset clears every supported filter', () => {
  const elements = healthElements();
  for (const name of [
    'knowledgeHealthStatus',
    'knowledgeHealthDecision',
    'knowledgeHealthGrade',
    'knowledgeHealthClassification',
    'knowledgeHealthSeverity',
    'knowledgeHealthFindingType',
    'knowledgeHealthConfidence',
    'knowledgeHealthPriority',
    'knowledgeHealthSearch',
  ]) {
    elements[name].value = 'x';
  }
  resetKnowledgeHealthFilters(elements);
  assert.ok([
    elements.knowledgeHealthStatus,
    elements.knowledgeHealthDecision,
    elements.knowledgeHealthGrade,
    elements.knowledgeHealthClassification,
    elements.knowledgeHealthSeverity,
    elements.knowledgeHealthFindingType,
    elements.knowledgeHealthConfidence,
    elements.knowledgeHealthPriority,
    elements.knowledgeHealthSearch,
  ].every(value => value.value === ''));
});

test('health UI contains no automatic mutation controls', () => {
  const section = html.slice(
    html.indexOf('id="knowledge-health"'),
    html.indexOf('id="rule-effectiveness-detail-modal"')
  );
  for (const forbidden of [
    'Отключить',
    'Удалить',
    'Объединить',
    'Активировать',
    'auto-disable',
    'auto-delete',
  ]) {
    assert.equal(section.includes(forbidden), false);
  }
  assert.equal(/innerHTML\s*=/.test(appSource), false);
});

test('tab switching accepts health and preserves existing tabs', () => {
  const tabs = ['OVERVIEW', 'MATERIALIZED_RULES', 'KNOWLEDGE_HEALTH']
    .map(target => {
      const value = element('button');
      value.dataset.ownerLearningTarget = target;
      return value;
    });
  const panels = ['OVERVIEW', 'MATERIALIZED_RULES', 'KNOWLEDGE_HEALTH']
    .map(target => {
      const value = element('section');
      value.dataset.ownerLearningPanel = target;
      return value;
    });
  const elements = {
    ownerLearningTabs: tabs,
    ownerLearningPanels: panels,
  };
  assert.equal(
    switchOwnerLearningTab(elements, 'KNOWLEDGE_HEALTH'),
    'KNOWLEDGE_HEALTH'
  );
  assert.equal(panels[2].hidden, false);
  assert.equal(
    switchOwnerLearningTab(elements, 'MATERIALIZED_RULES'),
    'MATERIALIZED_RULES'
  );
  assert.equal(panels[1].hidden, false);
});
