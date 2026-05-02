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
 *   const client = GBizInfoApiClient.create(token, logger);
 *   const res = client.get('/hojin/1234567890123');
 */
const GBizInfoApiClient = (() => {
  const CONFIG = Object.freeze({
    BASE_URL: 'https://info.gbiz.go.jp/hojin/v1',
    AUTH_HEADER: 'X-hojinInfo-api-token',
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  /**
   * gBizINFO レスポンスハンドラ(body のみ抽出)
   *
   * @param {Object} response レスポンスオブジェクト
   * @returns {Object} レスポンスボディ
   */
  const gbizResponseHandler = response => response.body;

  /**
   * gBizINFO API クライアントを作成
   *
   * @param {string} token gBizINFO API トークン
   * @param {Object} [logger] LoggerFacade 互換ロガー
   * @returns {Object} クライアント
   * @throws {TypeError} token に文字列以外を指定した場合
   */
  const create = (token, logger) => {
    if (typeof token !== 'string' || token === '') {
      throw new TypeError('token には gBizINFO API token (string) を指定してください');
    }

    return ApiClient.createClient({
      baseUrl: CONFIG.BASE_URL,
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
