const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildOwnerLearningCenterUrl,
  createActivityCard,
  createAttentionCard,
  formatHistoryDateTime,
  formatSignedQuantity,
  formatSignedRub,
  ownerLearningViewState,
  renderOwnerLearningActivity,
  renderOwnerLearningAttention,
  renderOwnerLearningHealth,
  renderOwnerLearningSections,
  renderOwnerLearningSummary,
  setOwnerLearningState,
  switchOwnerLearningTab,
} = require('../public/app');

const publicRoot = path.resolve(__dirname, '../public');
const html = fs.readFileSync(
  path.join(publicRoot, 'index.html'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(publicRoot, 'styles.css'),
  'utf8'
);
const appSource = fs.readFileSync(
  path.join(publicRoot, 'app.js'),
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

function overviewElements() {
  return {
    ownerLearningLoading: element(),
    ownerLearningPartial: element(),
    ownerLearningUnavailable: element(),
    ownerLearningInvalid: element(),
    ownerLearningNetwork: element(),
    ownerLearningContent: element(),
    ownerLearningAttentionBadge: element(),
    ownerLearningAttentionEmpty: element(),
    ownerLearningAttentionList: element(),
    ownerLearningActivityEmpty: element(),
    ownerLearningActivityList: element(),
    ownerLearningHealthStatus: element(),
    ownerLearningHealthComponents: element('dl'),
    ownerLearningHealthWarnings: element('ul'),
    ownerLearningLastKnowledge: element(),
    ownerLearningLastStatus: element(),
    ownerLearningLastEffect: element(),
    ownerLearningSections: element(),
    ownerLearningSummary: {
      decisions: element(),
      candidates: element(),
      approved: element(),
      rules: element(),
      activeRules: element(),
      disabledRules: element(),
      effectiveRules: element(),
      attentionTotal: element(),
      amountDelta: element(),
      knowledgeScore: element(),
      knowledgeGrade: element(),
      knowledgeConflicts: element(),
      knowledgeDuplicates: element(),
      knowledgeStale: element(),
      knowledgeAttention: element(),
    },
  };
}

function overview() {
  return {
    status: 'AVAILABLE',
    generated_at: '2026-07-27T00:00:00.000Z',
    summary: {
      decisions: { total: 8 },
      candidates: { total: 3, approved: 1 },
      rules: { total: 2, active: 1, disabled: 1 },
      effectiveness: {
        effective: 1,
        total_order_amount_delta: -125.5,
      },
      knowledge_health: {
        score: 88,
        grade: 'GOOD',
        critical_findings: 0,
        attention_findings: 1,
        conflict_groups: 0,
        duplicate_groups: 1,
        stale_rules: 0,
      },
    },
    attention: { total: 0, items: [] },
    recent_activity: [],
    system_health: {
      overall_status: 'HEALTHY',
      components: {},
      data_quality_warnings: [],
    },
    sections: {},
    warnings: [],
  };
}

test('main navigation contains the Owner Learning Center item', () => {
  assert.match(html, /href="#owner-learning-center"/);
  assert.match(html, /Центр обучения закупщика/);
});

test('overview is the selected default tab', () => {
  assert.match(
    html,
    /aria-selected="true"\s+data-owner-learning-target="OVERVIEW"/
  );
  assert.match(
    html,
    /data-owner-learning-panel="DECISION_HISTORY"\s+hidden/
  );
});

test('all six Owner Learning tabs are present', () => {
  for (const label of [
    'Обзор',
    'История решений',
    'Кандидаты',
    'Правила',
    'Эффективность',
    'Здоровье базы знаний',
  ]) {
    assert.ok(html.includes(label));
  }
});

test('safety text explicitly forbids automatic rule changes', () => {
  assert.ok(html.includes(
    'Центр не создаёт, не активирует и не отключает правила автоматически.'
  ));
});

test('summary cards and historical delta disclaimer are present', () => {
  for (const label of [
    'Всего решений',
    'Одобренных кандидатов',
    'Активных правил',
    'Неактивных правил',
    'Эффективных правил',
    'Требуют проверки',
    'Общая историческая разница суммы заказа',
  ]) {
    assert.ok(html.includes(label));
  }
  assert.ok(html.includes(
    'Это изменение рассчитанных заказов, а не прибыль или'
  ));
});

test('attention, activity, health and section containers exist', () => {
  for (const id of [
    'owner-learning-attention-list',
    'owner-learning-activity-list',
    'owner-learning-health-components',
    'owner-learning-sections',
  ]) {
    assert.ok(html.includes(`id="${id}"`));
  }
});

test('partial, unavailable, loading and network states are declared', () => {
  assert.ok(html.includes('Загружаем Центр обучения'));
  assert.ok(html.includes(
    'Часть данных временно недоступна. Доступные разделы продолжают'
  ));
  assert.ok(html.includes(
    'Центр обучения временно недоступен. Работа закупщика не затронута.'
  ));
  assert.ok(html.includes(
    'Не удалось загрузить Центр обучения.'
  ));
});

test('center URL contains only explicit read query parameters', () => {
  assert.equal(
    buildOwnerLearningCenterUrl(
      {
        supplier: ' Валта ',
        brand: 'AWARD',
        category: '',
        dateFrom: '2026-07-01',
      },
      {
        attentionLimit: 5,
        activityLimit: 6,
        asOf: '2026-07-27T00:00:00.000Z',
      }
    ),
    '/api/v1/owner-learning/center?' +
      'supplier=%D0%92%D0%B0%D0%BB%D1%82%D0%B0&brand=AWARD&' +
      'dateFrom=2026-07-01&attentionLimit=5&activityLimit=6&' +
      'asOf=2026-07-27T00%3A00%3A00.000Z'
  );
});

test('overview state recognizes success, partial and unavailable', () => {
  assert.equal(ownerLearningViewState(overview()), 'ready');
  assert.equal(
    ownerLearningViewState({ ...overview(), status: 'PARTIAL' }),
    'partial'
  );
  assert.equal(
    ownerLearningViewState({ status: 'UNAVAILABLE' }),
    'unavailable'
  );
  assert.equal(ownerLearningViewState({ status: 'AVAILABLE' }), 'invalid');
});

test('state renderer keeps available content visible for PARTIAL', () => {
  const elements = overviewElements();
  setOwnerLearningState(elements, 'partial');
  assert.equal(elements.ownerLearningPartial.hidden, false);
  assert.equal(elements.ownerLearningContent.hidden, false);
  setOwnerLearningState(elements, 'unavailable');
  assert.equal(elements.ownerLearningContent.hidden, true);
});

test('null values render as dashes and amount delta is signed rubles', () => {
  const elements = overviewElements();
  const data = overview();
  data.summary.decisions.total = null;
  renderOwnerLearningSummary(elements, data);
  assert.equal(elements.ownerLearningSummary.decisions.textContent, '—');
  assert.match(
    elements.ownerLearningSummary.amountDelta.textContent,
    /^−/
  );
  assert.equal(formatSignedRub(null), '—');
  assert.equal(formatSignedQuantity(null), '—');
});

test('attention card treats HTML-like names as text', () => {
  const card = createAttentionCard(documentObject(), {
    priority: 'HIGH',
    title: '<img src=x onerror=alert(1)>',
    description: '<script>alert(1)</script>',
    display_scope: { primary: '<b>Товар</b>' },
    navigation_target: 'CANDIDATES',
  });
  assert.equal(
    card.children[0].children[0].textContent,
    '<img src=x onerror=alert(1)>'
  );
  assert.equal(
    card.children[1].textContent,
    '<script>alert(1)</script>'
  );
});

test('attention empty state and navigation callback work', () => {
  const elements = overviewElements();
  renderOwnerLearningAttention(
    documentObject(),
    elements,
    { total: 0, items: [] }
  );
  assert.equal(elements.ownerLearningAttentionEmpty.hidden, false);
  let target = null;
  const card = createAttentionCard(documentObject(), {
    priority: 'MEDIUM',
    title: 'Тест',
    navigation_target: 'CANDIDATES',
  }, value => {
    target = value;
  });
  const button = card.children.at(-1);
  button.listeners.click[0]();
  assert.equal(target, 'CANDIDATES');
});

test('recent activity renders safe fields and signed deltas', () => {
  const card = createActivityCard(documentObject(), {
    activity_type: 'RULE_APPLIED_EFFECT',
    recorded_at: '2026-07-27T00:00:00.000Z',
    display_scope: {
      primary: '<img onerror=alert(1)>',
      secondary: 'SKU 1',
    },
    description: 'Изменение',
    decision: 'BUY',
    status: 'APPLIED_EFFECT',
    amount_delta: 25,
    quantity_delta: -1,
    rule_id: 'technical-rule-id',
    event_id: 'technical-event-id',
  });
  const serialized = JSON.stringify(card);
  assert.equal(serialized.includes('technical-rule-id'), false);
  assert.equal(serialized.includes('technical-event-id'), false);
  assert.equal(
    card.children[1].textContent,
    '<img onerror=alert(1)> · SKU 1'
  );
  assert.match(card.children[3].textContent, /Δ суммы: \+/);
});

test('recent activity empty state is supported', () => {
  const elements = overviewElements();
  renderOwnerLearningActivity(
    documentObject(),
    elements,
    []
  );
  assert.equal(elements.ownerLearningActivityEmpty.hidden, false);
  assert.equal(elements.ownerLearningActivityList.children.length, 0);
});

test('system health uses Russian labels and no repair buttons', () => {
  const elements = overviewElements();
  renderOwnerLearningHealth(documentObject(), elements, {
    overall_status: 'DEGRADED',
    components: {
      decision_history: { status: 'AVAILABLE' },
      rule_effectiveness: { status: 'UNAVAILABLE' },
    },
    data_quality_warnings: ['MISSING_REASON'],
  });
  assert.equal(
    elements.ownerLearningHealthStatus.textContent,
    'Часть данных временно недоступна'
  );
  assert.equal(elements.ownerLearningHealthComponents.children.length, 2);
  assert.equal(elements.ownerLearningHealthWarnings.children.length, 1);
  assert.equal(
    JSON.stringify(elements).includes('repair'),
    false
  );
});

test('section cards navigate to existing tabs', () => {
  const elements = overviewElements();
  const targets = [];
  renderOwnerLearningSections(documentObject(), elements, {
    decision_history: {
      status: 'AVAILABLE',
      count: 5,
      navigation_target: 'DECISION_HISTORY',
    },
    candidates: {
      status: 'AVAILABLE',
      count: 2,
      attention_count: 1,
      navigation_target: 'CANDIDATES',
    },
    materialized_rules: {
      status: 'AVAILABLE',
      count: 1,
      active_count: 1,
      navigation_target: 'MATERIALIZED_RULES',
    },
    effectiveness: {
      status: 'EMPTY',
      count: 1,
      attention_count: 0,
      navigation_target: 'RULE_EFFECTIVENESS',
    },
    knowledge_health: {
      status: 'AVAILABLE',
      score: 82,
      grade: 'GOOD',
      attention_count: 0,
      navigation_target: 'KNOWLEDGE_HEALTH',
    },
  }, target => targets.push(target));
  assert.equal(elements.ownerLearningSections.children.length, 5);
  const button = elements.ownerLearningSections.children[0].children.at(-1);
  button.listeners.click[0]();
  assert.deepEqual(targets, ['DECISION_HISTORY']);
});

test('tab switching keeps existing panels and defaults safely', () => {
  const tabs = ['OVERVIEW', 'DECISION_HISTORY', 'CANDIDATES'].map(
    target => {
      const value = element('button');
      value.dataset.ownerLearningTarget = target;
      return value;
    }
  );
  const panels = ['OVERVIEW', 'DECISION_HISTORY', 'CANDIDATES'].map(
    target => {
      const value = element('section');
      value.dataset.ownerLearningPanel = target;
      return value;
    }
  );
  const elements = {
    ownerLearningTabs: tabs,
    ownerLearningPanels: panels,
  };
  assert.equal(
    switchOwnerLearningTab(elements, 'DECISION_HISTORY'),
    'DECISION_HISTORY'
  );
  assert.equal(panels[1].hidden, false);
  assert.equal(panels[0].hidden, true);
  assert.equal(switchOwnerLearningTab(elements, 'UNSAFE'), 'OVERVIEW');
});

test('desktop and mobile CSS constrain center grids without overflow', () => {
  assert.match(css, /\.owner-learning-tabs[\s\S]*overflow-x: auto/);
  assert.match(
    css,
    /@media \(max-width: 520px\)[\s\S]*\.owner-learning-summary/
  );
  assert.match(
    css,
    /\.owner-learning-summary article[\s\S]*min-width: 0/
  );
});

test('existing Owner Learning sections remain in the DOM', () => {
  for (const id of [
    'decision-history',
    'learning-candidates',
    'materialized-rules',
    'rule-effectiveness',
  ]) {
    assert.ok(html.includes(`id="${id}"`));
  }
});

test('overview static markup has no automatic or bulk action buttons', () => {
  const start = html.indexOf('id="owner-learning-center"');
  const end = html.indexOf('id="decision-history"');
  const centerMarkup = html.slice(start, end);
  assert.equal(/repair|bulk|materialize-rule|status-preview/i.test(
    centerMarkup
  ), false);
  assert.equal(/type="submit"/i.test(centerMarkup), false);
});

test('default overview load is lazy and sends no hidden tab requests', () => {
  const initialization = appSource.slice(
    appSource.lastIndexOf('resetExports();'),
    appSource.lastIndexOf('return {')
  );
  assert.ok(initialization.includes("navigateOwnerLearning('OVERVIEW')"));
  assert.ok(initialization.includes('loadOwnerLearningCenter();'));
  assert.equal(initialization.includes('loadDecisionHistory();'), false);
  assert.equal(initialization.includes('loadCandidates();'), false);
  assert.equal(initialization.includes('loadMaterializedRules();'), false);
  assert.equal(initialization.includes('loadRuleEffectiveness();'), false);
});

test('date-time formatter safely handles missing data', () => {
  assert.equal(formatHistoryDateTime(null), '—');
  assert.equal(formatHistoryDateTime('not-a-date'), '—');
  assert.notEqual(
    formatHistoryDateTime('2026-07-27T00:00:00.000Z'),
    '—'
  );
});
