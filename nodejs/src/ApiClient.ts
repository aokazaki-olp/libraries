/**
 * ApiClient.ts
 * @description REST API用クライアント（baseUrl + endpoint 方式）
 *
 * 設計思想:
 *   - extend() でTransportデコレータを積み重ねる（イミュータブル）
 *   - use() でドメインメソッドをプラグインとして追加
 *   - call() が async になった以外、GAS版と同じAPI
 */

import { LoggerFacade } from './LoggerFacade.js';
import type { Logger } from './LoggerFacade.js';
import { HttpCore } from './HttpCore.js';
import type {
  FetchOptions,
  RawResponse,
  RequestOptions,
  Transport,
} from './httpTypes.js';

export type ResponseHandler<T = unknown> = (
  response: RawResponse,
  request: RequestOptions,
) => T;

// ============================================================================
// URL・クエリ文字列ユーティリティ
// ============================================================================

const trimRightSlash = (s: string): string => s.replace(/\/+$/, '');
const trimLeftSlash = (s: string): string => s.replace(/^\/+/, '');

const encodeKeyValue = (key: string, value: unknown): string =>
  `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`;

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

type HttpMethods<TResponse> = {
  get(endpoint: string, query?: Record<string, unknown>, options?: Partial<RequestOptions>): Promise<TResponse>;
  post(endpoint: string, body?: unknown, options?: Partial<RequestOptions>): Promise<TResponse>;
  put(endpoint: string, body?: unknown, options?: Partial<RequestOptions>): Promise<TResponse>;
  patch(endpoint: string, body?: unknown, options?: Partial<RequestOptions>): Promise<TResponse>;
  delete(endpoint: string, options?: Omit<Partial<RequestOptions>, 'body'>): Promise<TResponse>;
};

type BaseClient<TResponse = unknown, TMethods extends object = Record<string, never>> =
  HttpMethods<TResponse> &
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

interface ClientConfig<TResponse = unknown> {
  baseUrl: string;
  transport?: Transport;
  logger?: Logger;
  headers?: Record<string, string>;
  responseHandler?: ResponseHandler<TResponse>;
}

/**
 * HTTPクライアントを作成する
 *
 * @param config - クライアント設定
 * @returns クライアント（call/get/post/put/patch/delete/extend/use）。use() は TypeError をスローする場合がある
 */
const createClient = <TResponse = unknown>(
  config: ClientConfig<TResponse>,
): BaseClient<TResponse> => {
  const baseUrl = trimRightSlash(config.baseUrl);
  const transport = config.transport ?? HttpCore.createTransport();
  const log = LoggerFacade.createLogger(config.logger);
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

    if (hasRawBody) {
      if (canHaveBody) {
        options.payload = request.rawBody;
      } else {
        log?.warn(`[HTTP] ⚠ ${method}リクエストでrawBodyが検出されました。無視されます。 url=${url}`);
      }
    } else if (hasBody) {
      if (canHaveBody) {
        options.payload = JSON.stringify(request.body);
        if (!HttpCore.hasHeader(mergedHeaders, 'Content-Type')) {
          mergedHeaders['Content-Type'] = 'application/json; charset=utf-8';
        }
      } else {
        log?.warn(`[HTTP] ⚠ ${method}リクエストでbodyが検出されました。無視されます。 url=${url}`);
      }
    }

    if (typeof request.timeoutMs === 'number') {
      options.timeoutMs = request.timeoutMs;
    }

    const rawResponse: RawResponse = await transport.fetch(url, options);

    return responseHandler
      ? responseHandler(rawResponse, request)
      : (rawResponse as unknown as TResponse); // responseHandler 省略時は RawResponse === TResponse を呼び出し側が保証する
  };

  const extend = (decorator: (transport: Transport) => Transport): BaseClient<TResponse> =>
    createClient<TResponse>({
      baseUrl,
      logger: config.logger,
      headers: HttpCore.cloneHeaders(headers),
      transport: decorator(transport),
      responseHandler,
    });

  const createExtended = <TMethods extends object>(
    additionalMethods: TMethods,
  ): BaseClient<TResponse, TMethods> => {
    // eslint-disable-next-line prefer-const
    let client: BaseClient<TResponse, TMethods>;

    const use = (<TNew extends object>(
      pluginOrName: ((c: BaseClient<TResponse, TMethods>) => TNew) | string,
      fn?: (c: BaseClient<TResponse, TMethods>) => unknown,
    ) => {
      let newMethods: object;

      if (typeof pluginOrName === 'string') {
        if (!fn) {
          throw new TypeError('use(name, fn) の形式では fn を指定してください');
        }
        newMethods = { [pluginOrName]: fn(client) };
      } else {
        newMethods = pluginOrName(client);
        if (typeof newMethods !== 'object' || newMethods === null || Array.isArray(newMethods)) {
          throw new TypeError('plugin の戻り値には Object を指定してください');
        }
      }

      return createExtended({ ...additionalMethods, ...newMethods });
    }) as BaseClient<TResponse, TMethods>['use']; // use のオーバーロードシグネチャは条件型で表現されており、実装シグネチャと型が一致しない

    const httpMethods: HttpMethods<TResponse> = {
      get: (endpoint, query, options) =>
        call({ ...options, method: 'GET', endpoint, query }),
      post: (endpoint, body, options) =>
        call({ ...options, method: 'POST', endpoint, body }),
      put: (endpoint, body, options) =>
        call({ ...options, method: 'PUT', endpoint, body }),
      patch: (endpoint, body, options) =>
        call({ ...options, method: 'PATCH', endpoint, body }),
      delete: (endpoint, options) =>
        // Omit<Partial<RequestOptions>, 'body'> はスプレッド時に Partial<RequestOptions> として推論されないためキャスト
        call({ ...options as Partial<RequestOptions>, method: 'DELETE', endpoint }),
    };

    client = {
      ...additionalMethods,
      ...httpMethods,
      call,
      extend,
      use,
    } as unknown as BaseClient<TResponse, TMethods>; // スプレッド合成は型システムで証明不能: additionalMethods ∪ HttpMethods

    return client;
  };

  return createExtended({} as Record<string, never>);
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
export type Plugin<TResponse, TNew extends object> =
  (client: BaseClient<TResponse>) => TNew;

export type { BaseClient, ClientConfig };
