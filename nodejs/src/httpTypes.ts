/**
 * httpTypes.ts
 *
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
  /** 中断シグナル。中断されるとリクエストを打ち切り、リトライもしない */
  signal?: AbortSignal;
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
  /** JSON.stringify を経由せず payload に直接セットされる生文字列（CSV アップロード等） */
  rawBody?: string;
  timeoutMs?: number;
  /** 中断シグナル。中断されるとリクエストを打ち切り、リトライもしない */
  signal?: AbortSignal;
}

/** 外部 I/O を伴う呼び出しに共通のオプション */
export interface CallOptions {
  /** 中断シグナル。中断されると処理を打ち切り、リトライもしない */
  signal?: AbortSignal;
}

/**
 * レスポンスボディを検証して型付きの値に変換する関数（境界の decode）
 *
 * 期待する形でなければ throw する。型パラメータだけで絞ると検証なしのキャストと等価になるため、
 * クライアントに型を付けるときはこれを渡す（CODING_RULES.md §2.7）。
 */
export type Decoder<T> = (body: unknown) => T;

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
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string | string[]>;
  readonly text: string;
  readonly request: RequestOptions | undefined;

  constructor(
    message: string,
    status: number,
    body: unknown,
    headers: Record<string, string | string[]> = {},
    text = '',
    request?: RequestOptions,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.text = text;
    this.request = request;
  }
}

/**
 * リクエストの組み立ての誤り（HTTP メソッドの形式不正・GET に body を付けた等）。
 *
 * 再送しても結果が変わらないので、リトライデコレータは再送しない。
 * TypeError のサブクラスなので、`catch (e) { if (e instanceof TypeError) ... }` でも捕まる。
 */
export class RequestValidationError extends TypeError {
  override readonly name = 'RequestValidationError';
}

/** リトライ上限に達した場合にスローされるエラー。 */
export class RetryExhaustedError extends Error {
  override readonly name = 'RetryExhaustedError';
}
