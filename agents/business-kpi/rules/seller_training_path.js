'use strict';

const ONBOARDING_PHASES = Object.freeze([
  Object.freeze({
    id: 'FOUNDATION',
    title: 'Старт и консультация',
    codes: Object.freeze(['KNOW-19', 'KNOW-20', 'KNOW-21']),
  }),
  Object.freeze({
    id: 'FEEDING',
    title: 'Корма и лакомства',
    codes: Object.freeze(['KNOW-04', 'KNOW-05', 'KNOW-01', 'KNOW-02', 'KNOW-22', 'KNOW-24', 'KNOW-06']),
  }),
  Object.freeze({
    id: 'LITTER_ACCESSORIES',
    title: 'Наполнители и базовые аксессуары',
    codes: Object.freeze(['KNOW-07', 'KNOW-08', 'KNOW-23', 'KNOW-25', 'KNOW-17']),
  }),
  Object.freeze({
    id: 'CARE',
    title: 'Уход, игрушки и амуниция',
    codes: Object.freeze(['KNOW-10', 'KNOW-11', 'KNOW-12', 'KNOW-13', 'KNOW-14', 'KNOW-15']),
  }),
  Object.freeze({
    id: 'SAFETY',
    title: 'Сложные категории и безопасность',
    codes: Object.freeze(['KNOW-03', 'KNOW-09', 'KNOW-16', 'KNOW-18']),
  }),
]);

const KPI_COACHING_MAP = Object.freeze({
  itemsPerReceipt: Object.freeze({
    label: 'Товаров в чеке',
    practiceCodes: Object.freeze(['SALE-08', 'SALE-10', 'SALE-01']),
  }),
  averageCheck: Object.freeze({
    label: 'Средний чек',
    practiceCodes: Object.freeze(['SALE-02', 'SALE-09', 'SALE-07', 'SALE-10']),
  }),
  revenuePerShift: Object.freeze({
    label: 'Выручка/смену',
    practiceCodes: Object.freeze(['SALE-10', 'SALE-03']),
  }),
});

function libraryMap(library) {
  return new Map((library || []).map(item => [item.code, item]));
}

function buildOnboardingProgress(progressItems, library) {
  const byCode = new Map((progressItems || []).map(item => [item.code, item]));
  const byLibraryCode = libraryMap(library);
  const phases = ONBOARDING_PHASES.map((phase, index) => {
    const completed = phase.codes.filter(code => byCode.get(code)?.completed === true).length;
    const total = phase.codes.length;
    const nextCode = phase.codes.find(code => byCode.get(code)?.completed !== true) || null;
    return {
      id: phase.id,
      title: phase.title,
      index: index + 1,
      completed,
      total,
      percent: Math.round((completed / total) * 100),
      status: completed === total ? 'COMPLETED' : (completed > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'),
      nextCode,
      nextTitle: nextCode ? byLibraryCode.get(nextCode)?.title || nextCode : null,
    };
  });
  const completed = phases.reduce((sum, phase) => sum + phase.completed, 0);
  const total = phases.reduce((sum, phase) => sum + phase.total, 0);
  const active = phases.find(phase => phase.status !== 'COMPLETED') || null;
  const nextCode = active?.nextCode || null;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    certificationReady: total > 0 && completed === total,
    currentPhase: active ? {
      id: active.id,
      title: active.title,
      index: active.index,
    } : null,
    nextModule: nextCode ? {
      code: nextCode,
      title: byLibraryCode.get(nextCode)?.title || nextCode,
      category: byLibraryCode.get(nextCode)?.category || null,
    } : null,
    phases,
  };
}

function certificationWeakModules(attempt, certificationBank, library) {
  if (!attempt || attempt.passed || !attempt.answers) return [];
  const byLibraryCode = libraryMap(library);
  const stats = new Map();
  for (const question of certificationBank || []) {
    const answer = attempt.answers[question.id];
    if (!Number.isInteger(answer)) continue;
    const current = stats.get(question.moduleCode) || { wrong: 0, total: 0 };
    current.total += 1;
    if (answer !== question.correctIndex) current.wrong += 1;
    stats.set(question.moduleCode, current);
  }
  return [...stats.entries()]
    .filter(([, value]) => value.wrong > 0)
    .map(([code, value]) => ({
      code,
      title: byLibraryCode.get(code)?.title || code,
      wrong: value.wrong,
      total: value.total,
    }))
    .sort((left, right) => right.wrong - left.wrong || left.code.localeCompare(right.code));
}

function metricMisses(performanceItem, targets) {
  if (!performanceItem || !targets) return [];
  const pairs = [
    ['itemsPerReceipt', performanceItem.itemsPerReceipt, targets.itemsPerReceipt],
    ['averageCheck', performanceItem.averageCheck, targets.averageCheck],
    ['revenuePerShift', performanceItem.revenuePerShift, targets.shiftRevenue],
  ];
  return pairs
    .filter(([key, actual, target]) =>
      KPI_COACHING_MAP[key] &&
      Number.isFinite(actual) &&
      Number.isFinite(target) &&
      target > 0 &&
      actual < target)
    .map(([key, actual, target]) => ({
      key,
      label: KPI_COACHING_MAP[key].label,
      actual,
      target,
      ratio: actual / target,
      practiceCodes: KPI_COACHING_MAP[key].practiceCodes,
    }))
    .sort((left, right) => left.ratio - right.ratio || left.key.localeCompare(right.key));
}

function firstTask(codes, byCode) {
  for (const code of codes || []) {
    const task = byCode.get(code);
    if (task) return task;
  }
  return null;
}

function buildTodayTrainingRecommendation(options) {
  const {
    onboarding,
    latestAttempt,
    weakModules = [],
    performanceItem,
    targets,
    library,
  } = options;
  const byCode = libraryMap(library);

  if (latestAttempt && latestAttempt.passed === false && weakModules.length) {
    const weak = weakModules[0];
    return {
      kind: 'CERTIFICATION_REVIEW',
      title: 'Повторить: ' + weak.title,
      moduleCode: weak.code,
      reason: 'Последняя аттестация ' + latestAttempt.percent + '%. В теме ' +
        weak.wrong + ' ошиб. из ' + weak.total + '.',
    };
  }

  const miss = metricMisses(performanceItem, targets)[0];
  if (miss) {
    const practice = firstTask(miss.practiceCodes, byCode);
    return {
      kind: 'KPI_COACHING',
      title: practice ? practice.title : 'Отработка: ' + miss.label,
      practiceCode: practice?.code || null,
      metric: {
        key: miss.key,
        label: miss.label,
        actual: miss.actual,
        target: miss.target,
        ratio: miss.ratio,
      },
      reason: 'Показатель «' + miss.label + '» ниже цели — нужна отработка навыка в смене.',
    };
  }

  if (onboarding?.nextModule) {
    return {
      kind: 'ONBOARDING',
      title: onboarding.nextModule.title,
      moduleCode: onboarding.nextModule.code,
      reason: 'Следующая тема маршрута: ' + (onboarding.currentPhase?.title || 'обучение') + '.',
    };
  }

  if (!latestAttempt) {
    return {
      kind: 'CERTIFICATION',
      title: 'Пройти итоговую аттестацию',
      reason: 'Все учебные модули пройдены, итоговая аттестация ещё не проходилась.',
    };
  }

  if (latestAttempt.passed) {
    return {
      kind: 'MAINTENANCE',
      title: 'Поддерживающее обучение',
      reason: 'Аттестация сдана, критичных пробелов по текущим данным нет.',
    };
  }

  return {
    kind: 'REVIEW',
    title: 'Повторить базовые модули',
    reason: 'Аттестация не сдана, но детализация ошибок недоступна.',
  };
}

module.exports = {
  KPI_COACHING_MAP,
  ONBOARDING_PHASES,
  buildOnboardingProgress,
  buildTodayTrainingRecommendation,
  certificationWeakModules,
  metricMisses,
};
