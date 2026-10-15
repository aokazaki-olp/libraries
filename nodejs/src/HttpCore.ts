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
import { HttpError, RequestValidationError, RetryExhaustedError } from './httpTypes.ts';
import type { FetchOptions, RawResponse, Transport } from './httpTypes.ts';
import { abortReason } from './shared/abort.ts';
import { sleep } from './shared/sleep.ts';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * 5xx・通信エラーで再送してよい既定のメソッド（RFC 9110 §9.2.2 の冪等なメソッド）
 *
 * POST / PATCH は、サーバー側で処理済みでも応答が失われれば再送され、ジョブやメッセージが重複しうる。
 * 429 はサーバーが処理を拒んだ応答なので、メソッドを問わず再送する。
 */
const IDEMPOTENT_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS', 'TRACE', 'PUT', 'DELETE'];

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

/**
 * 失敗した要求を再送してよいかを決める（withRetry / SlackCore.withRetry 共通）
 *
 * @param e - Transport が投げた値
 * @param method - 要求のメソッド
 * @param retryMethods - 5xx・通信エラーで再送してよいメソッド
 * @returns 再送してよいなら true
 */
const isRetryable = (e: unknown, method: string, retryMethods: readonly string[]): boolean => {
  // 組み立ての誤りは再送しても変わらない。RetryExhaustedError は二重に包まない
  if (e instanceof RequestValidationError || e instanceof RetryExhaustedError) {
    return false;
  }
  if (e instanceof HttpError) {
    if (e.status === 429) {
      return true;
    }
    if (e.status < 500 || e.status >= 600) {
      return false;
    }
  }
  // 5xx と、ネットワークエラー・タイムアウト等の Transport 層エラー
  // （fetch ベースの Transport は通信障害を TypeError で投げるので、TypeError も対象）
  return retryMethods.includes(method.toUpperCase());
};

/**
 * retryMethods を検査して大文字にそろえる
 *
 * @throws {TypeError} 文字列の配列でない場合
 */
const normalizeRetryMethods = (retryMethods: unknown): readonly string[] => {
  if (retryMethods === undefined) {
    return IDEMPOTENT_METHODS;
  }
  if (!Array.isArray(retryMethods) || !retryMethods.every((m) => typeof m === 'string')) {
    throw new TypeError('retryMethods には HTTP メソッド名（string）の配列を指定してください');
  }
  return retryMethods.map((m: string) => m.toUpperCase());
};

/** HTTP メソッドの構文（RFC 9110 §9.1 の method = token） */
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * リトライ設定を検査する（create 時に fail-fast させる）
 *
 * NaN・負数・小数を通すと、上限判定が成立せずリトライが止まらなくなる。
 *
 * @param maxRetries - リトライ最大回数
 * @param baseDelayMs - 指数バックオフの基準ミリ秒
 * @throws {TypeError} maxRetries が 0 以上の整数でない場合、baseDelayMs が 0 以上の有限数でない場合
 */
const assertRetryOptions = (maxRetries: number, baseDelayMs: number): void => {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new TypeError(
      `maxRetries には 0 以上の整数を指定してください (received: ${String(maxRetries)})`,
    );
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new TypeError(
      `baseDelayMs には 0 以上の有限数を指定してください (received: ${String(baseDelayMs)})`,
    );
  }
};

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

interface TransportDependencies {
  got?: Got;
}

/**
 * got を使った基本Transportを作成する
 *
 * @param dependencies - 依存注入（テスト用）
 * @returns Transport。返した fetch は次を投げる:
 *   RequestValidationError（method が HTTP メソッドの構文でない）・
 *   HttpError（ステータスが 2xx 以外）・中断理由（signal が中断された）・got の通信エラー
 */
const createTransport = (dependencies?: TransportDependencies): Transport => {
  const http = dependencies?.got ?? got;

  return {
    fetch: async (url: string, options: FetchOptions = {}): Promise<RawResponse> => {
      const method = (options.method ?? 'GET').toUpperCase();
      if (!METHOD_TOKEN.test(method)) {
        throw new RequestValidationError(
          `method には HTTP メソッドを指定してください (received: ${method})`,
        );
      }

      const fetchOptions: OptionsOfTextResponseBodyWrapped = {
        // got の Method 型は代表的な動詞の union だが、実行時は任意の token（PURGE 等）を送れる。
        // 構文は上で検査済み。union に無い拡張メソッドを通すためのキャスト
        method: method as Method,
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

      let response;
      try {
        response = await http(url, fetchOptions);
      } catch (e) {
        // got は中断理由を捨てて自前の AbortError を投げる。どの経路でも signal.reason を投げるよう揃える
        if (options.signal?.aborted === true) {
          throw abortReason(options.signal);
        }
        throw e;
      }

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
  /** 5xx・通信エラーで再送するメソッド。既定は冪等なメソッドだけ（429 はメソッドを問わず再送） */
  retryMethods?: readonly string[];
  logger?: Logger;
}

/**
 * 指数バックオフリトライ機能をTransportに追加する
 *
 * 429 はメソッドを問わず再送する。5xx・通信エラーで再送するのは retryMethods のメソッドだけで、
 * 既定は冪等なメソッド（GET / HEAD / OPTIONS / TRACE / PUT / DELETE）。POST / PATCH を再送すると、
 * サーバー側で処理済みの要求が重複しうる。重複しても害の無い POST は retryMethods に足す。
 *
 * @param transport - ラップ対象Transport
 * @param options - リトライ設定
 * @returns リトライ機能付きTransport。fetchOptions.signal が中断されたらリトライも待機もやめ、
 *   中断理由（signal.reason）を投げる。リトライ上限に達したら RetryExhaustedError を投げる
 * @throws {TypeError} maxRetries / baseDelayMs / retryMethods が不正な場合
 */
const withRetry = (transport: Transport, options: RetryOptions = {}): Transport => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  assertRetryOptions(maxRetries, baseDelayMs);
  const retryMethods = normalizeRetryMethods(options.retryMethods);
  const log = LoggerFacade.createLogger(options.logger);

  return {
    fetch: async (url: string, fetchOptions?: FetchOptions): Promise<RawResponse> => {
      const method = fetchOptions?.method ?? 'GET';

      // 成功で return、リトライ不能・上限到達で throw するまで回る（ループ後に到達しない）
      for (let attempt = 0; ; attempt++) {
        try {
          return await transport.fetch(url, fetchOptions);
        } catch (e) {
          // 呼び出し側が中断したものは再送しない。どの時点で気づいても中断理由を投げる
          if (fetchOptions?.signal?.aborted === true) {
            throw abortReason(fetchOptions.signal);
          }
          if (!isRetryable(e, method, retryMethods)) {
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
        // 呼び出し側の中断は障害ではないので error にしない
        if (options?.signal?.aborted === true) {
          log.warn(`[HTTP] ⏹ ABORTED ${method} ${url} ${String(elapsedMs)}ms`);
        } else {
          log.error(`[HTTP] ✖ ${method} ${url} ${String(elapsedMs)}ms`, e);
        }
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
  assertRetryOptions,
  isRetryable,
  normalizeRetryMethods,
  createTransport,
  withRetry,
  withLogger,
};

export type { RetryOptions };
