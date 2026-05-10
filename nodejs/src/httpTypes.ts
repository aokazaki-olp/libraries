/**
 * httpTypes.ts
 * @description HTTP Transport 層の共通型・エラー定義
 */

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

/** リトライ上限に達した場合にスローされるエラー。 */
export class RetryExhaustedError extends Error {
  override readonly name = 'RetryExhaustedError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
