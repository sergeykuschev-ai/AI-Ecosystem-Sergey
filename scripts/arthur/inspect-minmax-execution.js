'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  runTrackedContainerProbe,
} = require('../purchasing/container-probe-runner');

const {
  DEFAULT_WORKFLOW_ID,
  N8nApiClient,
  requiredEnvironment,
} = require('./minmax-n8n-workflow-deployment');

const CHECK_NODE_ID = 'check-registry';
const CHECK_NODE_NAME = 'Проверить реестр';
const CONFIG_NODE_NAME = 'Конфигурация MinMax';
const DEFAULT_ARTHUR_CREDENTIAL_ID = 'pjXec1bxtt81cy0u';
const N8N_HTTP_GET_PROBE_PATH = path.join(
  __dirname,
  '../purchasing/probes/n8n-http-get-probe.js'
);
const N8N_HTTP_GET_CONTAINER_PATH = '/tmp/minmax-n8n-http-get-probe.js';

function parseArguments(argv, environment = process.env) {
  const options = {
    executionId: environment.MINMAX_EXECUTION_ID || '',
    container: environment.N8N_CONTAINER_NAME || '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument ${name || '(empty)'}.`);
    }
    if (name === '--execution-id') options.executionId = value;
    else if (name === '--n8n-container') options.container = value;
    else throw new Error(`Unknown argument ${name}.`);
    index += 1;
  }
  if (!String(options.executionId).trim()) {
    throw new Error(
      'Execution id is required: use --execution-id <id> or ' +
      'MINMAX_EXECUTION_ID.'
    );
  }
  if (!String(options.container).trim()) {
    throw new Error(
      'n8n container is required: use --n8n-container <name> or ' +
      'N8N_CONTAINER_NAME.'
    );
  }
  return {
    executionId: String(options.executionId).trim(),
    container: String(options.container).trim(),
  };
}

function inspectorConfig(argv, environment = process.env) {
  const argumentsConfig = parseArguments(argv, environment);
  return {
    ...argumentsConfig,
    baseUrl: requiredEnvironment('N8N_BASE_URL', environment),
    n8nApiKey: requiredEnvironment('N8N_API_KEY', environment),
    workflowId: String(
      environment.N8N_MINMAX_WORKFLOW_ID || DEFAULT_WORKFLOW_ID
    ).trim(),
    credentialId: requiredEnvironment(
      'N8N_ARTHUR_CREDENTIAL_ID',
      environment
    ),
    expectedCredentialId: String(
      environment.N8N_EXPECTED_ARTHUR_CREDENTIAL_ID ||
      DEFAULT_ARTHUR_CREDENTIAL_ID
    ).trim(),
    purchasingApiToken: requiredEnvironment(
      'PURCHASING_API_TOKEN',
      environment
    ),
  };
}

function executionWorkflowData(execution) {
  return execution.workflowData || execution.data?.workflowData || {};
}

function executionRunData(execution) {
  return execution.data?.resultData?.runData || execution.data?.runData || {};
}

function latestRun(runData, nodeName) {
  const runs = runData[nodeName] || [];
  return runs[runs.length - 1] || null;
}

function outputItems(run, outputIndex = 0) {
  return run?.data?.main?.[outputIndex] || [];
}

function checkNodeInput(execution) {
  const runData = executionRunData(execution);
  const checkRun = latestRun(runData, CHECK_NODE_NAME);
  const source = checkRun?.source?.[0] || {};
  const previousNode = source.previousNode || 'Письмо подходит?';
  const previousRuns = runData[previousNode] || [];
  const previousRun = previousRuns[
    source.previousNodeRun ?? previousRuns.length - 1
  ];
  const items = outputItems(previousRun, source.previousNodeOutput ?? 0);
  const itemIndex = Number(checkRun?.error?.itemIndex || 0);
  return {
    checkRun,
    input: items[itemIndex] || items[0] || null,
    previousNode,
  };
}

function configFromExecution(execution) {
  const configRun = latestRun(executionRunData(execution), CONFIG_NODE_NAME);
  return outputItems(configRun)[0]?.json?.config || null;
}

function findNestedValue(value, keys, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findNestedValue(child, keys, depth + 1, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function executionHttpEvidence(checkRun) {
  const error = checkRun?.error || {};
  const headers = findNestedValue(error, ['headers', 'responseHeaders']);
  const body = findNestedValue(error, [
    'body',
    'responseBody',
    'rawBody',
  ]);
  const statusValue = findNestedValue(error, [
    'statusCode',
    'status',
    'httpCode',
  ]);
  const status = Number(statusValue);
  const normalizedHeaders = headers && typeof headers === 'object'
    ? headers
    : {};
  return {
    status: Number.isFinite(status) ? status : null,
    headers: normalizedHeaders,
    contentType: normalizedHeaders['content-type'] ||
      normalizedHeaders['Content-Type'] || null,
    body: body === undefined ? null : String(body),
    errorMessage: error.message || null,
    errorDescription: error.description || null,
    underlyingCause: error.cause || null,
  };
}

function computedRegistryRequest(execution) {
  const workflow = executionWorkflowData(execution);
  const node = (workflow.nodes || []).find(candidate =>
    candidate.id === CHECK_NODE_ID || candidate.name === CHECK_NODE_NAME
  );
  if (!node) throw new Error(`${CHECK_NODE_NAME} is absent from execution.`);
  const { checkRun, input, previousNode } = checkNodeInput(execution);
  const config = configFromExecution(execution);
  const apiBaseUrl = String(config?.apiBaseUrl || '').replace(/\/$/, '');
  const idempotencyKey = input?.json?.idempotencyKey;
  if (!apiBaseUrl) {
    throw new Error('Execution input does not contain config.apiBaseUrl.');
  }
  if (!idempotencyKey) {
    throw new Error('Execution input does not contain idempotencyKey.');
  }
  return {
    node,
    checkRun,
    input,
    previousNode,
    idempotencyKey: String(idempotencyKey),
    url: `${apiBaseUrl}/api/v1/upload-idempotency/${idempotencyKey}`,
    method: node.parameters?.method || 'GET',
    credential: node.credentials?.httpHeaderAuth || null,
    responseFormat:
      node.parameters?.options?.response?.response?.responseFormat || null,
    accept: (node.parameters?.headerParameters?.parameters || []).find(
      header => String(header.name).toLowerCase() === 'accept'
    )?.value || null,
    nodeContract: {
      urlExpression: node.parameters?.url || null,
      sendHeaders: node.parameters?.sendHeaders === true,
      authentication: node.parameters?.authentication || null,
      genericAuthType: node.parameters?.genericAuthType || null,
      neverError:
        node.parameters?.options?.response?.response?.neverError === true,
      fullResponse:
        node.parameters?.options?.response?.response?.fullResponse ?? false,
      includeHeaders:
        node.parameters?.options?.response?.response
          ?.includeResponseHeaders ?? false,
      retryOnFail: node.retryOnFail === true,
      maxTries: node.maxTries ?? node.maxRetries ?? 1,
      waitBetweenTries:
        node.waitBetweenTries ?? node.waitBetweenRetries ?? 0,
      followRedirects:
        node.parameters?.options?.redirect?.redirect?.followRedirects ?? true,
      maxRedirects:
        node.parameters?.options?.redirect?.redirect?.maxRedirects ?? null,
      encoding: node.parameters?.options?.encoding || 'utf8',
      timeout: node.parameters?.options?.timeout ?? null,
    },
  };
}

function safeBodyPreview(value, secrets = []) {
  let preview = String(value || '').replace(/[\r\n\t]+/g, ' ');
  for (const secret of secrets.filter(Boolean)) {
    preview = preview.split(String(secret)).join('[REDACTED]');
  }
  return preview
    .replace(/("(?:token|apiKey|api_key)"\s*:\s*")[^"]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

function replayFromContainer(options, dependencies = {}) {
  const runProbe = dependencies.runTrackedContainerProbe ||
    runTrackedContainerProbe;
  const result = runProbe({
    container: options.container,
    hostPath: N8N_HTTP_GET_PROBE_PATH,
    containerPath: N8N_HTTP_GET_CONTAINER_PATH,
    environment: {
      MINMAX_INSPECT_API_KEY: options.apiToken,
      MINMAX_PROBE_URL: options.url,
    },
  }, {
    spawn: dependencies.spawn || spawnSync,
  });
  const response = JSON.parse(result.stdout);
  const contentType = response.headers?.['content-type'] || '';
  let json = null;
  try { json = JSON.parse(response.body); } catch {}
  return { ...response, contentType, json };
}

function executionClassification(execution, workflowRecord) {
  const workflow = executionWorkflowData(execution);
  const versionId = workflow.versionId || execution.workflowVersionId || null;
  const activeVersionId = workflowRecord.activeVersion?.versionId ||
    workflowRecord.activeVersionId || null;
  const productionMode = ['trigger', 'webhook'].includes(execution.mode);
  return {
    mode: execution.mode || null,
    executionWorkflowName: workflow.name || null,
    versionId,
    activeVersionId,
    draftVersionId: workflowRecord.versionId || null,
    isProductionTrigger: productionMode,
    usesPublishedVersion: Boolean(versionId && versionId === activeVersionId),
    isAutosaveLabel: /autosave/i.test(String(
      workflow.versionName || execution.versionName || workflow.name || ''
    )),
  };
}

function determineCause(context) {
  const { evidence, replay, classification } = context;
  if (classification.versionId && !classification.usesPublishedVersion) {
    return `execution used version ${classification.versionId}, not published ` +
      `${classification.activeVersionId}`;
  }
  if (classification.mode === 'manual') {
    return 'execution mode is manual/editor, not production trigger';
  }
  if (evidence.body !== null) {
    try {
      JSON.parse(evidence.body);
    } catch {
      return 'execution response body itself is not valid JSON';
    }
  }
  if (!/^application\/json(?:;|$)/i.test(replay.contentType)) {
    return `same URL currently returns non-JSON content-type ${replay.contentType || '(empty)'}`;
  }
  if (replay.json === null) return 'same URL currently returns an invalid JSON body';
  return 'n8n discarded the historical raw response during JSON parse failure; ' +
    'the exact replay now returns valid JSON, so the failure was transient or ' +
    'came from a different execution runtime/network target';
}

async function inspectExecution(options, dependencies = {}) {
  const client = dependencies.client || new N8nApiClient({
    baseUrl: options.baseUrl,
    apiKey: options.n8nApiKey,
  });
  const execution = await client.request(
    'GET',
    `/executions/${encodeURIComponent(options.executionId)}` +
      '?includeData=true&ignoreDataSizeLimit=true&redactExecutionData=false'
  );
  if (String(execution.workflowId) !== String(options.workflowId)) {
    throw new Error(
      `Execution ${options.executionId} belongs to workflow ` +
      `${execution.workflowId}, expected ${options.workflowId}.`
    );
  }
  const workflowRecord = await client.getWorkflow(options.workflowId);
  const request = computedRegistryRequest(execution);
  const credential = await client.request(
    'GET',
    `/credentials/${encodeURIComponent(request.credential?.id || '')}`
  );
  if (request.credential?.id !== options.credentialId ||
      credential.id !== options.credentialId) {
    throw new Error(
      `Execution credential id=${request.credential?.id || '(missing)'}, ` +
      `metadata id=${credential.id || '(missing)'}, env=${options.credentialId}.`
    );
  }
  if (options.credentialId !== options.expectedCredentialId) {
    throw new Error(
      `Arthur credential id=${options.credentialId}, expected ` +
      `${options.expectedCredentialId}.`
    );
  }
  if (credential.type !== 'httpHeaderAuth') {
    throw new Error(
      `Arthur credential type=${credential.type}, expected httpHeaderAuth.`
    );
  }
  if (request.accept !== 'application/json' || request.responseFormat !== 'json') {
    throw new Error(
      `${CHECK_NODE_NAME} contract differs: Accept=${request.accept}; ` +
      `responseFormat=${request.responseFormat}.`
    );
  }
  const evidence = executionHttpEvidence(request.checkRun);
  const classification = executionClassification(execution, workflowRecord);
  const replay = (dependencies.replay || replayFromContainer)({
    container: options.container,
    url: request.url,
    apiToken: options.purchasingApiToken,
  });
  const result = {
    execution,
    workflowRecord,
    request,
    credential: {
      id: credential.id,
      name: credential.name,
      type: credential.type,
    },
    evidence,
    classification,
    replay,
  };
  result.cause = determineCause(result);
  return result;
}

function printInspection(result, logger = console, secrets = []) {
  const { classification, request, credential, evidence, replay } = result;
  logger.log(
    `[INFO] execution id=${result.execution.id}; ` +
    `workflowId=${result.execution.workflowId}; ` +
    `status=${result.execution.status || '(missing)'}`
  );
  logger.log(`[INFO] execution mode=${classification.mode}`);
  logger.log(
    `[INFO] execution versionId=${classification.versionId}; ` +
    `activeVersionId=${classification.activeVersionId}; ` +
    `draftVersionId=${classification.draftVersionId}`
  );
  logger.log(
    `[INFO] productionTrigger=${classification.isProductionTrigger}; ` +
    `publishedVersion=${classification.usesPublishedVersion}; ` +
    `autosaveLabel=${classification.isAutosaveLabel}`
  );
  logger.log(`[INFO] computed URL=${request.url}`);
  logger.log(`[INFO] idempotency key=${request.idempotencyKey}`);
  logger.log(`[INFO] input source node=${request.previousNode}`);
  logger.log(`[INFO] executed node contract=${JSON.stringify(request.nodeContract)}`);
  logger.log(
    `[INFO] credential id=${credential.id}; type=${credential.type}; ` +
    `name=${credential.name}`
  );
  logger.log(
    `[INFO] execution HTTP status=${evidence.status ?? '(not retained)'}; ` +
    `content-type=${evidence.contentType || '(not retained)'}; raw body=` +
    `${safeBodyPreview(evidence.body, secrets) || '(not retained)'}`
  );
  logger.log(
    `[INFO] container replay status=${replay.status}; ` +
    `content-type=${replay.contentType || '(empty)'}; body=` +
    safeBodyPreview(replay.body, secrets)
  );
  logger.log(`[INFO] execution error=${evidence.errorMessage || '(none)'}`);
  logger.log(
    `[INFO] execution description=${evidence.errorDescription || '(none)'}; ` +
    `cause=${safeBodyPreview(
      typeof evidence.underlyingCause === 'string'
        ? evidence.underlyingCause
        : JSON.stringify(evidence.underlyingCause || ''),
      secrets
    ) || '(none)'}`
  );
  logger.log(`[RESULT] exact cause=${result.cause}`);
  if (!/^application\/json(?:;|$)/i.test(replay.contentType) || replay.json === null) {
    throw new Error('Exact container replay is not a JSON response.');
  }
  logger.log('[PASS] Exact registry GET from n8n container returned JSON.');
}

async function main(
  argv = process.argv.slice(2),
  environment = process.env,
  logger = console
) {
  const options = inspectorConfig(argv, environment);
  const result = await inspectExecution(options);
  printInspection(result, logger, [options.purchasingApiToken]);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  checkNodeInput,
  computedRegistryRequest,
  determineCause,
  executionClassification,
  executionHttpEvidence,
  executionRunData,
  executionWorkflowData,
  inspectExecution,
  inspectorConfig,
  main,
  parseArguments,
  printInspection,
  replayFromContainer,
  safeBodyPreview,
};
