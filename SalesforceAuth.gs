'use strict';

/**
 * SalesforceAuth.gs
 *
 * @description Salesforce OAuth トークン取得ヘルパ。JWT Bearer Flow 実装。
 *              SalesforceApiClient とは独立しており、戻り値は素のオブジェクト。
 *              GAS 標準の Utilities.computeRsaSha256Signature を使用。
 *
 * 設計思想:
 *   - 本体クライアント(SalesforceApiClient)は本モジュールを知らない(疎結合)
 *   - token endpoint への通信は HttpCore.createTransport + withRetry + withLogger を経由
 *     (定期トリガー運用での一時障害を吸収・401/invalid_grant 調査時のログを確保)
 *   - テスタビリティ確保のため第 2 引数 deps で transport / signer を注入可能
 *     (ApiClient.createClient({ transport }) と同じパターン)
 *   - iss/sub/aud は ASCII 想定(Connected App key / username / URL)
 *
 * 使用例:
 *   const { accessToken, instanceUrl } = SalesforceAuth.getAccessTokenByJwt({
 *     consumerKey: 'XXX',
 *     username: 'user@example.com',
 *     privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
 *   });
 *   const sf = SalesforceApiClient.create(instanceUrl, accessToken);
 */
const SalesforceAuth = (() => {
  const TOKEN_HOST = Object.freeze({
    PRODUCTION: 'https://login.salesforce.com',
    SANDBOX: 'https://test.salesforce.com'
  });
  const JWT_LIFETIME_SEC = 180; // 3 分以内が Salesforce の要件
  const CONFIG = Object.freeze({
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  /**
   * デフォルトトランスポートを構築する。呼び出し側の logger を毎回反映するため
   * シングルトン化しない(SF-H1)。GAS は実行ごとにプロセスが死ぬので
   * 毎回構築してもオーバーヘッドは無視できる。
   */
  const buildDefaultTransport = (logger, retryOptions) => {
    let transport = HttpCore.createTransport();
    transport = HttpCore.withRetry(transport, {
      maxRetries: retryOptions.maxRetries,
      baseDelayMs: retryOptions.baseDelayMs,
      logger
    });
    transport = HttpCore.withLogger(transport, logger);
    return transport;
  };

  const base64UrlEncode = (signer, bytes) =>
    signer.base64EncodeWebSafe(bytes).replace(/=+$/, '');

  const buildJwt = (signer, params) => {
    const { consumerKey, username, audience, privateKey } = params;
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: consumerKey,
      sub: username,
      aud: audience,
      exp: now + JWT_LIFETIME_SEC
    };
    const headerBytes = signer.newBlob(JSON.stringify(header)).getBytes();
    const claimsBytes = signer.newBlob(JSON.stringify(claims)).getBytes();
    const headerB64 = base64UrlEncode(signer, headerBytes);
    const claimsB64 = base64UrlEncode(signer, claimsBytes);
    const signingInput = `${headerB64}.${claimsB64}`;
    const signature = signer.computeRsaSha256Signature(signingInput, privateKey);
    return `${signingInput}.${base64UrlEncode(signer, signature)}`;
  };

  /**
   * JWT Bearer Flow で access_token を取得する。
   *
   * @param {Object} opts
   * @param {string} opts.consumerKey Connected App の Consumer Key
   * @param {string} opts.username 連携ユーザーの username
   * @param {string} opts.privateKey PEM 形式の RSA 秘密鍵
   * @param {boolean} [opts.sandbox] true なら test.salesforce.com を使う
   * @param {Object} [opts.logger] LoggerFacade 互換ロガー
   * @param {number} [opts.maxRetries] 最大リトライ回数 (デフォルト: 3)
   * @param {number} [opts.baseDelayMs] リトライ基本遅延ミリ秒 (デフォルト: 500)
   * @param {Object} [deps] 依存注入(テスト用、本番でも使用可)
   * @param {Object} [deps.transport] { fetch(url, options) } を持つトランスポート(注入時は retry/logger も呼び出し側責務)
   * @param {Object} [deps.signer] { computeRsaSha256Signature, base64EncodeWebSafe, newBlob } (デフォルト: Utilities)
   * @returns {{ accessToken: string, instanceUrl: string }}
   * @throws {TypeError} 必須パラメータ欠落
   * @throws {Error} token endpoint が非 2xx を返した場合 (HttpError, HttpCore.interpretResponse 経由)
   * @throws {Error} レスポンスに access_token / instance_url が欠落していた場合
   */
  const getAccessTokenByJwt = (opts = {}, deps = {}) => {
    const {
      consumerKey,
      username,
      privateKey,
      sandbox = false,
      logger,
      maxRetries = CONFIG.DEFAULT_MAX_RETRIES,
      baseDelayMs = CONFIG.DEFAULT_BASE_DELAY_MS
    } = opts;
    if (typeof consumerKey !== 'string' || consumerKey === '') {
      throw new TypeError('consumerKey には Connected App の Consumer Key (string) を指定してください');
    }
    if (typeof username !== 'string' || username === '') {
      throw new TypeError('username には Salesforce ユーザーの username (string) を指定してください');
    }
    if (typeof privateKey !== 'string' || privateKey === '') {
      throw new TypeError('privateKey には PEM 形式の RSA 秘密鍵 (string) を指定してください');
    }

    const transport = deps.transport ?? buildDefaultTransport(logger, { maxRetries, baseDelayMs });
    const signer = deps.signer ?? Utilities;
    const audience = sandbox ? TOKEN_HOST.SANDBOX : TOKEN_HOST.PRODUCTION;
    const url = `${audience}/services/oauth2/token`;
    const jwt = buildJwt(signer, { consumerKey, username, audience, privateKey });

    // 生 transport を直叩きしている理由:
    // ApiClient.createClient.call は body を JSON.stringify するため、
    // form-urlencoded を要求する OAuth token endpoint には使えない。
    // payload をオブジェクトで渡すと UrlFetchApp が application/x-www-form-urlencoded
    // にエンコードするのでこれを利用する(SF-L4)。
    const fetchOptions = {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    };

    const rawResponse = transport.fetch(url, fetchOptions);
    const response = HttpCore.interpretResponse(rawResponse, { url, body: fetchOptions.payload });

    const accessToken = response.body?.access_token;
    const instanceUrl = response.body?.instance_url;
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new Error('Salesforce token response に access_token が含まれません');
    }
    if (typeof instanceUrl !== 'string' || instanceUrl === '') {
      throw new Error('Salesforce token response に instance_url が含まれません');
    }
    return { accessToken, instanceUrl };
  };

  return { getAccessTokenByJwt };
})();
