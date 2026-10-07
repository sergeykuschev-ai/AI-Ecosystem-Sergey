'use strict';

const http = require('node:http');

function healthPayload(config, state) {
  return {
    status: state.lastError && !state.lastSuccessfulRunId ? 'degraded' : 'ok',
    service: 'minmax-direct-mail-intake',
    build_sha: config.buildSha,
    allowed_sender: config.allowedSender,
    subject_pattern: config.subjectPattern,
    imap_connected: state.imapConnected,
    last_poll_time: state.lastPollAt,
    last_processed_uid: state.lastProcessedUid,
    last_successful_run_id: state.lastSuccessfulRunId,
    last_error: state.lastError,
    event_count: state.eventCount,
    last_event: state.lastEvent,
  };
}

function eventForMessageUid(state, messageUid) {
  if (!messageUid) return state.lastEvent;
  const events = Array.isArray(state.recentEvents) ? state.recentEvents : [];
  return [...events].reverse().find(candidate =>
    String(candidate.messageUid) === String(messageUid)
  ) || null;
}

function createHealthServer(config, state) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET' || !['/health', '/events/latest'].includes(url.pathname)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'ROUTE_NOT_FOUND' } }));
      return;
    }
    const messageUid = url.searchParams.get('messageUid');
    const event = eventForMessageUid(state, messageUid);
    const body = url.pathname === '/health'
      ? healthPayload(config, state)
      : { event };
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
  });
}

module.exports = { createHealthServer, eventForMessageUid, healthPayload };
