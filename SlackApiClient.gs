'use strict';

/**
 * SlackApiClient
 * 
 * @description Slack Web API用クライアント（ApiClient基盤・Retry-After対応）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 * 
 * 設計思想:
 *   - ApiClient の Decorator パターンを基盤とする
 *   - 429レスポンスの際に Retry-After ヘッダーを尊重してスリープする
 *   - Slack APIは常にHTTP 200で返し、ok: false で通知するため個別エラーハンドリングを行う
 * 
 * 使用例:
 *   const client = SlackApiClient.create(token, logger);
 *   const res = client.call({ endpoint: 'chat.postMessage', body: { channel: 'C123', text: 'hi' } });
 */
const SlackApiClient = (function () {
  /** @type {Object} 設定情報 */
  const CONFIG = Object.freeze({
    BASE_URL: 'https://slack.com/api',
    DEFAULT_MAX_RETRIES: 3
  });

  /**
   * Slack API用のリトライ機能をtransportに追加（Retry-Afterヘッダーを尊重）
   *
   * @param {Object} transport 基本トランスポート
   * @param {Object} retryOptions リトライ設定
   * @param {number} retryOptions.maxRetries 最大リトライ回数（デフォルト: 3）
   * @returns {Object} リトライ機能付きトランスポート
   */
  const withRetry = (transport, retryOptions) => {
    const config = retryOptions || {};
    const maxRetries = config.maxRetries != null ? config.maxRetries : CONFIG.DEFAULT_MAX_RETRIES;

    // 指数バックオフでスリープ
    const sleepWithBackoff = attempt =>
      Utilities.sleep(Math.pow(2, attempt) * 1000);

    return {
      fetch: (url, options) => {
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = transport.fetch(url, options);
            const status = response.getResponseCode();

            if (status === 429) {
              if (attempt === maxRetries) {
                throw new Error(`リトライ回数上限に達しました (HTTP ${status})`);
              }

              // Retry-Afterヘッダーを取得（秒単位）
              const headers = response.getAllHeaders();
              const retryAfter = headers['Retry-After'] || headers['retry-after'];
              const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 1;
              const delayMs = delaySeconds * 1000;

              Utilities.sleep(delayMs);
              continue;
            }

            if (status >= 500 && status < 600) {
              if (attempt === maxRetries) {
                throw new Error(`リトライ回数上限に達しました (HTTP ${status})`);
              }
              sleepWithBackoff(attempt);
              continue;
            }

            return response;

          } catch (e) {
            lastError = e;
            if (attempt === maxRetries) {
              break;
            }
            sleepWithBackoff(attempt);
          }
        }

        throw lastError || new Error('リトライ回数上限に達しました');
      }
    };
  };

  /**
   * Slack APIクライアントを作成
   *
   * @param {string} token Slack APIトークン
   * @param {Object} logger ロガーインスタンス
   * @returns {Object} クライアント
   */
  const create = (token, logger) => {
    const client = ApiClient.createClient({
      baseUrl: CONFIG.BASE_URL,
      transport: HttpCore.createTransport(),
      logger: logger
    })
      .extend(transport => ApiClient.withBearerAuth(transport, token))
      .extend(transport => withRetry(transport, { maxRetries: CONFIG.DEFAULT_MAX_RETRIES }))
      .extend(transport => HttpCore.withLogger(transport, logger));

    /**
     * Slack APIを呼び出し
     *
     * @param {Object} request リクエストオブジェクト
     * @returns {Object} レスポンスボディ
     * @throws {Error} Slack APIエラー
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

      if (response.body && response.body.ok === false) {
        const errorCode = response.body.error || 'slack_error';
        const e = new Error(`Slack APIエラー: ${errorCode}`);
        e.name = 'SlackError';
        e.code = errorCode;
        e.metadata = response.body.response_metadata;
        e.response = response;
        throw e;
      }

      return response.body;
    };

    return { call: call };
  };

  return {
    withRetry: withRetry,
    create: create
  };
})();
