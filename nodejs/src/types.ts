/**
 * types.ts
 * @description 共通インターフェース・型定義
 */

// ============================================================================
// Logger
// ============================================================================

export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ============================================================================
// Transport
// ============================================================================

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** JSON文字列 or form-urlencodedオブジェクト */
  payload?: string | Record<string, string>;
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  text: string;
}

export interface Transport {
  fetch(url: string, options?: FetchOptions): Promise<RawResponse>;
}

// ============================================================================
// Client
// ============================================================================

export interface RequestOptions {
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
}

export type ResponseHandler<T = unknown> = (
  response: RawResponse,
  request: RequestOptions,
) => T;

// ============================================================================
// Errors
// ============================================================================

/**
 * HTTP 非2xxレスポンスを表すエラー。
 *
 * **注意**: `request.body` にはリクエストボディがそのまま含まれる場合がある。
 * ロガーに渡す前に機密フィールド（トークン・パスワード等）を redact すること。
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly headers: Record<string, string | string[]> = {},
    public readonly text: string = '',
    public readonly request?: RequestOptions,
  ) {
    super(message);
  }
}

export class RetryExhaustedError extends Error {
  override readonly name = 'RetryExhaustedError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

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
