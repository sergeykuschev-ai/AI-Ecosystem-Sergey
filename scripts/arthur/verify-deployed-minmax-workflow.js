'use strict';

const {
  deploymentConfig,
  printVerification,
  verifyDeployedWorkflow,
} = require('./minmax-n8n-workflow-deployment');

async function main(environment = process.env, logger = console) {
  const result = await verifyDeployedWorkflow(deploymentConfig(environment));
  printVerification(result, logger);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
