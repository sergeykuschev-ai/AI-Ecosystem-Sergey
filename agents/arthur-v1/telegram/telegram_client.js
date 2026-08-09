'use strict';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

class TelegramClientError extends Error {
  constructor(message, { code, status, responseBody } = {}) {
    super(message);
    this.name = 'TelegramClientError';
    this.code = code || 'TELEGRAM_CLIENT_ERROR';
    this.status = status || null;
    this.responseBody = responseBody || null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createTelegramClient({ token, apiBaseUrl, timeoutMs, maxRetries, retryDelayMs, logger }) {
  const baseUrl = `${apiBaseUrl}/bot${token}`;

  async function call(method, payload = {}, options = {}) {
    const url = `${baseUrl}/${method}`;
    const attemptTimeoutMs = options.timeoutMs ?? timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attempts = (options.maxRetries ?? maxRetries ?? DEFAULT_MAX_RETRIES) + 1;
    const baseDelayMs = options.retryDelayMs ?? retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    const body = JSON.stringify(payload);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        let result = null;
        try {
          result = await response.json();
        } catch {
          // Telegram sometimes returns empty body; treat non-ok as error.
        }

        if (!response.ok) {
          throw new TelegramClientError(`Telegram HTTP ${response.status}`, {
            code: 'TELEGRAM_HTTP_ERROR',
            status: response.status,
            responseBody: result,
          });
        }

        if (result && result.ok === false) {
          throw new TelegramClientError(result.description || 'Telegram API error', {
            code: result.error_code ? `TELEGRAM_API_${result.error_code}` : 'TELEGRAM_API_ERROR',
            status: response.status,
            responseBody: result,
          });
        }

        return result;
      } catch (error) {
        clearTimeout(timer);
        const isRetryable = error.name === 'AbortError' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'FETCH_ERROR' ||
          (error.status >= 500 && error.status < 600);

        if (!isRetryable || attempt >= attempts) {
          if (error.name === 'AbortError') {
            throw new TelegramClientError('Telegram API request timed out', { code: 'TELEGRAM_TIMEOUT' });
          }
          throw error;
        }

        if (logger) {
          logger.warn('telegram_api_retry', null, {
            method,
            attempt,
            maxAttempts: attempts,
            errorCode: error.code || error.name,
            errorMessage: error.message,
          });
        }

        await delay(baseDelayMs * Math.pow(2, attempt - 1));
      }
    }

    throw new TelegramClientError('Telegram API call failed after retries', { code: 'TELEGRAM_MAX_RETRIES' });
  }

  async function getUpdates(offset, limit = 100, pollTimeoutMs = 30000) {
    return call('getUpdates', {
      offset,
      limit,
      timeout: Math.min(Math.max(Math.floor(pollTimeoutMs / 1000), 1), 120),
    }, {
      timeoutMs: pollTimeoutMs + 5000,
      maxRetries: 0, // Long polling should not retry internally; the outer loop will restart.
    });
  }

  async function sendMessage(chatId, text, options = {}) {
    const payload = {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: true,
    };

    if (options.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }

    return call('sendMessage', payload);
  }

  return {
    call,
    getUpdates,
    sendMessage,
  };
}

module.exports = {
  createTelegramClient,
  TelegramClientError,
};
