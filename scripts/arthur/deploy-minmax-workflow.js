'use strict';

const {
  deployWorkflow,
  deploymentConfig,
  printVerification,
} = require('./minmax-n8n-workflow-deployment');

async function main(environment = process.env, logger = console) {
  const result = await deployWorkflow(deploymentConfig(environment));
  logger.log(
    `[PASS] ${result.action} workflow ${result.workflowId}; ` +
    `published version ${result.publishedVersionId}`
  );
  if (result.archivedDuplicateIds.length > 0) {
    logger.log(
      `[PASS] deactivated and archived duplicates: ` +
      result.archivedDuplicateIds.join(',')
    );
  }
  printVerification(result.verification, logger);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
