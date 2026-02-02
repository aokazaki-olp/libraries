'use strict';

/**
 * ApiClient
 * 
 * @description GAS上で動く汎用HTTPクライアント（イミュータブル・Decorator設計）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 * 
 * 設計思想:
 *   - extend() で機能を層々と積み重ねる（元のクライアントは変更しない）
 *   - メソッドは透過的（GET/POST/PUT/PATCH/DELETE/...）
 *   - クエリパラメータの構築は buildUrl のみが行う
 * 
 * 使用例:
 *   const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport: ApiClient.createTransport() });
 *   const authed = client.extend(t => ApiClient.withBearerAuth(t, token));
 *   const res = authed.call({ endpoint: '/users', method: 'GET' });
 */
const ApiClient = (function () {
  /** @type {Object} 設定情報 */
  const CONFIG = Object.freeze({
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  /**
   * ヘッダーオブジェクトをクローン
   * withBearerAuth・createClient・GoogleSearchConsoleApiClient から参照するため IIFE レベルで公開
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
   * 基本的なHTTP transportを作成
   *
   * @returns {Object} トランスポートオブジェクト
   */
  const createTransport = () => ({
    fetch: (url, options) => UrlFetchApp.fetch(url, options || {})
  });

  /**
   * Bearer認証をtransportに追加
   *
   * @param {Object} transport 基本トランスポート
   * @param {string} token Bearerトークン
   * @returns {Object} Bearer認証付きトランスポート
   */
  const withBearerAuth = (transport, token) => ({
    fetch: (url, options) => {
      const opts = options || {};
      const headers = cloneHeaders(opts.headers);
      headers.Authorization = `Bearer ${token}`;
      opts.headers = headers;
      return transport.fetch(url, opts);
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
   * @returns {Object} クライアント
   */
  const createClient = config => {
    // ─── 内部ユーティリティ（外に出ない） ───────────────────────
    // 以下は createClient のスコープに閉じる。const arrow で定義する。

    // 右側のスラッシュを削除
    const trimRightSlash = s => String(s).replace(/\/+$/, '');

    // 左側のスラッシュを削除
    const trimLeftSlash = s => String(s).replace(/^\/+/, '');

    // キーと値をURLエンコード
    const encodeKeyValue = (key, value) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`;

    /**
     * クエリパラメータをクエリ文字列に変換
     *
     * @param {Object} query クエリパラメータ
     * @returns {string} クエリ文字列
     */
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

    /**
     * URLを構築
     *
     * @param {string} baseUrl ベースURL
     * @param {string} endpoint エンドポイント
     * @param {Object} query クエリパラメータ
     * @returns {string} 完全なURL
     */
    const buildUrl = (baseUrl, endpoint, query) => {
      const ep = `/${trimLeftSlash(endpoint || '')}`;
      const url = baseUrl + ep;

      const qs = buildQueryString(query);
      if (!qs) {
        return url;
      }

      const separator = url.indexOf('?') === -1 ? '?' : '&';
      return url + separator + qs;
    };

    /**
     * ヘッダーをマージ
     *
     * @param {Object} headers ベースヘッダー
     * @param {Object} overrideHeaders 上書きヘッダー
     * @returns {Object} マージされたヘッダー
     */
    const mergeHeaders = (headers, overrideHeaders) => {
      const merged = cloneHeaders(headers);
      if (overrideHeaders) {
        for (const k in overrideHeaders) {
          if (Object.prototype.hasOwnProperty.call(overrideHeaders, k)) {
            merged[k] = overrideHeaders[k];
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
        if (String(k).toLowerCase() === needle) {
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

      return { status: status, headers: headers, body: body, text: text };
    };

    const baseUrl = trimRightSlash(config.baseUrl || '');
    const transport = config.transport;
    const log = LoggerFacade.createLogger(config.logger);
    const headers = config.headers || {};

    // ─── 公開インターフェース（return で外に出る） ──────────────
    // 以下は return { call, extend } で公開される。const arrow で定義する。

    /**
     * HTTPリクエストを実行
     *
     * @param {Object} request リクエストオブジェクト
     * @param {string} request.endpoint エンドポイント
     * @param {string} request.method HTTPメソッド（デフォルト: POST）
     * @param {Object} request.headers リクエストヘッダー
     * @param {Object} request.query クエリパラメータ
     * @param {Object} request.body リクエストボディ
     * @param {number} request.timeoutMs タイムアウト（ミリ秒）
     * @returns {Object} レスポンス
     */
    const call = request => {
      const method = (request.method || 'POST').toUpperCase();

      const url = buildUrl(baseUrl, request.endpoint, request.query);

      const mergedHeaders = mergeHeaders(headers, request.headers);

      const options = {
        method: method,
        headers: mergedHeaders,
        muteHttpExceptions: true
      };

      const hasBody = request.body != null;
      const canHaveBody = !/^(GET|HEAD)$/.test(method);

      if (hasBody) {
        if (canHaveBody) {
          options.payload = JSON.stringify(request.body);
          if (!hasHeader(mergedHeaders, 'Content-Type')) {
            mergedHeaders['Content-Type'] = 'application/json; charset=utf-8';
          }
        } else if (log) {
          log.warn(`[HTTP] ⚠ GETまたはHEADリクエストでbodyが検出されました。無視されます。 method=${method}, url=${url}`);
        }
      }

      if (typeof request.timeoutMs === 'number') {
        options.timeout = request.timeoutMs;
      }

      const response = transport.fetch(url, options);
      return interpretResponse(response, request);
    };

    /**
     * デコレータを適用して新しいクライアントを作成（イミュータブル）
     *
     * @param {Function} decorator トランスポートデコレータ
     * @returns {Object} 新しいクライアント
     */
    const extend = decorator => createClient({
      baseUrl: baseUrl,
      logger: log,
      headers: cloneHeaders(headers),
      transport: decorator(transport)
    });

    return { call: call, extend: extend };
  };

  /**
   * リトライ機能をtransportに追加
   *
   * @param {Object} transport 基本トランスポート
   * @param {Object} retryOptions リトライ設定
   * @param {number} retryOptions.maxRetries 最大リトライ回数（デフォルト: 3）
   * @param {number} retryOptions.baseDelayMs 基本遅延時間（ミリ秒、デフォルト: 500）
   * @returns {Object} リトライ機能付きトランスポート
   */
  const withRetry = (transport, retryOptions) => {
    const config = retryOptions || {};
    const maxRetries = config.maxRetries != null ? config.maxRetries : CONFIG.DEFAULT_MAX_RETRIES;
    const delayMs = config.baseDelayMs != null ? config.baseDelayMs : CONFIG.DEFAULT_BASE_DELAY_MS;

    // 指数バックオフでスリープ
    const sleepWithBackoff = (attempt, baseDelayMs) =>
      Utilities.sleep(Math.pow(2, attempt) * baseDelayMs);

    return {
      fetch: (url, options) => {
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = transport.fetch(url, options);
            const status = response.getResponseCode();

            if (status === 429 || (status >= 500 && status < 600)) {
              if (attempt === maxRetries) {
                throw new Error(`リトライ回数上限に達しました (HTTP ${status})`);
              }
              sleepWithBackoff(attempt, delayMs);
              continue;
            }

            return response;

          } catch (e) {
            lastError = e;
            if (attempt === maxRetries) {
              break;
            }
            sleepWithBackoff(attempt, delayMs);
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
    cloneHeaders: cloneHeaders,
    createTransport: createTransport,
    withBearerAuth: withBearerAuth,
    createClient: createClient,
    withRetry: withRetry,
    withLogger: withLogger
  };
})();
