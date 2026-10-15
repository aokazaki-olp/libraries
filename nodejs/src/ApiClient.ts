/**
 * ApiClient.ts
 *
 * @description REST API用クライアント（baseUrl + endpoint 方式）
 *
 * 設計思想:
 *   - extend() でTransportデコレータを積み重ねる（イミュータブル）
 *   - use() でドメインメソッドをプラグインとして追加
 *   - call() が async になった以外、GAS版と同じAPI
 */

import type { Logger } from './LoggerFacade.ts';
import { HttpCore } from './HttpCore.ts';
import { RequestValidationError } from './httpTypes.ts';
import type { FetchOptions, RawResponse, RequestOptions, Transport } from './httpTypes.ts';

export type ResponseHandler<T = unknown> = (response: RawResponse, request: RequestOptions) => T;

// ============================================================================
// URL・クエリ文字列ユーティリティ
// ============================================================================

const trimRightSlash = (s: string): string => s.replace(/\/+$/, '');
const trimLeftSlash = (s: string): string => s.replace(/^\/+/, '');

const encodeKeyValue = (key: string, value: unknown): string =>
  `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;

const buildQueryString = (query?: Record<string, unknown>): string => {
  if (!query) {
    return '';
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v == null) {
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        parts.push(encodeKeyValue(k, item));
      }
    } else {
      parts.push(encodeKeyValue(k, v));
    }
  }
  return parts.join('&');
};

const buildUrl = (baseUrl: string, endpoint?: string, query?: Record<string, unknown>): string => {
  const base = trimRightSlash(baseUrl);
  const path = `/${trimLeftSlash(endpoint ?? '')}`;
  const url = base + path;

  const queryString = buildQueryString(query);
  if (!queryString) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return url + separator + queryString;
};

// ============================================================================
// Bearer認証デコレータ
// ============================================================================

/**
 * Bearer認証をTransportに追加する
 *
 * @param transport - ラップ対象Transport
 * @param token - Bearerトークン
 * @returns 認証付きTransport
 */
const withBearerAuth = (transport: Transport, token: string): Transport => ({
  fetch: (url: string, options?: FetchOptions) => {
    const headers = HttpCore.cloneHeaders(options?.headers);
    headers['Authorization'] = `Bearer ${token}`;
    return transport.fetch(url, { ...options, headers });
  },
});

// ============================================================================
// クエリパラメータ認証デコレータ
// ============================================================================

/**
 * クエリパラメータ認証を Transport に追加する
 * （API キーや認証ID が URL クエリで渡される API 向け）
 *
 * @param transport - ラップ対象 Transport
 * @param params - URL に追加する認証用クエリパラメータ
 * @returns 認証付き Transport
 */
const withQueryAuth = (transport: Transport, params: Record<string, string>): Transport => {
  const authQuery = buildQueryString(params);
  return {
    fetch: (url: string, options?: FetchOptions) => {
      if (!authQuery) {
        return transport.fetch(url, options);
      }
      const separator = url.includes('?') ? '&' : '?';
      return transport.fetch(url + separator + authQuery, options);
    },
  };
};

// ============================================================================
// Client型定義
// ============================================================================

/**
 * HTTP メソッドの補助関数が受けるオプション
 *
 * method / endpoint / query / body は引数で渡すので受けない（受けると引数で黙って上書きされる）。
 * rawBody は body を送れるメソッドだけが受ける。
 */
type MethodOptions = Omit<RequestOptions, 'method' | 'endpoint' | 'query' | 'body' | 'rawBody'>;
type MethodOptionsWithRawBody = MethodOptions & Pick<RequestOptions, 'rawBody'>;

type HttpMethods<TResponse> = {
  get(
    endpoint: string,
    query?: Record<string, unknown>,
    options?: MethodOptions,
  ): Promise<TResponse>;
  post(endpoint: string, body?: unknown, options?: MethodOptionsWithRawBody): Promise<TResponse>;
  put(endpoint: string, body?: unknown, options?: MethodOptionsWithRawBody): Promise<TResponse>;
  patch(endpoint: string, body?: unknown, options?: MethodOptionsWithRawBody): Promise<TResponse>;
  delete(endpoint: string, options?: MethodOptions): Promise<TResponse>;
};

type BaseClient<
  TResponse = unknown,
  TMethods extends object = Record<string, never>,
> = HttpMethods<TResponse> &
  TMethods & {
    call(request: RequestOptions): Promise<TResponse>;
    // extend はトランスポートのみ差し替え、追加メソッドはリセットされる（use()で再追加する）
    extend(decorator: (transport: Transport) => Transport): BaseClient<TResponse>;
    use<TNew extends object>(
      plugin: (client: BaseClient<TResponse, TMethods>) => TNew,
    ): BaseClient<TResponse, TMethods & TNew>;
    use<TName extends string, TFn>(
      name: TName,
      fn: (client: BaseClient<TResponse, TMethods>) => TFn,
    ): BaseClient<TResponse, TMethods & Record<TName, TFn>>;
  };

// ============================================================================
// ApiClient
// ============================================================================

interface ClientConfig<TResponse = RawResponse> {
  baseUrl: string;
  transport?: Transport;
  logger?: Logger;
  headers?: Record<string, string>;
  /** 省略時は RawResponse をそのまま返す */
  responseHandler?: ResponseHandler<TResponse>;
}

/**
 * HTTPクライアントを作成する
 *
 * responseHandler を省略すると、レスポンス型は RawResponse になる。
 * 別の型で受けたい場合は、その型へ変換・検証する responseHandler を渡す。
 *
 * @param config - クライアント設定
 * @returns クライアント（call/get/post/put/patch/delete/extend/use）。
 *   use() は plugin の戻り値が Object でないとき TypeError、call() は GET / HEAD / DELETE に body を付けると
 *   RequestValidationError を投げる
 * @remarks use() で追加した plugin メソッドは HTTP メソッド名（get/post/put/patch/delete）と同名でも plugin が優先される
 */
function createClient(
  config: ClientConfig & { responseHandler?: undefined },
): BaseClient<RawResponse>;
function createClient<TResponse>(
  config: ClientConfig<TResponse> & { responseHandler: ResponseHandler<TResponse> },
): BaseClient<TResponse>;
function createClient<TResponse>(
  config: ClientConfig<TResponse>,
): BaseClient<TResponse> | BaseClient<RawResponse> {
  const { responseHandler } = config;
  if (responseHandler) {
    return buildClient({ ...config, responseHandler });
  }
  return buildClient({ ...config, responseHandler: (response: RawResponse) => response });
}

const buildClient = <TResponse>(
  config: ClientConfig<TResponse> & { responseHandler: ResponseHandler<TResponse> },
): BaseClient<TResponse> => {
  const baseUrl = trimRightSlash(config.baseUrl);
  const transport = config.transport ?? HttpCore.createTransport();
  const headers = config.headers ?? {};
  const responseHandler = config.responseHandler;

  const call = async (request: RequestOptions): Promise<TResponse> => {
    const method = (request.method ?? 'GET').toUpperCase();
    const url = buildUrl(baseUrl, request.endpoint, request.query);
    const mergedHeaders = HttpCore.mergeHeaders(headers, request.headers);

    const options: FetchOptions = {
      method,
      headers: mergedHeaders,
    };

    const hasRawBody = typeof request.rawBody === 'string';
    const hasBody = request.body != null;
    const canHaveBody = !/^(GET|HEAD|DELETE)$/.test(method);

    if ((hasRawBody || hasBody) && !canHaveBody) {
      // 黙って捨てると、送ったつもりのデータが届かないことに気づけない
      throw new RequestValidationError(
        `${method} リクエストには body / rawBody を付けられません (url: ${url})`,
      );
    }
    if (hasRawBody) {
      options.payload = request.rawBody;
    } else if (hasBody) {
      options.payload = JSON.stringify(request.body);
      if (!HttpCore.hasHeader(mergedHeaders, 'Content-Type')) {
        mergedHeaders['Content-Type'] = 'application/json; charset=utf-8';
      }
    }

    if (typeof request.timeoutMs === 'number') {
      options.timeoutMs = request.timeoutMs;
    }
    if (request.signal) {
      options.signal = request.signal;
    }

    const rawResponse: RawResponse = await transport.fetch(url, options);

    return responseHandler(rawResponse, request);
  };

  const extend = (decorator: (transport: Transport) => Transport): BaseClient<TResponse> =>
    buildClient<TResponse>({
      baseUrl,
      logger: config.logger,
      headers: HttpCore.cloneHeaders(headers),
      transport: decorator(transport),
      responseHandler,
    });

  const createExtended = <TMethods extends object>(
    additionalMethods: TMethods,
  ): BaseClient<TResponse, TMethods> => {
    type Client = BaseClient<TResponse, TMethods>;

    function use<TNew extends object>(
      plugin: (c: Client) => TNew,
    ): BaseClient<TResponse, TMethods & TNew>;
    function use<TName extends string, TFn>(
      name: TName,
      fn: (c: Client) => TFn,
    ): BaseClient<TResponse, TMethods & Record<TName, TFn>>;
    function use(
      pluginOrName: ((c: Client) => unknown) | string,
      fn?: (c: Client) => unknown,
    ): BaseClient<TResponse, object> {
      let newMethods: unknown;

      if (typeof pluginOrName === 'string') {
        if (!fn) {
          throw new TypeError('use(name, fn) の形式では fn を指定してください');
        }
        newMethods = { [pluginOrName]: fn(client) };
      } else {
        newMethods = pluginOrName(client);
      }
      // plugin は利用者が書く境界。型が通っていても JS からは何でも返りうる
      if (typeof newMethods !== 'object' || newMethods === null || Array.isArray(newMethods)) {
        throw new TypeError('plugin の戻り値には Object を指定してください');
      }

      // plugin 同士の同名メソッドは後勝ちにすると、先の plugin が黙って壊れる。
      // HTTP メソッド名（delete 等）の上書きは設計どおり許す
      const duplicated = Object.keys(newMethods).filter((key) =>
        Object.hasOwn(additionalMethods, key),
      );
      if (duplicated.length > 0) {
        throw new TypeError(
          `plugin のメソッド名が既存の plugin と重複しています: ${duplicated.join(', ')}`,
        );
      }

      return createExtended({ ...additionalMethods, ...newMethods });
    }

    const httpMethods: HttpMethods<TResponse> = {
      get: (endpoint, query, options) => call({ ...options, method: 'GET', endpoint, query }),
      post: (endpoint, body, options) => call({ ...options, method: 'POST', endpoint, body }),
      put: (endpoint, body, options) => call({ ...options, method: 'PUT', endpoint, body }),
      patch: (endpoint, body, options) => call({ ...options, method: 'PATCH', endpoint, body }),
      delete: (endpoint, options) => call({ ...options, method: 'DELETE', endpoint }),
    };

    // plugin が HTTP メソッド名（delete 等）と同名メソッドを定義した場合に plugin を優先するため
    // httpMethods を先に展開し additionalMethods で後勝ちにする。call/extend/use は常に保持。
    const client: Client = {
      ...httpMethods,
      ...additionalMethods,
      call,
      extend,
      use,
    };

    return client;
  };

  // 追加メソッド無しの初期クライアント。空オブジェクトを空メソッド集合の起点にする
  return createExtended<Record<string, never>>({});
};

export const ApiClient = {
  withBearerAuth,
  withQueryAuth,
  createClient,
};

/**
 * クライアントにメソッドを追加するプラグイン
 *
 * @typeParam TResponse - クライアントのレスポンス型（`BaseClient<TResponse>` に一致させる）
 * @typeParam TNew - プラグインが追加するメソッドの型
 */
export type Plugin<TResponse, TNew extends object> = (client: BaseClient<TResponse>) => TNew;

export type { BaseClient, ClientConfig };
