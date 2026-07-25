const {
  loadDecisionHistory,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history'
);
const {
  analyzeOwnerDecisionHistory,
} = require(
  '../../../agents/purchasing/owner_learning/owner_decision_history_analytics'
);
const {
  evaluateAllPatternConfidences,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_confidence'
);
const {
  buildAndRankRuleCandidates,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_candidate_ranking'
);
const {
  buildCandidateExplanations,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_explanations'
);
const {
  getCandidateLifecycleState,
  loadCandidateLifecycle,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);
const {
  mapOwnerLearningCandidate,
} = require('../dto/owner_learning_candidates_mapper');

const UNAVAILABLE_WARNING =
  'OWNER_LEARNING_CANDIDATES_UNAVAILABLE';

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('now должен возвращать допустимую дату.');
  }
  return date.toISOString();
}

function summarize(candidates, analytics = {}) {
  const summary = {
    totalCandidates: candidates.length,
    historyEntries: Number.isInteger(
      analytics.population?.filteredEntries
    )
      ? analytics.population.filteredEntries
      : 0,
    patternsFound: Array.isArray(analytics.repeatedDecisionPatterns)
      ? analytics.repeatedDecisionPatterns.length
      : 0,
    eligible: 0,
    reviewOnly: 0,
    ineligible: 0,
    highPriority: 0,
    criticalPriority: 0,
    confidenceLevels: {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      VERY_HIGH: 0,
    },
  };
  for (const candidate of candidates) {
    if (candidate.eligibility.status === 'ELIGIBLE') {
      summary.eligible += 1;
    } else if (candidate.eligibility.status === 'REVIEW_ONLY') {
      summary.reviewOnly += 1;
    } else if (candidate.eligibility.status === 'INELIGIBLE') {
      summary.ineligible += 1;
    }
    if (candidate.ranking.priorityLevel === 'HIGH') {
      summary.highPriority += 1;
    } else if (candidate.ranking.priorityLevel === 'CRITICAL') {
      summary.criticalPriority += 1;
    }
    const level = candidate.confidence.level;
    if (Object.hasOwn(summary.confidenceLevels, level)) {
      summary.confidenceLevels[level] += 1;
    }
  }
  return summary;
}

class OwnerLearningCandidatesService {
  constructor(options = {}) {
    if (!options.historyFilePath) {
      throw new TypeError('Путь к Owner Decision History обязателен.');
    }
    this.historyFilePath = options.historyFilePath;
    this.lifecycleFilePath =
      options.lifecycleFilePath || null;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.loadHistory = options.loadHistory || loadDecisionHistory;
    this.analyzeHistory =
      options.analyzeHistory || analyzeOwnerDecisionHistory;
    this.evaluateConfidences =
      options.evaluateConfidences ||
      evaluateAllPatternConfidences;
    this.buildAndRankCandidates =
      options.buildAndRankCandidates ||
      buildAndRankRuleCandidates;
    this.buildExplanations =
      options.buildExplanations || buildCandidateExplanations;
    this.mapCandidate =
      options.mapCandidate || mapOwnerLearningCandidate;
    this.loadLifecycle =
      options.loadLifecycle || loadCandidateLifecycle;
  }

  lifecycleForCandidates(candidates) {
    const newState = candidate => ({
      ...candidate,
      lifecycle: {
        status: 'NEW',
        lastAction: null,
        lastRecordedAt: null,
        reasonCode: null,
      },
    });
    if (!this.lifecycleFilePath) {
      return {
        candidates: candidates.map(newState),
        warning: null,
      };
    }
    try {
      const lifecycle = this.loadLifecycle({
        filePath: this.lifecycleFilePath,
      });
      return {
        candidates: candidates.map(candidate => {
          const state = getCandidateLifecycleState({
            lifecycle,
            candidateId: candidate.candidateId,
          });
          return {
            ...candidate,
            lifecycle: {
              status: state.status,
              lastAction: state.lastAction,
              lastRecordedAt: state.lastRecordedAt,
              reasonCode: state.reasonCode,
            },
          };
        }),
        warning: null,
      };
    } catch {
      if (typeof this.logger?.warn === 'function') {
        this.logger.warn(
          '[OWNER_LEARNING_LIFECYCLE_UNAVAILABLE] ' +
          'Lifecycle-контекст кандидатов недоступен.'
        );
      }
      return {
        candidates: candidates.map(newState),
        warning: 'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE',
      };
    }
  }

  getCandidates({
    filters = {},
    analyticsOptions = {},
    confidenceOptions = {},
    rankingOptions = {},
  } = {}) {
    try {
      const generatedAt = confidenceOptions.asOf || isoNow(this.now);
      const history = this.loadHistory({
        filePath: this.historyFilePath,
        logger: { error() {} },
      });
      const analytics = this.analyzeHistory({
        history,
        filters,
        options: {
          ...analyticsOptions,
          generatedAt,
        },
      });
      const confidenceEvaluations = this.evaluateConfidences({
        analytics,
        history,
        options: {
          ...confidenceOptions,
          asOf: generatedAt,
        },
      });
      const candidates = this.buildAndRankCandidates({
        analytics,
        confidenceEvaluations,
        history: history.entries,
        options: rankingOptions,
      });
      const explanations = this.buildExplanations(candidates);
      if (explanations.length !== candidates.length) {
        throw new Error('Candidate explanations count mismatch.');
      }
      const safeCandidates = candidates.map((candidate, index) =>
        this.mapCandidate(
          candidate,
          explanations[index],
          analytics
        )
      );
      const lifecycleResult =
        this.lifecycleForCandidates(safeCandidates);
      return {
        status: 'AVAILABLE',
        generatedAt,
        summary: summarize(
          lifecycleResult.candidates,
          analytics
        ),
        candidates: lifecycleResult.candidates,
        warning: null,
        lifecycleWarning: lifecycleResult.warning,
      };
    } catch {
      if (typeof this.logger?.warn === 'function') {
        this.logger.warn(
          '[OWNER_LEARNING_CANDIDATES_UNAVAILABLE] ' +
          'Кандидаты для обучения недоступны.'
        );
      }
      return {
        status: 'UNAVAILABLE',
        generatedAt: null,
        summary: null,
        candidates: [],
        warning: UNAVAILABLE_WARNING,
      };
    }
  }
}

module.exports = {
  UNAVAILABLE_WARNING,
  OwnerLearningCandidatesService,
  summarize,
};
