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
 *
 *   // .use() で呼び出し側にドメインメソッドを生やす(PHILOSOPHY §4.2)
 *   const sugared = sf.use('queryAll', c => soql => c.get('/query', { q: soql }));
 *   sugared.queryAll('SELECT Id FROM Account');
 */
const SalesforceApiClient = (() => {
  const CONFIG = Object.freeze({
    DEFAULT_API_VERSION: 'v60.0', // 実装時点（2026-05）の最新安定版
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  const API_VERSION_PATTERN = /^v\d+\.\d+$/;

  /**
   * Salesforce レスポンスハンドラ。
   * body のみを返し、status / headers (Sforce-Limit-Info / X-Sfdc-Request-Id 等) は捨てる。
   * これらが必要な場合は responseHandler を差し替えるか extend で対処する。
   */
  const sfResponseHandler = response => response.body;

  /**
   * Salesforce API クライアントを作成
   *
   * @param {string} instanceUrl 例: 'https://your-org.my.salesforce.com'
   * @param {string} accessToken OAuth access_token
   * @param {Object} [options]
   * @param {string} [options.apiVersion] 例: 'v60.0' (デフォルト: CONFIG.DEFAULT_API_VERSION)。形式は /^v\\d+\\.\\d+$/
   * @param {number} [options.maxRetries] 最大リトライ回数 (デフォルト: 3)
   * @param {number} [options.baseDelayMs] リトライ基本遅延ミリ秒 (デフォルト: 500)
   * @param {Object} [options.logger] LoggerFacade 互換ロガー
   * @returns {Object} クライアント (call/get/post/put/patch/delete/use/extend)
   * @throws {TypeError} instanceUrl / accessToken が文字列でない場合、apiVersion の形式が不正な場合
   */
  const create = (instanceUrl, accessToken, options = {}) => {
    if (typeof instanceUrl !== 'string' || instanceUrl === '') {
      throw new TypeError('instanceUrl には Salesforce instance URL (string) を指定してください');
    }
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new TypeError('accessToken には Salesforce OAuth access token (string) を指定してください');
    }
    const {
      apiVersion = CONFIG.DEFAULT_API_VERSION,
      maxRetries = CONFIG.DEFAULT_MAX_RETRIES,
      baseDelayMs = CONFIG.DEFAULT_BASE_DELAY_MS,
      logger
    } = options;
    if (!API_VERSION_PATTERN.test(apiVersion)) {
      throw new TypeError(`apiVersion には 'v60.0' のような /v\\d+\\.\\d+/ 形式を指定してください (received: ${apiVersion})`);
    }
    const baseUrl = `${instanceUrl.replace(/\/+$/, '')}/services/data/${apiVersion}`;

    // デコレータ適用順 (内側 → 外側): Bearer → Retry → Logger
    // この順序により以下が成立する:
    //   - Logger は最外で Retry が最終的に返した 1 回分(成功/失敗)を観測する
    //     (個別のリトライ試行は withRetry 内部の logger が出力)
    //   - Logger 通過時点では Authorization ヘッダがまだ付いていないため、
    //     access_token が誤ってログに流出することがない (意図的設計)
    //   - Retry は認証付きリクエストを再送できる
    return ApiClient.createClient({
      baseUrl,
      transport: HttpCore.createTransport(),
      headers: { Accept: 'application/json' },
      logger,
      responseHandler: sfResponseHandler
    })
      .extend(transport => ApiClient.withBearerAuth(transport, accessToken))
      .extend(transport => HttpCore.withRetry(transport, {
        maxRetries,
        baseDelayMs,
        logger
      }))
      .extend(transport => HttpCore.withLogger(transport, logger));
  };

  return { create };
})();
