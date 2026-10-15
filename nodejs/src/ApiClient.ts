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

/** 追加メソッドの無い状態（keyof が never になるので、HTTP メソッドを 1 つも隠さない） */
type NoMethods = object;

/**
 * クライアントの型
 *
 * plugin が HTTP メソッド名（delete 等）を定義した場合、実行時は plugin が勝つ。型も同じにするため、
 * 上書きされた HTTP メソッドを Omit で外す（交差型のままだと元のシグネチャと混ざり、誤った呼び出しが通る）。
 */
type BaseClient<TResponse = unknown, TMethods extends object = NoMethods> = Omit<
  HttpMethods<TResponse>,
  keyof TMethods
> &
  TMethods & {
    call(request: RequestOptions): Promise<TResponse>;
    // extend はトランスポートのみ差し替え、追加メソッドはリセットされる（use()で再追加する）
    extend(decorator: (transport: Transport) => Transport): BaseClient<TResponse>;
    // plugin には追加メソッドを持たないコアのクライアントを渡す（他の plugin の上書きの影響を受けない）
    use<TNew extends object>(
      plugin: (client: BaseClient<TResponse>) => TNew,
    ): BaseClient<TResponse, TMethods & TNew>;
    use<TName extends string, TFn>(
      name: TName,
      factory: (client: BaseClient<TResponse>) => TFn,
    ): BaseClient<TResponse, TMethods & Record<TName, TFn>>;
  };

// ============================================================================
// ApiClient
// ============================================================================

interface ClientConfig<TResponse = RawResponse> {
  baseUrl: string;
  transport?: Transport;
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
 *   use() は次の場合に TypeError を投げる: plugin の戻り値がプレーンオブジェクトでない・列挙できない
 *   プロパティがある、メソッド名が call / extend / use または既存の plugin と重複する、use(name) に factory が無い。
 *   call() は GET / HEAD / DELETE に body を付けた場合と、body と rawBody を同時に指定した場合に
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

/** use() で足せない名前（クライアントの土台のメソッド） */
const RESERVED_METHODS: ReadonlySet<PropertyKey> = new Set(['call', 'extend', 'use']);

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

    if (hasRawBody && hasBody) {
      // rawBody が優先されて body が黙って捨てられるのを防ぐ
      throw new RequestValidationError(`body と rawBody は同時に指定できません (url: ${url})`);
    }
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
      headers: HttpCore.cloneHeaders(headers),
      transport: decorator(transport),
      responseHandler,
    });

  const createExtended = <TMethods extends object>(
    additionalMethods: TMethods,
  ): BaseClient<TResponse, TMethods> => {
    type Client = BaseClient<TResponse, TMethods>;

    function use<TNew extends object>(
      plugin: (core: BaseClient<TResponse>) => TNew,
    ): BaseClient<TResponse, TMethods & TNew>;
    function use<TName extends string, TFn>(
      name: TName,
      factory: (core: BaseClient<TResponse>) => TFn,
    ): BaseClient<TResponse, TMethods & Record<TName, TFn>>;
    function use(
      pluginOrName: ((core: BaseClient<TResponse>) => unknown) | string,
      factory?: (core: BaseClient<TResponse>) => unknown,
    ): unknown {
      let newMethods: unknown;

      if (typeof pluginOrName === 'string') {
        if (!factory) {
          throw new TypeError('use(name, factory) の形式では factory を指定してください');
        }
        newMethods = { [pluginOrName]: factory(coreClient) };
      } else {
        newMethods = pluginOrName(coreClient);
      }
      // plugin は利用者が書く境界。型が通っていても JS からは何でも返りうる
      if (typeof newMethods !== 'object' || newMethods === null || Array.isArray(newMethods)) {
        throw new TypeError('plugin の戻り値には Object を指定してください');
      }
      // メソッドはスプレッドで写すので、プロトタイプ上のメソッド（クラスのインスタンス）と
      // 列挙できないプロパティは黙って消える
      const prototype: unknown = Object.getPrototypeOf(newMethods);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('plugin の戻り値にはプレーンオブジェクトを指定してください');
      }
      const keys = Reflect.ownKeys(newMethods);
      const hidden = keys.filter(
        (key) => !Object.prototype.propertyIsEnumerable.call(newMethods, key),
      );
      if (hidden.length > 0) {
        throw new TypeError(
          `plugin の戻り値に列挙できないプロパティがあります: ${hidden.map(String).join(', ')}`,
        );
      }

      // call / extend / use はクライアントの土台なので、plugin の同名メソッドは使われない
      const reserved = keys.filter((key) => RESERVED_METHODS.has(key));
      if (reserved.length > 0) {
        throw new TypeError(
          `plugin のメソッド名に使えない名前です: ${reserved.map(String).join(', ')}`,
        );
      }
      // plugin 同士の同名メソッドは後勝ちにすると、先の plugin が黙って壊れる。
      // HTTP メソッド名（delete 等）の上書きは設計どおり許す
      const duplicated = keys.filter((key) => Object.hasOwn(additionalMethods, key));
      if (duplicated.length > 0) {
        throw new TypeError(
          `plugin のメソッド名が既存の plugin と重複しています: ${duplicated.map(String).join(', ')}`,
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

  // 追加メソッド無しの初期クライアント。plugin にはこれを渡す（use() が呼ばれるのは代入の後）
  const coreClient = createExtended<NoMethods>({});
  return coreClient;
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
