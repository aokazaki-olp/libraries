'use strict';

/**
 * HttpClient.gs
 *
 * @description GAS上で動くHTTPクライアント群（HttpCore / ApiClient / WebhookClient）
 * @version 2.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 * @modified 2026-02-02
 *
 * 構成:
 *   HttpCore      - HTTP通信の共通基盤（Transport・デコレータ・ユーティリティ）
 *   ApiClient     - REST API用クライアント（baseUrl + endpoint 方式）
 *   WebhookClient - Webhook送信クライアント（フルURL方式）
 */

// ============================================================================
// HttpCore - HTTP通信の共通基盤
// ============================================================================

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

  // ─── ユーティリティ ─────────────────────────────────────────────

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

    return { status, headers, body, text };
  };

  // ─── Transport ──────────────────────────────────────────────────

  /**
   * 基本的なHTTP transportを作成
   *
   * @returns {Object} トランスポートオブジェクト
   */
  const createTransport = () => ({
    fetch: (url, options) => UrlFetchApp.fetch(url, options || {})
  });

  // ─── Decorators ─────────────────────────────────────────────────

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
                throw new Error(`リトライ回数上限に達しました (HTTP ${status})`);
              }
              const delay = sleepWithBackoff(attempt, delayMs);
              if (log) {
                log.warn(`[HTTP] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=${status} delay=${delay}ms ${method} ${url}`);
              }
              continue;
            }

            return response;

          } catch (e) {
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

// ============================================================================
// ApiClient - REST API用クライアント
// ============================================================================

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
   * @returns {Object} クライアント
   */
  const createClient = config => {
    // ─── 内部ユーティリティ（API専用） ────────────────────────────

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
      const ep = `/${trimLeftSlash(endpoint || '')}`;
      const url = baseUrl + ep;

      const qs = buildQueryString(query);
      if (!qs) {
        return url;
      }

      const separator = url.indexOf('?') === -1 ? '?' : '&';
      return url + separator + qs;
    };

    // ─── 設定 ─────────────────────────────────────────────────────

    const baseUrl = trimRightSlash(config.baseUrl || '');
    const transport = config.transport || HttpCore.createTransport();
    const log = LoggerFacade.createLogger(config.logger);
    const headers = config.headers || {};

    // ─── 公開インターフェース ─────────────────────────────────────

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

      const response = transport.fetch(url, options);
      return HttpCore.interpretResponse(response, request);
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
      transport: decorator(transport)
    });

    return { call, extend };
  };

  return { withBearerAuth, createClient };
})();

// ============================================================================
// WebhookClient - Webhook送信クライアント
// ============================================================================

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
    const opts = options || {};

    // Transport 構築
    let transport = HttpCore.createTransport();

    // リトライ機能（maxRetries: 0 で無効化可能）
    if (opts.maxRetries !== 0) {
      transport = HttpCore.withRetry(transport, {
        maxRetries: opts.maxRetries,
        baseDelayMs: opts.baseDelayMs,
        logger: opts.logger
      });
    }

    // ロギング機能
    if (opts.logger) {
      transport = HttpCore.withLogger(transport, opts.logger);
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
        opts.headers
      );

      const fetchOptions = {
        method: 'POST',
        headers,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      if (typeof opts.timeoutMs === 'number') {
        fetchOptions.timeout = opts.timeoutMs;
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
