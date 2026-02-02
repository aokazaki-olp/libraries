'use strict';

/**
 * SlackClient.gs
 *
 * @description Slack用クライアント群（SlackApiClient / SlackWebhookClient）
 * @version 2.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 * @modified 2026-02-02
 *
 * 構成:
 *   SlackApiClient     - Slack Web API用クライアント（Bearer Token認証）
 *   SlackWebhookClient - Slack Incoming Webhooks用クライアント（URL認証）
 */

// ============================================================================
// 共通: Slack用リトライ機能（Retry-After対応）
// ============================================================================

/**
 * Slack用のリトライ機能をtransportに追加（Retry-Afterヘッダーを尊重）
 *
 * @param {Object} transport 基本トランスポート
 * @param {Object} retryOptions リトライ設定
 * @param {number} retryOptions.maxRetries 最大リトライ回数（デフォルト: 3）
 * @returns {Object} リトライ機能付きトランスポート
 */
const withSlackRetry = (transport, retryOptions) => {
  const config = retryOptions || {};
  const maxRetries = config.maxRetries != null ? config.maxRetries : 3;

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

// ============================================================================
// SlackApiClient - Slack Web API用クライアント
// ============================================================================

/**
 * SlackApiClient
 *
 * @description Slack Web API用クライアント（ApiClient基盤・Retry-After対応）
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
  const CONFIG = Object.freeze({
    BASE_URL: 'https://slack.com/api',
    DEFAULT_MAX_RETRIES: 3
  });

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
      logger
    })
      .extend(transport => ApiClient.withBearerAuth(transport, token))
      .extend(transport => withSlackRetry(transport, { maxRetries: CONFIG.DEFAULT_MAX_RETRIES }))
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

    return { call };
  };

  return { create };
})();

// ============================================================================
// SlackWebhookClient - Slack Incoming Webhooks用クライアント
// ============================================================================

/**
 * SlackWebhookClient
 *
 * @description Slack Incoming Webhooks用クライアント（WebhookClient基盤・Retry-After対応）
 *
 * 設計思想:
 *   - WebhookClient をベースとしつつ Slack 固有のリトライを適用
 *   - LazyTemplate 方式: create() でインスタンス生成、send() で静的呼び出し
 *   - Block Kit / Attachments 対応
 *
 * 使用例:
 *   // 1回限りの送信
 *   SlackWebhookClient.send(webhookUrl, { text: 'Hello!' });
 *
 *   // Block Kit
 *   SlackWebhookClient.send(webhookUrl, {
 *     blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Hello*' } }]
 *   });
 *
 *   // 繰り返し送信
 *   const client = SlackWebhookClient.create(webhookUrl, { logger: console });
 *   client.send({ text: 'Message 1' });
 *   client.send({ text: 'Message 2' });
 */
const SlackWebhookClient = (function () {
  const CONFIG = Object.freeze({
    DEFAULT_MAX_RETRIES: 3
  });

  /**
   * Slack Webhookクライアントを作成
   *
   * @param {string} webhookUrl WebhookのURL
   * @param {Object} options オプション
   * @param {number} options.maxRetries 最大リトライ回数（デフォルト: 3）
   * @param {number} options.timeoutMs タイムアウト（ミリ秒）
   * @param {Object} options.logger ロガーインスタンス
   * @returns {Object} クライアント
   */
  const create = (webhookUrl, options) => {
    const opts = options || {};
    const maxRetries = opts.maxRetries != null ? opts.maxRetries : CONFIG.DEFAULT_MAX_RETRIES;

    // Transport 構築（Slack用リトライを使用）
    let transport = HttpCore.createTransport();

    if (maxRetries !== 0) {
      transport = withSlackRetry(transport, { maxRetries });
    }

    if (opts.logger) {
      transport = HttpCore.withLogger(transport, opts.logger);
    }

    /**
     * Slack Webhookにペイロードを送信
     *
     * @param {Object} payload 送信するペイロード
     * @param {string} payload.text テキストメッセージ
     * @param {Array} payload.blocks Block Kit ブロック
     * @param {Array} payload.attachments アタッチメント
     * @param {string} payload.channel チャンネル上書き（Webhook設定で許可されている場合）
     * @param {string} payload.username ユーザー名上書き
     * @param {string} payload.icon_emoji アイコン絵文字上書き
     * @param {string} payload.icon_url アイコンURL上書き
     * @returns {Object} レスポンス { status, headers, body, text }
     */
    const send = payload => {
      const headers = { 'Content-Type': 'application/json; charset=utf-8' };

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
      const status = response.getResponseCode();
      const text = response.getContentText();

      // Slack Webhookは成功時 "ok" を返す
      if (status >= 200 && status < 300) {
        return { status, headers: response.getAllHeaders(), body: text, text };
      }

      // エラー処理
      const e = new Error(`Slack Webhookエラー: ${text || `HTTP ${status}`}`);
      e.name = 'SlackWebhookError';
      e.status = status;
      e.body = text;
      throw e;
    };

    return { send };
  };

  /**
   * Slack Webhookにペイロードを送信（静的メソッド・1回限り）
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
