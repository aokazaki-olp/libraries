'use strict';

/**
 * GBizInfoApiClient.gs
 *
 * @description 経済産業省 gBizINFO API のプロトコル層クライアント。
 *              認証(X-hojinInfo-api-token ヘッダ)・リトライ・ロギング・baseUrl 構築のみを提供する。
 *              ドメインメソッド(法人情報取得・補助金検索など)は呼び出し側で .use() する。
 *
 * 設計思想:
 *   - ApiClient の Decorator パターンを基盤とする
 *   - gBizINFO は Bearer ではなく X-hojinInfo-api-token カスタムヘッダで認証する
 *   - レスポンスは body をそのまま返す(独自クラスでラップしない)
 *
 * 使用例:
 *   const client = GBizInfoApiClient.create(token, { logger });        // v2 (デフォルト)
 *   const client = GBizInfoApiClient.create(token, { version: 'v1' }); // v1 を明示
 *   const res = client.get('/hojin/1234567890123');
 */
const GBizInfoApiClient = (() => {
  const CONFIG = Object.freeze({
    BASE_URL: 'https://api.info.gbiz.go.jp/hojin',
    AUTH_HEADER: 'X-hojinInfo-api-token',
    DEFAULT_VERSION: 'v2',
    SUPPORTED_VERSIONS: Object.freeze(['v1', 'v2']),
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  const gbizResponseHandler = response => response.body;

  /**
   * gBizINFO API クライアントを作成
   *
   * @param {string} token gBizINFO API トークン
   * @param {Object} [options] オプション
   * @param {('v1'|'v2')} [options.version='v2'] APIバージョン
   * @param {Object} [options.logger] LoggerFacade 互換ロガー
   * @returns {Object} クライアント
   * @throws {TypeError} token が文字列でない、または version が未対応の場合
   */
  const create = (token, options) => {
    if (typeof token !== 'string' || token === '') {
      throw new TypeError('token には gBizINFO API token (string) を指定してください');
    }
    const opts = options ?? {};
    const version = opts.version ?? CONFIG.DEFAULT_VERSION;
    if (CONFIG.SUPPORTED_VERSIONS.indexOf(version) === -1) {
      throw new TypeError('version には ' + CONFIG.SUPPORTED_VERSIONS.join(' / ') + ' を指定してください');
    }
    const logger = opts.logger;

    return ApiClient.createClient({
      baseUrl: CONFIG.BASE_URL + '/' + version,
      transport: HttpCore.createTransport(),
      headers: {
        Accept: 'application/json',
        [CONFIG.AUTH_HEADER]: token
      },
      logger,
      responseHandler: gbizResponseHandler
    })
      .extend(transport => HttpCore.withRetry(transport, {
        maxRetries: CONFIG.DEFAULT_MAX_RETRIES,
        baseDelayMs: CONFIG.DEFAULT_BASE_DELAY_MS,
        logger
      }))
      .extend(transport => HttpCore.withLogger(transport, logger));
  };

  return { create };
})();
