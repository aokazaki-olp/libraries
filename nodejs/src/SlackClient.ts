/**
 * SlackClient.ts
 *
 * @description Slack用クライアント群（SlackCore / SlackApiClient / SlackWebhookClient）
 *
 * 構成:
 *   SlackCore          - Retry-After対応リトライデコレータ
 *   SlackApiClient     - Slack Web API用クライアント（Bearer Token認証）
 *   SlackWebhookClient - Slack Incoming Webhooks用クライアント（URL認証）
 */

import { LoggerFacade } from './LoggerFacade.ts';
import type { Logger } from './LoggerFacade.ts';
import { ApiClient } from './ApiClient.ts';
import { HttpCore } from './HttpCore.ts';
import { HttpError, RequestValidationError, RetryExhaustedError } from './httpTypes.ts';
import type { BaseClient } from './ApiClient.ts';
import type { CallOptions, FetchOptions, RawResponse, Transport } from './httpTypes.ts';
import { abortReason } from './shared/abort.ts';
import { sleep } from './shared/sleep.ts';

export class SlackApiError extends Error {
  override readonly name = 'SlackApiError';

  readonly code: string;
  readonly metadata: unknown;
  readonly response: RawResponse | undefined;

  constructor(
    message: string,
    code: string,
    metadata?: unknown,
    response?: RawResponse,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.metadata = metadata;
    this.response = response;
  }
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

// ============================================================================
// SlackCore
// ============================================================================

interface SlackRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
}

interface RetryPlan {
  delayMs: number;
  /** ログ用のラベル（先頭に空白を含む） */
  label: string;
  /** RetryExhaustedError のメッセージに付ける理由（先頭に空白を含む） */
  reason: string;
}

/** Retry-After ヘッダの秒数を読む。読めなければ 1 秒 */
const retryAfterMs = (headers: Record<string, string | string[]>): number => {
  const raw = headers['Retry-After'] ?? headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const seconds = parseInt(value ?? '', 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000;
};

/**
 * 例外からリトライ方針を決める。リトライしないなら null
 *
 * - 429: Retry-After を尊重する
 * - 5xx・ネットワークエラー等: 指数バックオフ
 * - 4xx（429 以外）・RequestValidationError（組み立ての誤り）・RetryExhaustedError（二重ラップ防止）: リトライしない
 *   （fetch ベースの Transport は通信障害を TypeError で投げるので、TypeError 一般はリトライ対象）
 */
const planRetry = (e: unknown, attempt: number, baseDelayMs: number): RetryPlan | null => {
  const backoffMs = 2 ** attempt * baseDelayMs;

  if (e instanceof RetryExhaustedError || e instanceof RequestValidationError) {
    return null;
  }
  if (!(e instanceof HttpError)) {
    return { delayMs: backoffMs, label: '', reason: '' };
  }
  if (e.status === 429) {
    const delayMs = retryAfterMs(e.headers);
    return {
      delayMs,
      label: ` status=429 Retry-After=${String(delayMs / 1000)}s`,
      reason: ' (HTTP 429)',
    };
  }
  if (e.status >= 500 && e.status < 600) {
    return {
      delayMs: backoffMs,
      label: ` status=${String(e.status)}`,
      reason: ` (HTTP ${String(e.status)})`,
    };
  }
  return null;
};

/**
 * Slack用のリトライ機能をTransportに追加する。
 * HTTP 429 の際は Retry-After ヘッダーを尊重し、5xx は指数バックオフで再試行する。
 *
 * @param transport - ラップ対象Transport
 * @param options - リトライ設定
 * @returns リトライ機能付きTransport。signal が中断されたらリトライも待機もやめて中断理由を投げ、
 *   上限に達したら RetryExhaustedError を投げる
 * @throws {TypeError} maxRetries / baseDelayMs が不正な場合
 */
const withRetry = (transport: Transport, options: SlackRetryOptions = {}): Transport => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  HttpCore.assertRetryOptions(maxRetries, baseDelayMs);
  const log = LoggerFacade.createLogger(options.logger);

  return {
    fetch: async (url: string, fetchOptions?: FetchOptions): Promise<RawResponse> => {
      const method = fetchOptions?.method ?? 'GET';

      // 成功で return、リトライ不能・上限到達で throw するまで回る（ループ後に到達しない）
      for (let attempt = 0; ; attempt++) {
        try {
          return await transport.fetch(url, fetchOptions);
        } catch (e) {
          const plan = planRetry(e, attempt, baseDelayMs);
          // 呼び出し側が中断したものは再送しない。どの時点で気づいても中断理由を投げる
          if (fetchOptions?.signal?.aborted === true) {
            throw abortReason(fetchOptions.signal);
          }
          if (plan === null) {
            throw e;
          }

          if (attempt >= maxRetries) {
            log?.error(`[Slack] ✖ RETRY exhausted${plan.label} ${method} ${url}`, e);
            throw new RetryExhaustedError(`リトライ回数上限に達しました${plan.reason}`, {
              cause: e,
            });
          }

          log?.warn(
            `[Slack] ⚠ RETRY attempt=${String(attempt + 1)}/${String(maxRetries)}${plan.label} delay=${String(plan.delayMs)}ms ${method} ${url}`,
          );
          await sleep(plan.delayMs, fetchOptions?.signal);
        }
      }
    },
  };
};

export const SlackCore = { withRetry };

// ============================================================================
// SlackApiClient
// ============================================================================

const SLACK_BASE_URL = 'https://slack.com/api';

/** Slack Web API の応答のうち ok:false を SlackApiError に変換する */
const slackResponseHandler = (response: RawResponse): unknown => {
  const body = response.body;
  if (typeof body !== 'object' || body === null) {
    return body;
  }
  if (Reflect.get(body, 'ok') === false) {
    const error: unknown = Reflect.get(body, 'error');
    const code = typeof error === 'string' ? error : undefined;
    throw new SlackApiError(
      `Slack API エラー: ${code ?? 'unknown'}`,
      code ?? 'slack_error',
      Reflect.get(body, 'response_metadata'),
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
    .extend((t) => ApiClient.withBearerAuth(t, token))
    .extend((t) => withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend((t) => HttpCore.withLogger(t, logger));
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
  send(payload: SlackPayload, options?: CallOptions): Promise<void>;
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
const createWebhookClient = (
  webhookUrl: string,
  options: SlackWebhookOptions = {},
): SlackWebhookInstance => {
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

  HttpCore.assertRetryOptions(maxRetries, baseDelayMs);

  const baseTransport = injectedTransport ?? HttpCore.createTransport();
  const transport = HttpCore.withLogger(
    maxRetries > 0 ? withRetry(baseTransport, { maxRetries, baseDelayMs, logger }) : baseTransport,
    logger,
  );

  const send = async (payload: SlackPayload, sendOptions: CallOptions = {}): Promise<void> => {
    await transport.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      payload: JSON.stringify(payload),
      ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
      signal: sendOptions.signal,
    });
  };

  return { send };
};

/**
 * Slack Incoming Webhook に一回限り送信する（静的メソッド）。
 *
 * @param webhookUrl - Webhook URL
 * @param payload - 送信するペイロード
 * @param options - オプション設定（signal で送信を中断できる）
 * @returns 送信完了 Promise
 */
const sendWebhook = (
  webhookUrl: string,
  payload: SlackPayload,
  options: SlackWebhookOptions & CallOptions = {},
): Promise<void> =>
  createWebhookClient(webhookUrl, options).send(payload, { signal: options.signal });

export const SlackWebhookClient = {
  create: createWebhookClient,
  send: sendWebhook,
};

export type {
  SlackRetryOptions,
  SlackApiClientOptions,
  SlackWebhookOptions,
  SlackPayload,
  SlackWebhookInstance,
};
