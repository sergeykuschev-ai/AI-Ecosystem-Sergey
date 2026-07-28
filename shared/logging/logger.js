'use strict';

function messageText(message) {
  if (message === undefined) return '';
  if (message instanceof Error) return message.message;
  return String(message);
}

function createLogger(component) {
  if (typeof component !== 'string' || component.trim() === '') {
    throw new TypeError('component должен быть непустой строкой.');
  }

  const normalizedComponent = component.trim();
  const write = (consoleMethod, level, message) => {
    console[consoleMethod](JSON.stringify({
      timestamp: new Date().toISOString(),
      component: normalizedComponent,
      level,
      message: messageText(message),
    }));
  };

  return Object.freeze({
    info: message => write('info', 'info', message),
    warn: message => write('warn', 'warn', message),
    error: message => write('error', 'error', message),
    debug: message => write('debug', 'debug', message),
  });
}

module.exports = {
  createLogger,
};
