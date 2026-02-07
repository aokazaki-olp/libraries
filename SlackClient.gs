'use strict';

/**
 * SlackClient.gs
 *
 * @description Slack用クライアント群（SlackCore / SlackApiClient / SlackWebhookClient）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 *
 * 構成:
 *   SlackCore          - Slack用共通基盤（Retry-After対応リトライ）
 *   SlackApiClient     - Slack Web API用クライアント（Bearer Token認証）
 *   SlackWebhookClient - Slack Incoming Webhooks用クライアント（URL認証）
 */

/**
 * SlackCore
 *
 * @description Slack用共通基盤（Retry-After対応リトライ）
 *
 * 設計思想:
 *   - HttpCore と同様の Decorator パターン
 *   - Slack 固有の Retry-After ヘッダーを尊重
 *   - SlackApiClient / SlackWebhookClient の共通部分を提供
 */
const SlackCore = (function () {
  /**
   * Slack用のリトライ機能をtransportに追加（Retry-Afterヘッダーを尊重）
   *
   * @param {Object} transport 基本トランスポート
   * @param {Object} retryOptions リトライ設定
   * @param {number} retryOptions.maxRetries 最大リトライ回数（デフォルト: 3）
   * @param {Object} retryOptions.logger ロガーインスタンス
   * @returns {Object} リトライ機能付きトランスポート
   */
  const withRetry = (transport, retryOptions = {}) => {
    const maxRetries = retryOptions.maxRetries ?? 3;
    const log = LoggerFacade.createLogger(retryOptions.logger);

    const sleepWithBackoff = attempt => {
      const delay = Math.pow(2, attempt) * 1000;
      Utilities.sleep(delay);
      return delay;
    };

    return {
      fetch: (url, options) => {
        const method = options?.method || 'GET';
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = transport.fetch(url, options);
            const status = response.getResponseCode();

            if (status === 429) {
              const headers = response.getAllHeaders();
              const retryAfter = headers['Retry-After'] || headers['retry-after'];
              const delaySeconds = parseInt(retryAfter, 10) || 1;
              const delayMs = delaySeconds * 1000;

              if (attempt === maxRetries) {
                if (log) {
                  log.error(`[Slack] ✖ RETRY exhausted status=${status} Retry-After=${delaySeconds}s ${method} ${url}`);
                }
                const retryError = new Error(`リトライ回数上限に達しました (HTTP ${status})`);
                retryError.name = 'RetryExhaustedError';
                throw retryError;
              }

              if (log) {
                log.warn(`[Slack] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=${status} Retry-After=${delaySeconds}s ${method} ${url}`);
              }
              Utilities.sleep(delayMs);
              continue;
            }

            if (status >= 500 && status < 600) {
              if (attempt === maxRetries) {
                if (log) {
                  log.error(`[Slack] ✖ RETRY exhausted status=${status} ${method} ${url}`);
                }
                const retryError = new Error(`リトライ回数上限に達しました (HTTP ${status})`);
                retryError.name = 'RetryExhaustedError';
                throw retryError;
              }
              const delay = sleepWithBackoff(attempt);
              if (log) {
                log.warn(`[Slack] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} status=${status} delay=${delay}ms ${method} ${url}`);
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
                log.error(`[Slack] ✖ RETRY exhausted ${method} ${url}`, e);
              }
              break;
            }
            const delay = sleepWithBackoff(attempt);
            if (log) {
              log.warn(`[Slack] ⚠ RETRY attempt=${attempt + 1}/${maxRetries} delay=${delay}ms ${method} ${url}`);
            }
          }
        }

        throw lastError || new Error('リトライ回数上限に達しました');
      }
    };
  };

  return { withRetry };
})();

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
   * Slack固有のレスポンスハンドラ
   *
   * @param {Object} response レスポンス
   * @param {Object} request リクエスト
   * @returns {Object} レスポンスボディ
   * @throws {Error} Slack APIエラー
   */
  const slackResponseHandler = (response, request) => {
    if (response.body && response.body.ok === false) {
      const errorCode = response.body.error || 'slack_error';
      const e = new Error(`Slack APIエラー: ${errorCode}`);
      e.name = 'SlackApiError';
      e.code = errorCode;
      e.metadata = response.body.response_metadata;
      e.response = response;
      throw e;
    }

    return response.body;
  };

  /**
   * Slack APIクライアントを作成
   *
   * @param {string} token Slack APIトークン
   * @param {Object} logger ロガーインスタンス
   * @returns {Object} クライアント
   */
  const create = (token, logger) => {
    return ApiClient.createClient({
      baseUrl: CONFIG.BASE_URL,
      transport: HttpCore.createTransport(),
      logger,
      responseHandler: slackResponseHandler
    })
      .extend(transport => ApiClient.withBearerAuth(transport, token))
      .extend(transport => SlackCore.withRetry(transport, { maxRetries: CONFIG.DEFAULT_MAX_RETRIES, logger }))
      .extend(transport => HttpCore.withLogger(transport, logger));
  };

  return { create };
})();

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
  const create = (webhookUrl, options = {}) => {
    const maxRetries = options.maxRetries ?? CONFIG.DEFAULT_MAX_RETRIES;

    // Transport 構築（Slack用リトライを使用）
    let transport = HttpCore.createTransport();

    if (maxRetries !== 0) {
      transport = SlackCore.withRetry(transport, { maxRetries, logger: options.logger });
    }

    if (options.logger) {
      transport = HttpCore.withLogger(transport, options.logger);
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

      if (typeof options.timeoutMs === 'number') {
        fetchOptions.timeout = options.timeoutMs;
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
