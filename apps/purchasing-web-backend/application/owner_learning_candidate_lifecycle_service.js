const {
  REASON_CODES,
  appendCandidateLifecycleEvent,
  createCandidateLifecycleEvent,
  getCandidateLifecycleState,
  getCandidateLifecycleStates,
  loadCandidateLifecycle,
  summarizeCandidateLifecycle,
  validateCandidateLifecycleTransition,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_candidate_lifecycle'
);

const UNAVAILABLE_WARNING = 'OWNER_LEARNING_LIFECYCLE_UNAVAILABLE';

class OwnerLearningCandidateLifecycleServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerLearningCandidateLifecycleServiceError';
    this.code = code;
  }
}

function serviceError(code, message, cause) {
  return new OwnerLearningCandidateLifecycleServiceError(
    code,
    message,
    cause ? { cause } : {}
  );
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw serviceError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      'now должен возвращать допустимую дату.'
    );
  }
  return date.toISOString();
}

function candidateSnapshot(candidate) {
  return {
    patternType: candidate.patternType,
    scopeType: candidate.scopeType,
    displayScope: {
      primary: candidate.displayScope?.primary,
      secondary: candidate.displayScope?.secondary ?? null,
    },
    proposedRuleType: candidate.proposedRuleType,
    proposedDecision: candidate.proposedAction?.decision ?? null,
    confidenceScore: candidate.confidence?.score ?? null,
    confidenceLevel: candidate.confidence?.level ?? null,
    priorityScore: candidate.ranking?.priorityScore ?? null,
    priorityLevel: candidate.ranking?.priorityLevel,
    eligibilityStatus: candidate.eligibility?.status,
  };
}

class OwnerLearningCandidateLifecycleService {
  constructor(options = {}) {
    if (!options.lifecycleFilePath) {
      throw new TypeError('Путь к candidate lifecycle обязателен.');
    }
    if (!options.candidatesService) {
      throw new TypeError('Owner Learning Candidates Service обязателен.');
    }
    this.lifecycleFilePath = options.lifecycleFilePath;
    this.candidatesService = options.candidatesService;
    this.logger = options.logger || console;
    this.now = options.now || (() => new Date());
    this.loadLifecycle =
      options.loadLifecycle || loadCandidateLifecycle;
    this.appendEvent =
      options.appendEvent || appendCandidateLifecycleEvent;
    this.createEvent =
      options.createEvent || createCandidateLifecycleEvent;
  }

  readLifecycle() {
    try {
      return this.loadLifecycle({
        filePath: this.lifecycleFilePath,
      });
    } catch (error) {
      if (typeof this.logger?.warn === 'function') {
        this.logger.warn(
          '[OWNER_LEARNING_LIFECYCLE_UNAVAILABLE] ' +
          'Candidate lifecycle недоступен.'
        );
      }
      throw serviceError(
        UNAVAILABLE_WARNING,
        'Candidate lifecycle временно недоступен.',
        error
      );
    }
  }

  getCandidateStates() {
    const lifecycle = this.readLifecycle();
    return {
      summary: summarizeCandidateLifecycle(lifecycle),
      states: getCandidateLifecycleStates({ lifecycle }),
    };
  }

  getCandidateState({ candidateId } = {}) {
    const lifecycle = this.readLifecycle();
    return getCandidateLifecycleState({
      lifecycle,
      candidateId,
    });
  }

  currentCandidate(candidateId) {
    const result = this.candidatesService.getCandidates();
    if (result.status !== 'AVAILABLE') {
      throw serviceError(
        'CANDIDATE_NOT_AVAILABLE',
        'Кандидат больше не доступен в текущей истории.'
      );
    }
    const candidate = result.candidates.find(
      value => value.candidateId === candidateId
    );
    if (!candidate) {
      throw serviceError(
        'CANDIDATE_NOT_AVAILABLE',
        'Кандидат больше не доступен в текущей истории.'
      );
    }
    return candidate;
  }

  changeCandidateStatus({
    candidateId,
    targetStatus,
    action,
    reasonCode = 'NOT_SPECIFIED',
    ownerComment = null,
  } = {}) {
    const candidate = this.currentCandidate(candidateId);
    const lifecycle = this.readLifecycle();
    const current = getCandidateLifecycleState({
      lifecycle,
      candidateId,
    });
    if (
      current.lastEvent &&
      current.status === targetStatus &&
      current.lastAction === action &&
      current.reasonCode === reasonCode
    ) {
      return {
        state: current,
        event: current.lastEvent,
        added: false,
      };
    }
    if (
      ['REJECTED', 'POSTPONED'].includes(targetStatus) &&
      (
        !REASON_CODES.includes(reasonCode) ||
        reasonCode === 'NOT_SPECIFIED'
      )
    ) {
      throw serviceError(
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
        'Для отклонения или переноса необходимо указать причину.'
      );
    }
    validateCandidateLifecycleTransition({
      fromStatus: current.status,
      toStatus: targetStatus,
      action,
    });
    const event = this.createEvent({
      recordedAt: isoNow(this.now),
      candidateId,
      fromStatus: current.status,
      toStatus: targetStatus,
      action,
      actor: 'OWNER',
      reasonCode,
      ownerComment,
      candidateSnapshot: candidateSnapshot(candidate),
      metadata: { source: 'PURCHASING_WEB' },
    });
    const appended = this.appendEvent({
      filePath: this.lifecycleFilePath,
      event,
    });
    return {
      state: getCandidateLifecycleState({
        lifecycle: appended.lifecycle,
        candidateId,
      }),
      event: appended.event,
      added: appended.added,
    };
  }
}

module.exports = {
  UNAVAILABLE_WARNING,
  OwnerLearningCandidateLifecycleService,
  OwnerLearningCandidateLifecycleServiceError,
  candidateSnapshot,
};
