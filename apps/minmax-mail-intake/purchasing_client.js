'use strict';

const crypto = require('node:crypto');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function preview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

class PurchasingHttpError extends Error {
  constructor(stage, status, body) {
    super(`${stage}: HTTP ${status}; body=${preview(body)}`);
    this.name = 'PurchasingHttpError';
    this.code = 'PURCHASING_HTTP_ERROR';
    this.stage = stage;
    this.status = status;
  }
}

class PurchasingClient {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.fetch = dependencies.fetch || fetch;
    this.delay = dependencies.delay || delay;
  }

  async request(path, options = {}, retry = true) {
    let lastError;
    const attempts = retry ? this.config.retryAttempts : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetch(`${this.config.baseUrl}${path}`, {
          ...options,
          headers: {
            accept: 'application/json',
            'x-api-key': this.config.apiToken,
            ...(options.headers || {}),
          },
          signal: options.signal || AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        const text = await response.text();
        if (response.status >= 500 && attempt < attempts) {
          await this.delay(Math.min(1000 * attempt, 5000));
          continue;
        }
        return { response, text, json: (() => {
          try { return JSON.parse(text); } catch { return null; }
        })() };
      } catch (error) {
        lastError = error;
        if (attempt === attempts) throw error;
        await this.delay(Math.min(1000 * attempt, 5000));
      }
    }
    throw lastError;
  }

  async registryRecord(key) {
    const result = await this.request(
      `/api/v1/upload-idempotency/${encodeURIComponent(key)}`
    );
    if (result.response.status === 404) return null;
    if (result.response.status !== 200 || !result.json?.data) {
      throw new PurchasingHttpError('registry GET', result.response.status, result.text);
    }
    return result.json.data;
  }

  async registerFiltered(input) {
    const result = await this.request('/api/v1/upload-idempotency', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotency_key: input.idempotencyKey,
        mailbox: input.mailbox,
        message_uid: input.messageUid,
        attachment_name: input.attachmentName,
        attachment_size: input.attachmentSize,
        sha256: input.sha256,
        state: input.state,
        error_code: input.errorCode,
      }),
    });
    if (![200, 201].includes(result.response.status)) {
      throw new PurchasingHttpError('registry POST', result.response.status, result.text);
    }
    return result.json.data;
  }

  async upload(input) {
    const form = new FormData();
    form.append('file', new Blob([input.content], { type: input.contentType }), input.filename);
    form.append('idempotency_key', input.idempotencyKey);
    form.append('mailbox', input.mailbox);
    form.append('message_uid', input.messageUid);
    const result = await this.request('/api/v1/runs', {
      method: 'POST',
      headers: { 'x-idempotency-key': input.idempotencyKey },
      body: form,
    });
    if (![200, 201].includes(result.response.status) || !result.json?.data?.run_id) {
      throw new PurchasingHttpError('run upload', result.response.status, result.text);
    }
    return {
      runId: result.json.data.run_id,
      replay: result.response.status === 200 &&
        result.json.data.idempotent_replay === true,
      status: result.json.data.status,
    };
  }

  async waitForRun(runId) {
    const deadline = Date.now() + this.config.pollTimeoutMs;
    while (Date.now() < deadline) {
      const result = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}`);
      if (result.response.status !== 200 || !result.json?.data) {
        throw new PurchasingHttpError('run status', result.response.status, result.text);
      }
      if (result.json.data.status === 'completed') return result.json.data;
      if (result.json.data.status === 'failed') {
        const error = new Error(`Purchasing run ${runId} failed.`);
        error.code = 'PURCHASING_RUN_FAILED';
        throw error;
      }
      await this.delay(this.config.pollIntervalMs);
    }
    const error = new Error(`Purchasing run ${runId} timed out.`);
    error.code = 'PURCHASING_RUN_TIMEOUT';
    throw error;
  }

  async verifySourceArtifact(runId, expectedSha256, originalFilename = 'report.xlsx') {
    const listed = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/artifacts`);
    if (listed.response.status !== 200 || !Array.isArray(listed.json?.data?.artifacts)) {
      throw new PurchasingHttpError('artifact list', listed.response.status, listed.text);
    }
    const sourceName = String(originalFilename).toLowerCase().endsWith('.xls')
      ? 'source-report.xls'
      : 'source-report.xlsx';
    const artifact = listed.json.data.artifacts.find(item => item.name === sourceName);
    if (!artifact) throw new Error(`Run ${runId} has no ${sourceName}.`);
    if (String(artifact.sha256).toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(`source-report.xlsx SHA mismatch for run ${runId}.`);
    }
    const downloaded = await this.fetch(
      `${this.config.baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${sourceName}`,
      {
        headers: { 'x-api-key': this.config.apiToken },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      }
    );
    if (downloaded.status !== 200) {
      throw new PurchasingHttpError('artifact download', downloaded.status, await downloaded.text());
    }
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    const downloadedSha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (downloadedSha !== expectedSha256.toLowerCase()) {
      throw new Error(`Downloaded ${sourceName} SHA mismatch for run ${runId}.`);
    }
    return { ...artifact, downloadedSha256: downloadedSha };
  }

  async runSummary(runId) {
    const result = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/summary`);
    if (result.response.status !== 200 || !result.json?.data) {
      throw new PurchasingHttpError('run summary', result.response.status, result.text);
    }
    return result.json.data;
  }

  async markNotification(key) {
    const result = await this.request(
      `/api/v1/upload-idempotency/${encodeURIComponent(key)}/notification`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sent_at: new Date().toISOString() }),
      }
    );
    if (result.response.status !== 200) {
      throw new PurchasingHttpError('notification marker', result.response.status, result.text);
    }
    return result.json.data;
  }
}

module.exports = { PurchasingClient, PurchasingHttpError, preview };
