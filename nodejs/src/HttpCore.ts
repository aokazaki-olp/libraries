/**
 * HttpCore.ts
 * @description HTTP通信の共通基盤（Transport・デコレータ）
 *
 * 構成:
 *   createTransport  - got を使った基本Transport
 *   withRetry        - 指数バックオフリトライデコレータ
 *   withLogger       - リクエスト/レスポンスロギングデコレータ
 */

import got, { type Got, type Method, type OptionsInit, type Response } from 'got';
import { LoggerFacade } from './LoggerFacade.js';
import type { Logger } from './LoggerFacade.js';
import { HttpError, RetryExhaustedError } from './httpTypes.js';
import type { FetchOptions, RawResponse, Transport } from './httpTypes.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

// ============================================================================
// ユーティリティ
// ============================================================================

const cloneHeaders = (headers?: Record<string, string>): Record<string, string> =>
  ({ ...headers });

const mergeHeaders = (
  base: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> => ({ ...base, ...override });

const hasHeader = (headers: Record<string, string>, key: string): boolean => {
  const needle = key.toLowerCase();
  return Object.keys(headers).some(k => k.toLowerCase() === needle);
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Content-Type が既知のバイナリ系かどうかを判定する（除外リスト方式。既定はテキストとして扱う）
const BINARY_CONTENT_TYPE_PATTERN = /^(image|audio|video)\//;
const BINARY_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/zip',
]);

const isBinaryContentType = (contentType: string | undefined): boolean => {
  if (!contentType) {
    return false;
  }
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  return BINARY_CONTENT_TYPE_PATTERN.test(mediaType) || BINARY_CONTENT_TYPES.has(mediaType);
};

// ============================================================================
// createTransport
// ============================================================================

interface TransportDeps {
  got?: Got;
  /** multipart 送信で使う FormData の生成元（テスト用の差し替え口）。省略時は組み込みの FormData を使う。 */
  formData?: () => FormData;
}

/**
 * got を使った基本Transportを作成する
 *
 * @param deps - 依存注入（テスト用）
 * @returns Transport
 * @throws {HttpError} HTTPステータスが2xx以外の場合
 */
const createTransport = (deps?: TransportDeps): Transport => {
  const http = deps?.got ?? got;

  return {
    fetch: async (url: string, options: FetchOptions = {}): Promise<RawResponse> => {
      // options.method は呼び出し側指定の HTTP 動詞前提で Method union として扱う（未知動詞は got 実行時に顕在化）
      const method = (options.method ?? 'GET').toUpperCase() as Method;

      const fetchOptions: OptionsInit = {
        method,
        headers: options.headers,
        throwHttpErrors: false,
        retry: { limit: 0 },
      };

      if (options.files) {
        // multipart: files が1件でもあれば FormData を body に渡す（got は body 指定時 form/json を使えない）
        const form = (deps?.formData ?? (() => new FormData()))();

        if (options.payload != null && typeof options.payload !== 'string') {
          for (const [key, value] of Object.entries(options.payload)) {
            form.append(key, value);
          }
        }

        for (const [key, part] of Object.entries(options.files)) {
          const parts = Array.isArray(part) ? part : [part];
          for (const p of parts) {
            // Blob の第2引数 options は contentType 未指定時省略する（空文字にすると text/plain 扱いになる実装差を避ける）
            const blob = p.contentType != null
              ? new Blob([p.data], { type: p.contentType })
              : new Blob([p.data]);
            form.append(key, blob, p.filename);
          }
        }

        fetchOptions.body = form;
      } else if (options.payload != null) {
        if (typeof options.payload === 'string') {
          fetchOptions.body = options.payload;
        } else {
          fetchOptions.form = options.payload;
        }
      }

      if (typeof options.timeoutMs === 'number') {
        fetchOptions.timeout = { request: options.timeoutMs };
      }

      // got の型パラメータを指定しないと Response<unknown> になるためキャスト（string ボディが返ることは got の仕様上保証される）
      // rawBody は got の実装が常に保持する生バイト（型定義に出ないため個別に拡張）
      const response = await http(url, fetchOptions) as Response<string> & { rawBody?: Buffer };

      // got の headers 型を RawResponse.headers（Record<string, string|string[]>）として扱う
      const headers = response.headers as Record<string, string | string[]>;
      const bytes = response.rawBody ? new Uint8Array(response.rawBody) : undefined;

      const contentTypeHeader = headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

      let text = '';
      let body: unknown = null;

      if (!isBinaryContentType(contentType)) {
        text = response.body;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
      }

      const status = response.statusCode;

      if (status < 200 || status >= 300) {
        throw new HttpError(`HTTPエラー ${status}`, status, body, headers, text, undefined, bytes);
      }

      return { status, headers, body, text, bytes };
    },
  };
};

// ============================================================================
// withRetry
// ============================================================================

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
}

const shouldRetry = (e: unknown): boolean => {
  if (e instanceof HttpError) {
    return e.status === 429 || (e.status >= 500 && e.status < 600);
  }
  // ネットワークエラー・タイムアウト等の Transport 層エラーをリトライ対象とする。
  // 正しく実装された Transport ではプログラミングエラーはここに到達しない前提。
  return !(e instanceof RetryExhaustedError);
};

/**
 * 指数バックオフリトライ機能をTransportに追加する
 *
 * @param transport - ラップ対象Transport
 * @param options - リトライ設定
 * @returns リトライ機能付きTransport
 * @throws {RetryExhaustedError} リトライ上限に達した場合
 */
const withRetry = (transport: Transport, options: RetryOptions = {}): Transport => {
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

          if (!shouldRetry(e)) {
            throw e;
          }

          lastError = e;

          const status = e instanceof HttpError ? e.status : undefined;
          const statusLabel = status != null ? ` status=${status}` : '';

          if (attempt === maxRetries) {
            log?.error(`[HTTP] ✖ RETRY exhausted${statusLabel} ${method} ${url}`);
            throw new RetryExhaustedError(
              `リトライ回数上限に達しました${status != null ? ` (HTTP ${status})` : ''}`,
              { cause: lastError },
            );
          }

          const delay = Math.pow(2, attempt) * baseDelayMs;
          log?.warn(
            `[HTTP] ⚠ RETRY attempt=${attempt + 1}/${maxRetries}${statusLabel} delay=${delay}ms ${method} ${url}`,
          );
          await sleep(delay);
        }
      }

      throw lastError ?? new RetryExhaustedError('リトライ回数上限に達しました');
    },
  };
};

// ============================================================================
// withLogger
// ============================================================================

/**
 * リクエスト/レスポンスロギング機能をTransportに追加する
 *
 * @param transport - ラップ対象Transport
 * @param logger - ロガー実装（nullishの場合は透過）
 * @returns ロギング機能付きTransport（loggerがnullishの場合は元のtransportをそのまま返す）
 */
const withLogger = (transport: Transport, logger?: Logger): Transport => {
  const log = LoggerFacade.createLogger(logger);
  if (!log) {
    return transport;
  }

  return {
    fetch: async (url: string, options?: FetchOptions): Promise<RawResponse> => {
      const method = options?.method ?? 'GET';
      const startMs = Date.now();

      log.debug(`[HTTP] → ${method} ${url}`);

      try {
        const response = await transport.fetch(url, options);
        const elapsedMs = Date.now() - startMs;
        log.info(`[HTTP] ← ${response.status} ${method} ${url} ${elapsedMs}ms`);
        return response;
      } catch (e) {
        const elapsedMs = Date.now() - startMs;
        log.error(`[HTTP] ✖ ${method} ${url} ${elapsedMs}ms`, e);
        throw e;
      }
    },
  };
};

export const HttpCore = {
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  cloneHeaders,
  mergeHeaders,
  hasHeader,
  createTransport,
  withRetry,
  withLogger,
};

export type { RetryOptions };
