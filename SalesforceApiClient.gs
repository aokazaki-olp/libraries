'use strict';

/**
 * SalesforceApiClient.gs
 *
 * @description Salesforce REST API のプロトコル層クライアント。
 *              認証(Bearer)・リトライ・ロギング・baseUrl 構築のみを提供する。
 *              access_token と instanceUrl は呼び出し側が用意する
 *              (取得手段は SalesforceAuth.gs 等の別モジュール、もしくは外部)。
 *              SOQL クエリや sObject CRUD は呼び出し側で .use() する。
 *
 * 設計思想:
 *   - ApiClient の Decorator パターンを基盤とする
 *   - access_token のリフレッシュは本クライアントの責務外(疎結合)
 *
 * 使用例:
 *   const sf = SalesforceApiClient.create(instanceUrl, accessToken, { logger: console });
 *   const result = sf.get('/query', { q: 'SELECT Id, Name FROM Account LIMIT 10' });
 */
const SalesforceApiClient = (() => {
  const CONFIG = Object.freeze({
    DEFAULT_API_VERSION: 'v60.0',
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  const sfResponseHandler = response => response.body;

  /**
   * Salesforce API クライアントを作成
   *
   * @param {string} instanceUrl 例: 'https://your-org.my.salesforce.com'
   * @param {string} accessToken OAuth access_token
   * @param {Object} [options]
   * @param {string} [options.apiVersion] 例: 'v60.0' (デフォルト: CONFIG.DEFAULT_API_VERSION)
   * @param {Object} [options.logger] LoggerFacade 互換ロガー
   * @returns {Object} クライアント
   * @throws {TypeError} instanceUrl / accessToken が文字列でない場合
   */
  const create = (instanceUrl, accessToken, options = {}) => {
    if (typeof instanceUrl !== 'string' || instanceUrl === '') {
      throw new TypeError('instanceUrl には Salesforce instance URL (string) を指定してください');
    }
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new TypeError('accessToken には Salesforce OAuth access token (string) を指定してください');
    }
    const { apiVersion = CONFIG.DEFAULT_API_VERSION, logger } = options;
    const baseUrl = `${instanceUrl.replace(/\/+$/, '')}/services/data/${apiVersion}`;

    return ApiClient.createClient({
      baseUrl,
      transport: HttpCore.createTransport(),
      headers: { Accept: 'application/json' },
      logger,
      responseHandler: sfResponseHandler
    })
      .extend(transport => ApiClient.withBearerAuth(transport, accessToken))
      .extend(transport => HttpCore.withRetry(transport, {
        maxRetries: CONFIG.DEFAULT_MAX_RETRIES,
        baseDelayMs: CONFIG.DEFAULT_BASE_DELAY_MS,
        logger
      }))
      .extend(transport => HttpCore.withLogger(transport, logger));
  };

  return { create };
})();
