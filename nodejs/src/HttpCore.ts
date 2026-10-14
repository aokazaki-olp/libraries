/**
 * HttpCore.ts
 *
 * @description HTTP通信の共通基盤（Transport・デコレータ）
 *
 * 構成:
 *   createTransport  - got を使った基本Transport
 *   withRetry        - 指数バックオフリトライデコレータ
 *   withLogger       - リクエスト/レスポンスロギングデコレータ
 */

import got, { type Got, type Method, type OptionsOfTextResponseBodyWrapped } from 'got';
import type { IncomingHttpHeaders } from 'node:http';
import { LoggerFacade } from './LoggerFacade.ts';
import type { Logger } from './LoggerFacade.ts';
import { HttpError, RetryExhaustedError } from './httpTypes.ts';
import type { FetchOptions, RawResponse, Transport } from './httpTypes.ts';
import { sleep } from './shared/sleep.ts';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

// ============================================================================
// ユーティリティ
// ============================================================================

const cloneHeaders = (headers?: Record<string, string>): Record<string, string> => ({ ...headers });

const mergeHeaders = (
  base: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> => ({ ...base, ...override });

const hasHeader = (headers: Record<string, string>, key: string): boolean => {
  const needle = key.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === needle);
};

const METHODS: ReadonlySet<string> = new Set<Method>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'HEAD',
  'DELETE',
  'OPTIONS',
  'TRACE',
]);

const isMethod = (method: string): method is Method => METHODS.has(method);

/** got のヘッダ（値に undefined を含みうる）から値のあるものだけを残す */
const normalizeHeaders = (headers: IncomingHttpHeaders): Record<string, string | string[]> => {
  const normalized: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) {
      normalized[k] = v;
    }
  }
  return normalized;
};

// ============================================================================
// createTransport
// ============================================================================

interface TransportDeps {
  got?: Got;
}

/**
 * got を使った基本Transportを作成する
 *
 * @param deps - 依存注入（テスト用）
 * @returns Transport
 * @throws {TypeError} options.method が HTTP メソッドでない場合
 * @throws {HttpError} HTTPステータスが2xx以外の場合
 */
const createTransport = (deps?: TransportDeps): Transport => {
  const http = deps?.got ?? got;

  return {
    fetch: async (url: string, options: FetchOptions = {}): Promise<RawResponse> => {
      const method = (options.method ?? 'GET').toUpperCase();
      if (!isMethod(method)) {
        throw new TypeError(`method には HTTP メソッドを指定してください (received: ${method})`);
      }

      const fetchOptions: OptionsOfTextResponseBodyWrapped = {
        method,
        responseType: 'text',
        resolveBodyOnly: false,
        headers: options.headers,
        throwHttpErrors: false,
        retry: { limit: 0 },
        signal: options.signal,
      };

      if (options.payload != null) {
        if (typeof options.payload === 'string') {
          fetchOptions.body = options.payload;
        } else {
          fetchOptions.form = options.payload;
        }
      }

      if (typeof options.timeoutMs === 'number') {
        fetchOptions.timeout = { request: options.timeoutMs };
      }

      const response = await http(url, fetchOptions);

      const text = response.body;
      let body: unknown = null;

      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      const status = response.statusCode;
      const headers = normalizeHeaders(response.headers);

      if (status < 200 || status >= 300) {
        throw new HttpError(`HTTPエラー ${String(status)}`, status, body, headers, text);
      }

      return {
        status,
        headers,
        body,
        text,
      };
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
  // TypeError は呼び出し側の誤り（不正な method 等）。再送しても結果は変わらない
  if (e instanceof TypeError || e instanceof RetryExhaustedError) {
    return false;
  }
  // ネットワークエラー・タイムアウト等の Transport 層エラーをリトライ対象とする
  return true;
};

/**
 * 指数バックオフリトライ機能をTransportに追加する
 *
 * @param transport - ラップ対象Transport
 * @param options - リトライ設定
 * @returns リトライ機能付きTransport（fetchOptions.signal が中断されたらリトライも待機もやめる）
 * @throws {RetryExhaustedError} リトライ上限に達した場合
 */
const withRetry = (transport: Transport, options: RetryOptions = {}): Transport => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const log = LoggerFacade.createLogger(options.logger);

  return {
    fetch: async (url: string, fetchOptions?: FetchOptions): Promise<RawResponse> => {
      const method = fetchOptions?.method ?? 'GET';

      // 成功で return、リトライ不能・上限到達で throw するまで回る（ループ後に到達しない）
      for (let attempt = 0; ; attempt++) {
        try {
          return await transport.fetch(url, fetchOptions);
        } catch (e) {
          // 呼び出し側が中断したものは再送しない
          if (fetchOptions?.signal?.aborted === true || !shouldRetry(e)) {
            throw e;
          }

          const status = e instanceof HttpError ? e.status : undefined;
          const statusLabel = status != null ? ` status=${String(status)}` : '';

          if (attempt >= maxRetries) {
            log?.error(`[HTTP] ✖ RETRY exhausted${statusLabel} ${method} ${url}`);
            throw new RetryExhaustedError(
              `リトライ回数上限に達しました${status != null ? ` (HTTP ${String(status)})` : ''}`,
              { cause: e },
            );
          }

          const delay = 2 ** attempt * baseDelayMs;
          log?.warn(
            `[HTTP] ⚠ RETRY attempt=${String(attempt + 1)}/${String(maxRetries)}${statusLabel} delay=${String(delay)}ms ${method} ${url}`,
          );
          await sleep(delay, fetchOptions?.signal);
        }
      }
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
        log.info(`[HTTP] ← ${String(response.status)} ${method} ${url} ${String(elapsedMs)}ms`);
        return response;
      } catch (e) {
        const elapsedMs = Date.now() - startMs;
        log.error(`[HTTP] ✖ ${method} ${url} ${String(elapsedMs)}ms`, e);
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
