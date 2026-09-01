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
  /** multipart のファイルパート。payload と併せて送られる。組み込み transport は常に FormData として送信する。 */
  files?: Record<string, FilePart | readonly FilePart[]>;
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  text: string;
  /** 生バイト。組み込み transport は常に埋める。独自 transport では欠ける場合がある。 */
  bytes?: Uint8Array;
}

export interface Transport {
  fetch(url: string, options?: FetchOptions): Promise<RawResponse>;
}

// ============================================================================
// multipart フォーム送信
// ============================================================================

/** multipart のファイルパート。data の型は実行環境ごとに異なる（Node: Uint8Array / GAS: Blob）。 */
export interface FilePart {
  kind: 'file';
  filename: string;
  contentType?: string;
  data: Uint8Array;
}

type FormValue = string | number | boolean | FilePart;

/** RequestOptions.form の値。呼び出し側はスカラーとファイルを混ぜて書ける。 */
export type FormFields = Record<string, FormValue | readonly FormValue[]>;

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
  /** フォームとして送る。FilePart を含めば multipart。body / rawBody とは排他。 */
  form?: FormFields;
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
    /** 生バイト。RawResponse.bytes と同じ契約（組み込み transport は常に埋める）。 */
    public readonly bytes?: Uint8Array,
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
