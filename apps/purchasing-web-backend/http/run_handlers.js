const crypto = require('node:crypto');

const {
  runOrderAgentFromSmartZapasXlsxWithDemand,
} = require('../../../agents/purchasing/order_agent');
const {
  buildMatrixDraftFromSmartZapasXlsx,
} = require(
  '../../../agents/purchasing/matrix_builder/matrix_builder'
);
const {
  DEFAULT_SERVER_PATHS,
  DEFAULT_UPLOAD_ROOT,
} = require('../config');
const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  cleanupUploadDirectory,
  parseExcelUpload,
} = require('./upload_handler');
const { streamArtifact } = require('./artifact_handler');
const { HttpError } = require('./responses');

function reportDateDependencies(reportDate) {
  if (!reportDate) return {};
  return {
    runAgent: (inputPath, phase2Inputs, options) =>
      runOrderAgentFromSmartZapasXlsxWithDemand(
        inputPath,
        phase2Inputs,
        { ...options, reportDate }
      ),
    buildMatrix: (inputPath, options) =>
      buildMatrixDraftFromSmartZapasXlsx(inputPath, {
        ...options,
        reportDate,
      }),
  };
}

function orchestrationHttpError(error) {
  if (error?.code === 'INVALID_RUN_REQUEST') {
    return new HttpError(
      'INPUT_CONTRACT_ERROR',
      'Входные параметры run не соответствуют контракту.',
      { cause: error }
    );
  }
  if (error?.code === 'PURCHASING_RUN_FAILED') {
    const causeText = String(error.cause?.message || '');
    const inputContract = /required|обязательн|column|колонк/i.test(causeText);
    return new HttpError(
      inputContract ? 'INPUT_CONTRACT_ERROR' : 'INVALID_WORKBOOK',
      inputContract
        ? 'Excel-файл не соответствует входному контракту SmartZapas.'
        : 'Excel-файл не удалось прочитать как отчёт SmartZapas.',
      { cause: error }
    );
  }
  return error;
}

function createRunHandlers(options) {
  const {
    registry,
    queryService,
    orchestrator = runPurchasingWebOrchestrator,
    uploadRoot = DEFAULT_UPLOAD_ROOT,
    serverPaths = DEFAULT_SERVER_PATHS,
    uuid = crypto.randomUUID,
    now = () => new Date().toISOString(),
    uploadOptions = {},
  } = options;

  if (!registry || !queryService) {
    throw new TypeError('Registry и query service обязательны.');
  }

  return {
    async createRun(request, context) {
      let upload = null;
      let runId = null;
      let processingCreated = false;
      try {
        upload = await parseExcelUpload(request, {
          ...uploadOptions,
          uploadRoot,
          requestId: context.requestId,
        });
        runId = uuid();
        const generatedAt = now();
        registry.createProcessingRun({
          runId,
          createdAt: generatedAt,
          startedAt: generatedAt,
          stage: 'purchasing',
          source: {
            original_name: upload.originalName,
            size_bytes: upload.sizeBytes,
            sha256: upload.sha256,
          },
        });
        processingCreated = true;

        const bundle = await orchestrator({
          runId,
          inputPath: upload.inputPath,
          generatedAt,
          financialDataPath: serverPaths.financialDataPath,
          configPath: serverPaths.configPath,
          matrixPath: serverPaths.matrixPath,
          ownerDecisionsPath: serverPaths.ownerDecisionsPath,
          recommendationConfigPath:
            serverPaths.recommendationConfigPath,
        }, reportDateDependencies(upload.reportDate));
        const saved = registry.saveCompletedRun(bundle, {
          completedAt: now(),
        });
        return {
          statusCode: 201,
          headers: {
            Location: `/api/v1/runs/${runId}`,
          },
          data: saved.status,
          runId,
        };
      } catch (rawError) {
        const error = orchestrationHttpError(rawError);
        if (processingCreated) {
          try {
            registry.saveFailedRun(runId, error, {
              stage: 'failed',
              completedAt: now(),
              requestId: context.requestId,
            });
          } catch (storageError) {
            throw new HttpError(
              'STORAGE_ERROR',
              'Не удалось сохранить ошибку run.',
              { cause: storageError }
            );
          }
        }
        throw Object.assign(error, { runId });
      } finally {
        if (upload?.cleanup) upload.cleanup();
        else cleanupUploadDirectory(uploadRoot, context.requestId);
      }
    },

    getRunStatus(runId) {
      return {
        statusCode: 200,
        data: queryService.getRunStatus(runId),
        runId,
      };
    },

    getRunSummary(runId) {
      return {
        statusCode: 200,
        data: queryService.getRunSummary(runId),
        runId,
      };
    },

    listItems(runId, query) {
      return {
        statusCode: 200,
        data: queryService.listItems(runId, query),
        runId,
      };
    },

    getOwnerReview(runId, query) {
      return {
        statusCode: 200,
        data: queryService.getOwnerReview(runId, query),
        runId,
      };
    },

    async downloadArtifact(runId, rawArtifactName, response) {
      await streamArtifact({
        artifactStore: registry.artifactStore,
        queryService,
        response,
        runId,
        rawArtifactName,
      });
      return { streamed: true, runId };
    },
  };
}

module.exports = {
  createRunHandlers,
  orchestrationHttpError,
  reportDateDependencies,
};
