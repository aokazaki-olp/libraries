'use strict';

/**
 * InvoiceApiClient.gs
 *
 * @description 国税庁 適格請求書発行事業者公表システム Web-API
 *              (通称: インボイス Web-API) のプロトコル層クライアント。
 *              認証(クエリパラメータ id)・必須共通クエリ(type/version)・
 *              リトライ・ロギング・baseUrl 構築のみを提供する。
 *              登録番号検索・差分取得・名称検索などのドメインメソッドは呼び出し側で .use() する。
 *
 * 設計思想:
 *   - ApiClient の Decorator パターンを基盤とする
 *   - 認証はクエリパラメータなので ApiClient.withQueryAuth を最外層で適用する
 *   - レスポンスは body をそのまま返す(独自クラスでラップしない)
 *
 * 注意:
 *   - 利用規約により「国税庁適格請求書発行事業者公表システム Web-API 機能による情報を加工」
 *     等のクレジット表記が必要。表示は最終利用者の責務。
 *   - 認証 id はクエリパラメータで送信されるため、ログ出力時に URL ごと出るとログに残る。
 *
 * 使用例:
 *   const client = InvoiceApiClient.create(appId, { logger });
 *   const res = client.get('/num', { number: 'T1234567890123', history: 0 });
 */
const InvoiceApiClient = (() => {
  const CONFIG = Object.freeze({
    BASE_URL: 'https://web-api.invoice-kohyo.nta.go.jp',
    API_PATH_VERSION: '1',
    DEFAULT_VERSION: '1',
    SUPPORTED_VERSIONS: Object.freeze(['1']),
    DEFAULT_TYPE: '21', // 01=CSV, 21=JSON, 31=XML
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  const invoiceResponseHandler = response => response.body;

  /**
   * インボイス Web-API クライアントを作成
   *
   * @param {string} applicationId 国税庁から発行されたアプリケーション ID
   * @param {Object} [options] オプション
   * @param {('1')} [options.version='1'] データバージョン
   * @param {('01'|'21'|'31')} [options.type='21'] レスポンス形式 (01=CSV / 21=JSON / 31=XML)
   * @param {number} [options.maxRetries=3] リトライ回数上限
   * @param {number} [options.baseDelayMs=500] リトライ初期遅延 (ms)
   * @param {Object} [options.logger] LoggerFacade 互換ロガー
   * @returns {Object} クライアント
   * @throws {TypeError} applicationId が文字列でない、または version が未対応の場合
   */
  const create = (applicationId, options) => {
    if (typeof applicationId !== 'string' || applicationId === '') {
      throw new TypeError('applicationId にはインボイス Web-API のアプリケーション ID (string) を指定してください');
    }
    const opts = options ?? {};
    const version = opts.version ?? CONFIG.DEFAULT_VERSION;
    if (CONFIG.SUPPORTED_VERSIONS.indexOf(version) === -1) {
      throw new TypeError('version には ' + CONFIG.SUPPORTED_VERSIONS.join(' / ') + ' を指定してください');
    }
    const type = opts.type ?? CONFIG.DEFAULT_TYPE;
    const maxRetries = opts.maxRetries ?? CONFIG.DEFAULT_MAX_RETRIES;
    const baseDelayMs = opts.baseDelayMs ?? CONFIG.DEFAULT_BASE_DELAY_MS;
    const logger = opts.logger;

    return ApiClient.createClient({
      baseUrl: CONFIG.BASE_URL + '/' + CONFIG.API_PATH_VERSION,
      transport: HttpCore.createTransport(),
      headers: {
        Accept: 'application/json'
      },
      logger,
      responseHandler: invoiceResponseHandler
    })
      .extend(transport => HttpCore.withRetry(transport, {
        maxRetries,
        baseDelayMs,
        logger
      }))
      .extend(transport => HttpCore.withLogger(transport, logger))
      .extend(transport => ApiClient.withQueryAuth(transport, {
        id: applicationId,
        type,
        version
      }));
  };

  return { create };
})();
