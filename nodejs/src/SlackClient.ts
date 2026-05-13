/**
 * SlackClient.ts
 * @description Slack用クライアント群（SlackCore / SlackApiClient / SlackWebhookClient）
 *
 * 構成:
 *   SlackCore          - Retry-After対応リトライデコレータ
 *   SlackApiClient     - Slack Web API用クライアント（Bearer Token認証）
 *   SlackWebhookClient - Slack Incoming Webhooks用クライアント（URL認証）
 */

import { LoggerFacade } from './LoggerFacade.js';
import type { Logger } from './LoggerFacade.js';
import { ApiClient } from './ApiClient.js';
import { HttpCore } from './HttpCore.js';
import { HttpError, RetryExhaustedError } from './httpTypes.js';
import type { BaseClient } from './ApiClient.js';
import type { FetchOptions, RawResponse, Transport } from './httpTypes.js';

export class SlackApiError extends Error {
  override readonly name = 'SlackApiError';

  constructor(
    message: string,
    public readonly code: string,
    public readonly metadata?: unknown,
    public readonly response?: RawResponse,
  ) {
    super(message);
  }
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// SlackCore
// ============================================================================

interface SlackRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
}

/**
 * Slack用のリトライ機能をTransportに追加する。
 * HTTP 429 の際は Retry-After ヘッダーを尊重し、5xx は指数バックオフで再試行する。
 *
 * @param transport - ラップ対象Transport
 * @param options - リトライ設定
 * @returns リトライ機能付きTransport
 * @throws {RetryExhaustedError} リトライ上限に達した場合
 */
const withRetry = (transport: Transport, options: SlackRetryOptions = {}): Transport => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const log = LoggerFacade.createLogger(options.logger);

  return {
    fetch: async (url: string, fetchOptions?: FetchOptions): Promise<RawResponse> => {
      const method = fetchOptions?.method ?? 'GET';
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await transport.fetch(url, fetchOptions);
        } catch (e) {
          if (e instanceof RetryExhaustedError) {
            throw e;
          }

          lastError = e;

          if (e instanceof HttpError) {
            const { status } = e;

            if (status === 429) {
              const raw = e.headers['Retry-After'] ?? e.headers['retry-after'];
              const rawStr = Array.isArray(raw) ? raw[0] : (raw ?? '');
              const secs = parseInt(rawStr, 10);
              const delayMs = (Number.isFinite(secs) && secs > 0 ? secs : 1) * 1000;

              if (attempt === maxRetries) {
                log?.error(`[Slack] ✖ RETRY exhausted status=429 Retry-After=${secs}s ${method} ${url}`);
                throw new RetryExhaustedError(`リトライ回数上限に達しました (HTTP 429)`, { cause: e });
              }

              log?.warn(`[Slack] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=429 Retry-After=${secs}s ${method} ${url}`);
              await sleep(delayMs);
              continue;
            }

            if (status >= 500 && status < 600) {
              const delay = Math.pow(2, attempt) * baseDelayMs;

              if (attempt === maxRetries) {
                log?.error(`[Slack] ✖ RETRY exhausted status=${status} ${method} ${url}`);
                throw new RetryExhaustedError(`リトライ回数上限に達しました (HTTP ${status})`, { cause: e });
              }

              log?.warn(`[Slack] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=${status} delay=${delay}ms ${method} ${url}`);
              await sleep(delay);
              continue;
            }

            // 4xx（429以外）はリトライしない
            throw e;
          }

          // ネットワークエラー等 → 指数バックオフ
          const delay = Math.pow(2, attempt) * baseDelayMs;
          if (attempt === maxRetries) {
            log?.error(`[Slack] ✖ RETRY exhausted ${method} ${url}`, e);
            throw new RetryExhaustedError('リトライ回数上限に達しました', { cause: e });
          }
          log?.warn(`[Slack] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} delay=${delay}ms ${method} ${url}`);
          await sleep(delay);
        }
      }

      throw lastError ?? new RetryExhaustedError('リトライ回数上限に達しました');
    },
  };
};

export const SlackCore = { withRetry };

// ============================================================================
// SlackApiClient
// ============================================================================

const SLACK_BASE_URL = 'https://slack.com/api';

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { messages?: string[] };
  [key: string]: unknown;
}

type ResponseHandler = (response: RawResponse) => unknown;

const slackResponseHandler: ResponseHandler = (response) => {
  const body = response.body;
  if (typeof body !== 'object' || body === null) {
    return body;
  }
  const typed = body as SlackApiResponse;
  if (typed.ok === false) {
    throw new SlackApiError(
      `Slack API エラー: ${typed.error ?? 'unknown'}`,
      typed.error ?? 'slack_error',
      typed.response_metadata,
      response,
    );
  }
  return body;
};

interface SlackApiClientOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * Slack Web API クライアントを作成する。
 *
 * @param token - Slack API トークン
 * @param options - オプション設定
 * @returns クライアント（call/get/post/use/extend）
 * @throws {TypeError} token が空文字または文字列でない場合
 * @throws {SlackApiError} Slack API が ok:false を返した場合
 */
const createSlackApiClient = (token: string, options: SlackApiClientOptions = {}): BaseClient => {
  if (typeof token !== 'string' || token === '') {
    throw new TypeError('token には Slack API トークン (string) を指定してください');
  }
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  return ApiClient.createClient({
    baseUrl: SLACK_BASE_URL,
    transport: injectedTransport ?? HttpCore.createTransport(),
    logger,
    responseHandler: slackResponseHandler,
  })
    .extend(t => ApiClient.withBearerAuth(t, token))
    .extend(t => withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend(t => HttpCore.withLogger(t, logger));
};

export const SlackApiClient = { create: createSlackApiClient };

// ============================================================================
// SlackWebhookClient
// ============================================================================

interface SlackPayload {
  text?: string;
  blocks?: unknown[];
  attachments?: unknown[];
  channel?: string;
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  [key: string]: unknown;
}

interface SlackWebhookOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  logger?: Logger;
  transport?: Transport;
}

interface SlackWebhookInstance {
  send(payload: SlackPayload): Promise<void>;
}

/**
 * Slack Incoming Webhook クライアントを作成する。
 *
 * @param webhookUrl - Webhook URL
 * @param options - オプション設定
 * @returns { send } クライアント
 * @throws {TypeError} webhookUrl が空文字または文字列でない場合
 * @throws {RetryExhaustedError} リトライ上限に達した場合
 * @throws {HttpError} Slack Webhook が非2xxを返した場合
 */
const createWebhookClient = (webhookUrl: string, options: SlackWebhookOptions = {}): SlackWebhookInstance => {
  if (typeof webhookUrl !== 'string' || webhookUrl === '') {
    throw new TypeError('webhookUrl には Slack Webhook URL (string) を指定してください');
  }
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    timeoutMs,
    logger,
    transport: injectedTransport,
  } = options;

  const baseTransport = injectedTransport ?? HttpCore.createTransport();
  const transport = HttpCore.withLogger(
    maxRetries > 0 ? withRetry(baseTransport, { maxRetries, baseDelayMs, logger }) : baseTransport,
    logger,
  );

  const send = async (payload: SlackPayload): Promise<void> => {
    await transport.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      payload: JSON.stringify(payload),
      ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
    });
  };

  return { send };
};

/**
 * Slack Incoming Webhook に一回限り送信する（静的メソッド）。
 *
 * @param webhookUrl - Webhook URL
 * @param payload - 送信するペイロード
 * @param options - オプション設定
 * @returns 送信完了 Promise
 */
const sendWebhook = (webhookUrl: string, payload: SlackPayload, options?: SlackWebhookOptions): Promise<void> =>
  createWebhookClient(webhookUrl, options).send(payload);

export const SlackWebhookClient = {
  create: createWebhookClient,
  send: sendWebhook,
};

export type { SlackRetryOptions, SlackApiClientOptions, SlackWebhookOptions, SlackPayload, SlackWebhookInstance };
