'use strict';

const { main: deploy } = require('./deploy-minmax-workflow');
const { main: inspect } = require('./inspect-minmax-execution');

async function main(
  argv = process.argv.slice(2),
  environment = process.env,
  logger = console
) {
  const deployment = await deploy(environment, logger);
  const inspection = await inspect(argv, environment, logger);
  logger.log(
    `[PASS] MinMax deploy, semantic verify and execution registry replay ` +
    `completed for workflow ${deployment.workflowId}.`
  );
  return { deployment, inspection };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
