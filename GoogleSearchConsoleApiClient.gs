'use strict';

/**
 * GoogleSearchConsoleApiClient
 * 
 * @description Google Search Console API用クライアント（ApiClient基盤・OAuth動的取得）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 * 
 * 設計思想:
 *   - ApiClient の Decorator パターンを基盤とする
 *   - ScriptApp.getOAuthToken() で毎回動的にトークンを取得する（静的トークン設定とは異なる）
 *   - リトライは ApiClient.withRetry を再利用し、レートリミットに合わせて緩やかな設定にある
 * 
 * 使用例:
 *   const client = GoogleSearchConsoleApiClient.create('https://example.com/', logger);
 *   const res = client.call({ endpoint: '/search-analytics/query', body: { startDate: '2026-01-01', endDate: '2026-01-31' } });
 */
const GoogleSearchConsoleApiClient = (function () {
  /** @type {Object} 設定情報 */
  const CONFIG = Object.freeze({
    BASE_URL: 'https://searchconsole.googleapis.com/webmasters/v3',
    DEFAULT_MAX_RETRIES: 5,
    DEFAULT_BASE_DELAY_MS: 1000
  });

  /**
   * Google OAuth認証をtransportに追加
   *
   * @param {Object} transport 基本トランスポート
   * @returns {Object} Google OAuth認証付きトランスポート
   */
  const withGoogleAuth = transport => ({
    fetch: (url, options) => {
      const opts = options || {};
      const headers = ApiClient.cloneHeaders(opts.headers);

      // Google OAuthトークンを取得
      const token = ScriptApp.getOAuthToken();
      headers.Authorization = `Bearer ${token}`;

      opts.headers = headers;
      return transport.fetch(url, opts);
    }
  });

  /**
   * Google Search Console APIクライアントを作成
   *
   * @param {string} siteUrl サイトURL
   * @param {Object} logger ロガーインスタンス
   * @returns {Object} クライアント
   */
  const create = (siteUrl, logger) => {
    // サイトURLを正規化（sc-domain対応、末尾スラッシュ統一）
    const normalizeSiteUrl = url => {
      const s = String(url || '').trim();
      if (s.indexOf('sc-domain:') === 0) {
        return s;
      }
      return s.replace(/\/?$/, '/');
    };

    const client = ApiClient.createClient({
      baseUrl: `${CONFIG.BASE_URL}/sites/${encodeURIComponent(normalizeSiteUrl(siteUrl))}`,
      transport: ApiClient.createTransport(),
      logger: logger
    })
      .extend(withGoogleAuth)
      .extend(transport => ApiClient.withRetry(transport, { 
        maxRetries: CONFIG.DEFAULT_MAX_RETRIES, 
        baseDelayMs: CONFIG.DEFAULT_BASE_DELAY_MS 
      }))
      .extend(transport => ApiClient.withLogger(transport, logger));

    /**
     * Google Search Console APIを呼び出し
     *
     * @param {Object} request リクエストオブジェクト
     * @returns {Object} レスポンスボディ
     */
    const call = request => {
      const response = client.call({
        endpoint: request.endpoint,
        method: request.method || 'POST',
        headers: request.headers,
        query: request.query,
        body: request.body,
        timeoutMs: request.timeoutMs
      });

      return response.body;
    };

    return { call: call };
  };

  return {
    withGoogleAuth: withGoogleAuth,
    create: create
  };
})();
