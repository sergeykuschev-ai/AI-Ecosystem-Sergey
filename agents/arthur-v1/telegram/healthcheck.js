'use strict';

const http = require('node:http');
const { createLogger } = require('../logging/logger');

function createHealthServer(gateway, port, logger) {
  const log = logger || createLogger();

  const server = http.createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const health = gateway.getHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;

    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(health));
  });

  server.on('error', (error) => {
    log.error('health_server_error', null, {
      errorCode: error.code || error.name,
      errorMessage: error.message,
    });
  });

  server.listen(port, () => {
    log.info('health_server_started', null, { port });
  });

  return server;
}

module.exports = {
  createHealthServer,
};
