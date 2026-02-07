'use strict';

/**
 * HttpClient.gs
 *
 * @description GAS上で動くHTTPクライアント群（HttpCore / ApiClient / WebhookClient）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 *
 * 構成:
 *   HttpCore      - HTTP通信の共通基盤（Transport・デコレータ・ユーティリティ）
 *   ApiClient     - REST API用クライアント（baseUrl + endpoint 方式）
 *   WebhookClient - Webhook送信クライアント（フルURL方式）
 */

/**
 * HttpCore
 *
 * @description HTTP通信の共通基盤（Transport・デコレータ・ユーティリティ）
 *
 * 設計思想:
 *   - Transport パターンで HTTP 通信を抽象化
 *   - Decorator パターンで機能を積み重ねる
 *   - ApiClient / WebhookClient の共通部分を提供
 *
 * 使用例:
 *   let transport = HttpCore.createTransport();
 *   transport = HttpCore.withRetry(transport, { maxRetries: 3 });
 *   transport = HttpCore.withLogger(transport, logger);
 */
const HttpCore = (function () {
  /** @type {Object} 設定情報 */
  const CONFIG = Object.freeze({
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  /**
   * ヘッダーオブジェクトをクローン
   *
   * @param {Object} headers クローン元ヘッダー
   * @returns {Object} クローンされたヘッダー
   */
  const cloneHeaders = headers => {
    const cloned = {};
    if (!headers) {
      return cloned;
    }
    for (const k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) {
        cloned[k] = headers[k];
      }
    }
    return cloned;
  };

  /**
   * ヘッダーをマージ
   *
   * @param {Object} base ベースヘッダー
   * @param {Object} override 上書きヘッダー
   * @returns {Object} マージされたヘッダー
   */
  const mergeHeaders = (base, override) => {
    const merged = cloneHeaders(base);
    if (override) {
      for (const k in override) {
        if (Object.prototype.hasOwnProperty.call(override, k)) {
          merged[k] = override[k];
        }
      }
    }
    return merged;
  };

  /**
   * ヘッダーの存在確認（大文字小文字を区別しない）
   *
   * @param {Object} headers ヘッダー
   * @param {string} key 検索するキー
   * @returns {boolean} 存在する場合true
   */
  const hasHeader = (headers, key) => {
    const needle = String(key).toLowerCase();
    for (const k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k) && String(k).toLowerCase() === needle) {
        return true;
      }
    }
    return false;
  };

  /**
   * レスポンスを解釈してエラーハンドリング
   *
   * @param {Object} response HTTPレスポンス
   * @param {Object} request リクエストオブジェクト
   * @returns {Object} 解釈されたレスポンス
   * @throws {Error} HTTPエラーの場合
   */
  const interpretResponse = (response, request) => {
    const status = response.getResponseCode();
    const headers = response.getAllHeaders();
    const text = response.getContentText();
    let body = null;

    if (text) {
      try {
        body = JSON.parse(text);
      } catch { // JSON パースに失敗した場合は生テキストを使用
        body = text;
      }
    }

    if (status < 200 || status >= 300) {
      const e = new Error(`HTTPエラー ${status}`);
      e.name = 'HttpError';
      e.status = status;
      e.headers = headers;
      e.body = body;
      e.text = text;
      e.request = request;
      throw e;
    }

    return { status, headers, body, text };
  };

  /**
   * 基本的なHTTP transportを作成
   *
   * @returns {Object} トランスポートオブジェクト
   */
  const createTransport = () => ({
    fetch: (url, options) => UrlFetchApp.fetch(url, options || {})
  });

  /**
   * リトライ機能をtransportに追加
   *
   * @param {Object} transport 基本トランスポート
   * @param {Object} retryOptions リトライ設定
   * @param {number} retryOptions.maxRetries 最大リトライ回数（デフォルト: 3）
   * @param {number} retryOptions.baseDelayMs 基本遅延時間（ミリ秒、デフォルト: 500）
   * @param {Object} retryOptions.logger ロガーインスタンス
   * @returns {Object} リトライ機能付きトランスポート
   */
  const withRetry = (transport, retryOptions) => {
    const config = retryOptions || {};
    const maxRetries = config.maxRetries != null ? config.maxRetries : CONFIG.DEFAULT_MAX_RETRIES;
    const delayMs = config.baseDelayMs != null ? config.baseDelayMs : CONFIG.DEFAULT_BASE_DELAY_MS;
    const log = LoggerFacade.createLogger(config.logger);

    const sleepWithBackoff = (attempt, baseDelayMs) => {
      const delay = Math.pow(2, attempt) * baseDelayMs;
      Utilities.sleep(delay);
      return delay;
    };

    return {
      fetch: (url, options) => {
        const method = options && options.method ? options.method : 'GET';
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = transport.fetch(url, options);
            const status = response.getResponseCode();

            if (status === 429 || (status >= 500 && status < 600)) {
              if (attempt === maxRetries) {
                if (log) {
                  log.error(`[HTTP] ✖ RETRY exhausted status=${status} ${method} ${url}`);
                }
                const retryError = new Error(`リトライ回数上限に達しました (HTTP ${status})`);
                retryError.name = 'RetryExhaustedError';
                throw retryError;
              }
              const delay = sleepWithBackoff(attempt, delayMs);
              if (log) {
                log.warn(`[HTTP] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=${status} delay=${delay}ms ${method} ${url}`);
              }
              continue;
            }

            return response;

          } catch (e) {
            // リトライ上限エラーは再スローする（二重ログを防ぐ）
            if (e.name === 'RetryExhaustedError') {
              throw e;
            }
            lastError = e;
            if (attempt === maxRetries) {
              if (log) {
                log.error(`[HTTP] ✖ RETRY exhausted ${method} ${url}`, e);
              }
              break;
            }
            const delay = sleepWithBackoff(attempt, delayMs);
            if (log) {
              log.warn(`[HTTP] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} delay=${delay}ms ${method} ${url}`);
            }
          }
        }

        throw lastError || new Error('リトライ回数上限に達しました');
      }
    };
  };

  /**
   * ロギング機能をtransportに追加
   *
   * @param {Object} transport 基本トランスポート
   * @param {Object} logger ロガーインスタンス
   * @returns {Object} ロギング機能付きトランスポート
   */
  const withLogger = (transport, logger) => {
    const log = LoggerFacade.createLogger(logger);
    if (!log) {
      return transport;
    }

    return {
      fetch: (url, options) => {
        const method = options && options.method ? options.method : 'GET';
        const startMs = Date.now();

        log.debug(`[HTTP] → ${method} ${url}`);

        try {
          const response = transport.fetch(url, options);
          const elapsedMs = Date.now() - startMs;

          log.info(`[HTTP] ← ${response.getResponseCode()} ${method} ${url} ${elapsedMs}ms`);

          return response;

        } catch (e) {
          const elapsedMs = Date.now() - startMs;

          log.error(`[HTTP] ✖ ${method} ${url} ${elapsedMs}ms`, e);

          throw e;
        }
      }
    };
  };

  return {
    CONFIG,
    cloneHeaders,
    mergeHeaders,
    hasHeader,
    interpretResponse,
    createTransport,
    withRetry,
    withLogger
  };
})();

/**
 * ClientHelper
 *
 * @description クライアント拡張の共通ヘルパー
 */
const ClientHelper = (function () {

  /**
   * HTTP メソッドショートカットを生成
   *
   * @param {Function} call call 関数
   * @returns {Object} { get, post, put, patch, delete }
   */
  const createHttpMethods = call => ({
    get: (endpoint, query, options) =>
      call({ ...options, method: 'GET', endpoint, query }),
    post: (endpoint, body, options) =>
      call({ ...options, method: 'POST', endpoint, body }),
    put: (endpoint, body, options) =>
      call({ ...options, method: 'PUT', endpoint, body }),
    patch: (endpoint, body, options) =>
      call({ ...options, method: 'PATCH', endpoint, body }),
    delete: (endpoint, options) =>
      call({ ...options, method: 'DELETE', endpoint })
  });

  /**
   * use() 機能付きクライアントを作成
   *
   * @param {Function} call call 関数
   * @param {Object} [options] オプション
   * @param {Function} [options.extend] extend 関数
   * @returns {Object} クライアント { call, use, get, post, put, patch, delete, [extend] }
   */
  const createClient = (call, clientOptions) => {
    const methods = createHttpMethods(call);

    const createExtended = additionalMethods => {
      const client = { ...additionalMethods, call, ...methods };

      if (clientOptions && clientOptions.extend) {
        client.extend = clientOptions.extend;
      }

      /**
       * Plugin を注入してクライアントを拡張
       *
       * @param {Function|string} pluginOrName - Plugin関数 or メソッド名
       * @param {Function} [fn] - メソッド名の場合、メソッド定義関数
       * @returns {Object} 拡張されたクライアント
       *
       * @example
       * // Plugin パターン
       * client.use(client => ({
       *   myMethod: () => client.call({ ... })
       * }))
       *
       * // 単体メソッドパターン
       * client.use('myMethod', client => () => client.call({ ... }))
       */
      client.use = (pluginOrName, fn) => {
        let newMethods;

        if (typeof pluginOrName === 'string') {
          newMethods = { [pluginOrName]: fn(client) };
        } else {
          newMethods = pluginOrName(client);
        }

        return createExtended({ ...additionalMethods, ...newMethods });
      };

      return client;
    };

    return createExtended({});
  };

  return { createHttpMethods, createClient };
})();

/**
 * ApiClient
 *
 * @description REST API用クライアント（baseUrl + endpoint 方式）
 *
 * 設計思想:
 *   - extend() で機能を層々と積み重ねる（元のクライアントは変更しない）
 *   - メソッドは透過的（GET/POST/PUT/PATCH/DELETE/...）
 *   - クエリパラメータの構築は buildUrl のみが行う
 *
 * 使用例:
 *   const client = ApiClient.createClient({ baseUrl: 'https://api.example.com' });
 *   const authed = client.extend(t => ApiClient.withBearerAuth(t, token));
 *   const res = authed.call({ endpoint: '/users', method: 'GET' });
 */
const ApiClient = (function () {

  /**
   * Bearer認証をtransportに追加
   *
   * @param {Object} transport 基本トランスポート
   * @param {string} token Bearerトークン
   * @returns {Object} Bearer認証付きトランスポート
   */
  const withBearerAuth = (transport, token) => ({
    fetch: (url, options) => {
      const headers = HttpCore.cloneHeaders(options && options.headers);
      headers.Authorization = `Bearer ${token}`;
      return transport.fetch(url, { ...options, headers });
    }
  });

  /**
   * HTTPクライアントを作成
   *
   * @param {Object} config 設定オブジェクト
   * @param {string} config.baseUrl ベースURL
   * @param {Object} config.transport トランスポートオブジェクト
   * @param {Object} config.logger ロガーインスタンス
   * @param {Object} config.headers デフォルトヘッダー
   * @param {Function} config.responseHandler レスポンス後処理関数
   * @returns {Object} クライアント
   */
  const createClient = config => {
    const trimRightSlash = s => String(s).replace(/\/+$/, '');
    const trimLeftSlash = s => String(s).replace(/^\/+/, '');
    const encodeKeyValue = (key, value) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`;

    const buildQueryString = query => {
      if (!query) {
        return '';
      }
      const parts = [];
      for (const k in query) {
        if (!Object.prototype.hasOwnProperty.call(query, k)) {
          continue;
        }
        const v = query[k];
        if (v == null) {
          continue;
        }
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            parts.push(encodeKeyValue(k, v[i]));
          }
        } else {
          parts.push(encodeKeyValue(k, v));
        }
      }
      return parts.join('&');
    };

    const buildUrl = (baseUrl, endpoint, query) => {
      const path = `/${trimLeftSlash(endpoint || '')}`;
      const url = baseUrl + path;

      const queryString = buildQueryString(query);
      if (!queryString) {
        return url;
      }

      const separator = url.indexOf('?') === -1 ? '?' : '&';
      return url + separator + queryString;
    };

    const baseUrl = trimRightSlash(config.baseUrl || '');
    const transport = config.transport || HttpCore.createTransport();
    const log = LoggerFacade.createLogger(config.logger);
    const headers = config.headers || {};
    const responseHandler = config.responseHandler || null;

    /**
     * HTTPリクエストを実行
     *
     * @param {Object} request リクエストオブジェクト
     * @param {string} request.endpoint エンドポイント
     * @param {string} request.method HTTPメソッド（デフォルト: GET）
     * @param {Object} request.headers リクエストヘッダー
     * @param {Object} request.query クエリパラメータ
     * @param {Object} request.body リクエストボディ
     * @param {number} request.timeoutMs タイムアウト（ミリ秒）
     * @returns {Object} レスポンス
     */
    const call = request => {
      const method = (request.method || 'GET').toUpperCase();

      const url = buildUrl(baseUrl, request.endpoint, request.query);

      const mergedHeaders = HttpCore.mergeHeaders(headers, request.headers);

      const options = {
        method,
        headers: mergedHeaders,
        muteHttpExceptions: true
      };

      const hasBody = request.body != null;
      const canHaveBody = !/^(GET|HEAD)$/.test(method);

      if (hasBody) {
        if (canHaveBody) {
          options.payload = JSON.stringify(request.body);
          if (!HttpCore.hasHeader(mergedHeaders, 'Content-Type')) {
            mergedHeaders['Content-Type'] = 'application/json; charset=utf-8';
          }
        } else if (log) {
          log.warn(`[HTTP] ⚠ GETまたはHEADリクエストでbodyが検出されました。無視されます。 method=${method}, url=${url}`);
        }
      }

      if (typeof request.timeoutMs === 'number') {
        options.timeout = request.timeoutMs;
      }

      const rawResponse = transport.fetch(url, options);
      const response = HttpCore.interpretResponse(rawResponse, request);

      return responseHandler ? responseHandler(response, request) : response;
    };

    /**
     * デコレータを適用して新しいクライアントを作成（イミュータブル）
     *
     * @param {Function} decorator トランスポートデコレータ
     * @returns {Object} 新しいクライアント
     */
    const extend = decorator => createClient({
      baseUrl,
      logger: log,
      headers: HttpCore.cloneHeaders(headers),
      transport: decorator(transport),
      responseHandler
    });

    return ClientHelper.createClient(call, { extend });
  };

  return { withBearerAuth, createClient };
})();

/**
 * WebhookClient
 *
 * @description Webhook送信クライアント（フルURL方式）
 *
 * 設計思想:
 *   - LazyTemplate 方式: create() でインスタンス生成、send() で静的呼び出し
 *   - シンプルなインターフェースで Webhook 送信に特化
 *   - HttpCore を基盤として利用
 *
 * 使用例:
 *   // 1回限りの送信
 *   WebhookClient.send(webhookUrl, { text: 'Hello' });
 *
 *   // 繰り返し送信
 *   const client = WebhookClient.create(webhookUrl, { logger: console });
 *   client.send({ text: 'Message 1' });
 *   client.send({ text: 'Message 2' });
 */
const WebhookClient = (function () {

  /**
   * Webhookクライアントを作成
   *
   * @param {string} webhookUrl WebhookのURL
   * @param {Object} options オプション
   * @param {number} options.maxRetries 最大リトライ回数（デフォルト: 3）
   * @param {number} options.baseDelayMs 基本遅延時間（ミリ秒、デフォルト: 500）
   * @param {number} options.timeoutMs タイムアウト（ミリ秒）
   * @param {Object} options.logger ロガーインスタンス
   * @param {Object} options.headers カスタムヘッダー
   * @returns {Object} クライアント
   */
  const create = (webhookUrl, options) => {
    options = options || {};

    // Transport 構築
    let transport = HttpCore.createTransport();

    // リトライ機能（maxRetries: 0 で無効化可能）
    if (options.maxRetries !== 0) {
      transport = HttpCore.withRetry(transport, {
        maxRetries: options.maxRetries,
        baseDelayMs: options.baseDelayMs,
        logger: options.logger
      });
    }

    // ロギング機能
    if (options.logger) {
      transport = HttpCore.withLogger(transport, options.logger);
    }

    /**
     * Webhookにペイロードを送信
     *
     * @param {Object} payload 送信するペイロード
     * @returns {Object} レスポンス { status, headers, body, text }
     */
    const send = payload => {
      const headers = HttpCore.mergeHeaders(
        { 'Content-Type': 'application/json; charset=utf-8' },
        options.headers
      );

      const fetchOptions = {
        method: 'POST',
        headers,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      if (typeof options.timeoutMs === 'number') {
        fetchOptions.timeout = options.timeoutMs;
      }

      const response = transport.fetch(webhookUrl, fetchOptions);
      return HttpCore.interpretResponse(response, { url: webhookUrl, body: payload });
    };

    return { send };
  };

  /**
   * Webhookにペイロードを送信（静的メソッド・1回限り）
   *
   * @param {string} webhookUrl WebhookのURL
   * @param {Object} payload 送信するペイロード
   * @param {Object} options オプション（create と同じ）
   * @returns {Object} レスポンス { status, headers, body, text }
   */
  const send = (webhookUrl, payload, options) => {
    return create(webhookUrl, options).send(payload);
  };

  return { create, send };
})();
