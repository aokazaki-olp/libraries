/**
 * BacklogApiClient.ts
 * @description Backlog API のプロトコル層クライアント。
 *              認証(API Key ヘッダ or OAuth 2.0 Bearer)・レート制限リトライ・エラー正規化・
 *              ロギング・baseUrl 構築のみを提供する。
 *              課題・プロジェクト・Wiki 等のドメインメソッドは呼び出し側で .use() する。
 *
 * 使用例:
 *   const client = BacklogApiClient.create('https://example.backlog.jp', { apiKey: 'xxxxxxxx' });
 *   const projects = await client.get('/projects');
 *
 *   // OAuth 2.0 アクセストークンの場合
 *   const client = BacklogApiClient.create('https://example.backlog.jp', { accessToken: 'yyyyyyyy' });
 */

import { ApiClient } from './ApiClient.js';
import { HttpCore } from './HttpCore.js';
import { LoggerFacade } from './LoggerFacade.js';
import { HttpError, RetryExhaustedError } from './httpTypes.js';
import type { BaseClient } from './ApiClient.js';
import type { Logger } from './LoggerFacade.js';
import type { FetchOptions, RawResponse, Transport } from './httpTypes.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const AUTH_HEADER = 'Backlog-API-Key';

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// BacklogApiError
// ============================================================================

/** Backlog API のエラーコード体系（1〜13）。 */
const BACKLOG_ERROR_CODE = {
  INTERNAL: 1,
  LICENCE: 2,
  LICENCE_EXPIRED: 3,
  ACCESS_DENIED: 4,
  UNAUTHORIZED_OPERATION: 5,
  NO_RESOURCE: 6,
  INVALID_REQUEST: 7,
  SPACE_OVER_CAPACITY: 8,
  RESOURCE_OVERFLOW: 9,
  TOO_LARGE_FILE: 10,
  AUTHENTICATION: 11,
  REQUIRED_MFA: 12,
  TOO_MANY_REQUESTS: 13,
} as const;

export class BacklogApiError extends Error {
  override readonly name = 'BacklogApiError';

  constructor(
    message: string,
    public readonly code: number,
    public readonly errors: unknown,
    public readonly response?: RawResponse,
  ) {
    super(message);
  }
}

interface BacklogErrorItem {
  message: string;
  code: number;
  moreInfo?: string;
}

const isBacklogErrorBody = (body: unknown): body is { errors: BacklogErrorItem[] } => {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  // 直前で object かつ非 null を確認済み。errors フィールドを検査するためキャスト
  const errors = (body as Record<string, unknown>)['errors'];
  return Array.isArray(errors) && errors.length > 0 && errors.every(
    (e) => typeof e === 'object' && e !== null && 'message' in e && 'code' in e,
  );
};

/**
 * HttpError を Backlog のエラー形式（`{errors:[{message,code,moreInfo}]}`）に基づいて
 * BacklogApiError に正規化する。該当しない場合は元の HttpError をそのまま再スローする。
 *
 * @param transport - ラップ対象 Transport
 * @returns 正規化機能付き Transport
 * @throws {BacklogApiError} レスポンスボディが Backlog のエラー形式の場合
 */
const withErrorNormalization = (transport: Transport): Transport => ({
  fetch: async (url: string, options?: FetchOptions): Promise<RawResponse> => {
    try {
      return await transport.fetch(url, options);
    } catch (e) {
      if (e instanceof HttpError && isBacklogErrorBody(e.body)) {
        // 直前の isBacklogErrorBody で errors.length > 0 を確認済み
        const first = e.body.errors[0];
        throw new BacklogApiError(
          `Backlog API エラー: ${first.message}`,
          first.code,
          e.body.errors,
          { status: e.status, headers: e.headers, body: e.body, text: e.text },
        );
      }
      throw e;
    }
  },
});

// ============================================================================
// BacklogCore — X-RateLimit-Reset 対応リトライ
// ============================================================================

interface BacklogRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
}

/**
 * Backlog 用のリトライ機能を Transport に追加する。
 * HTTP 429 の際は X-RateLimit-Reset（UNIX 時間, 秒）を尊重し、5xx は指数バックオフで再試行する。
 *
 * @param transport - ラップ対象 Transport
 * @param options - リトライ設定
 * @returns リトライ機能付き Transport
 * @throws {RetryExhaustedError} リトライ上限に達した場合
 */
const withRetry = (transport: Transport, options: BacklogRetryOptions = {}): Transport => {
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
              const raw = e.headers['X-RateLimit-Reset'] ?? e.headers['x-ratelimit-reset'];
              const rawStr = Array.isArray(raw) ? raw[0] : (raw ?? '');
              const resetSec = parseInt(rawStr, 10);
              const delayMs = Number.isFinite(resetSec)
                ? Math.max(resetSec * 1000 - Date.now(), 0)
                : baseDelayMs;

              if (attempt === maxRetries) {
                log?.error(`[Backlog] ✖ RETRY exhausted status=429 ${method} ${url}`);
                throw new RetryExhaustedError('リトライ回数上限に達しました (HTTP 429)', { cause: e });
              }

              log?.warn(`[Backlog] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=429 delay=${delayMs}ms ${method} ${url}`);
              await sleep(delayMs);
              continue;
            }

            if (status >= 500 && status < 600) {
              const delay = Math.pow(2, attempt) * baseDelayMs;

              if (attempt === maxRetries) {
                log?.error(`[Backlog] ✖ RETRY exhausted status=${status} ${method} ${url}`);
                throw new RetryExhaustedError(`リトライ回数上限に達しました (HTTP ${status})`, { cause: e });
              }

              log?.warn(`[Backlog] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=${status} delay=${delay}ms ${method} ${url}`);
              await sleep(delay);
              continue;
            }

            // 4xx（429以外）はリトライしない
            throw e;
          }

          // ネットワークエラー等 → 指数バックオフ
          const delay = Math.pow(2, attempt) * baseDelayMs;
          if (attempt === maxRetries) {
            log?.error(`[Backlog] ✖ RETRY exhausted ${method} ${url}`, e);
            throw new RetryExhaustedError('リトライ回数上限に達しました', { cause: e });
          }
          log?.warn(`[Backlog] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} delay=${delay}ms ${method} ${url}`);
          await sleep(delay);
        }
      }

      throw lastError ?? new RetryExhaustedError('リトライ回数上限に達しました');
    },
  };
};

export const BacklogCore = { withRetry };

// ============================================================================
// BacklogApiClient
// ============================================================================

/** API キー方式（Backlog-API-Key ヘッダ）または OAuth 2.0 のアクセストークン。 */
export type BacklogAuth =
  | { apiKey: string }
  | { accessToken: string };

export interface BacklogClientOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * Backlog API クライアントを作成する
 *
 * @param spaceUrl - スペースの URL（例: https://example.backlog.jp）
 * @param auth - API キー方式（`{ apiKey }`）または OAuth 2.0 アクセストークン方式（`{ accessToken }`）
 * @param options - オプション設定
 * @returns クライアント（call/get/post/put/patch/delete/use/extend）
 * @throws {TypeError} spaceUrl が空文字の場合、auth が不正な形式の場合
 * @throws {BacklogApiError} Backlog API がエラー形式（`{errors:[...]}`）のレスポンスを返した場合
 */
const create = <TResponse = unknown>(
  spaceUrl: string,
  auth: BacklogAuth,
  options: BacklogClientOptions = {},
): BaseClient<TResponse> => {
  if (typeof spaceUrl !== 'string' || spaceUrl === '') {
    throw new TypeError('spaceUrl には Backlog スペースの URL (string) を指定してください（例: https://example.backlog.jp）');
  }
  if (typeof auth !== 'object' || auth === null) {
    throw new TypeError('auth には { apiKey } または { accessToken } を指定してください');
  }
  if (!('apiKey' in auth) && !('accessToken' in auth)) {
    throw new TypeError('auth には apiKey または accessToken のいずれかを指定してください');
  }
  if ('apiKey' in auth && (typeof auth.apiKey !== 'string' || auth.apiKey === '')) {
    throw new TypeError('auth.apiKey には空でない string を指定してください');
  }
  if ('accessToken' in auth && (typeof auth.accessToken !== 'string' || auth.accessToken === '')) {
    throw new TypeError('auth.accessToken には空でない string を指定してください');
  }

  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  const baseUrl = `${spaceUrl.replace(/\/+$/, '')}/api/v2`;

  // 認証は 2 方式を使い分ける（apiKey: 静的ヘッダ、accessToken: Bearer）。
  // デコレータ適用順 (内側 → 外側): createClient(apiKey ヘッダ or 素通し) → [Bearer] → Retry → 正規化 → Logger
  // - Retry は正規化前の生の HttpError を見て status / X-RateLimit-Reset を判定する
  // - 正規化は Retry を抜けた最終的な HttpError だけを BacklogApiError に変換する
  let client = ApiClient.createClient<TResponse>({
    baseUrl,
    transport: injectedTransport ?? HttpCore.createTransport(),
    headers: {
      Accept: 'application/json',
      ...('apiKey' in auth ? { [AUTH_HEADER]: auth.apiKey } : {}),
    },
    logger,
    // レスポンスボディを TResponse として扱う（Backlog API の型保証は呼び出し側の責務）
    responseHandler: (response) => response.body as TResponse,
  });

  if ('accessToken' in auth) {
    client = client.extend(t => ApiClient.withBearerAuth(t, auth.accessToken));
  }

  return client
    .extend(t => BacklogCore.withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend(t => withErrorNormalization(t))
    .extend(t => HttpCore.withLogger(t, logger));
};

export const BacklogApiClient = { create };
export { BACKLOG_ERROR_CODE };
