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
 *   - token endpoint への通信は HttpCore.createTransport + withRetry を経由
 *     (定期トリガー運用での一時障害を吸収)
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
  const DEFAULTS = Object.freeze({
    MAX_RETRIES: 3,
    BASE_DELAY_MS: 500
  });

  // デフォルトトランスポートは初回呼び出し時に生成し以後再利用
  let _defaultTransport = null;
  const getDefaultTransport = logger => {
    if (_defaultTransport === null) {
      _defaultTransport = HttpCore.withRetry(HttpCore.createTransport(), {
        maxRetries: DEFAULTS.MAX_RETRIES,
        baseDelayMs: DEFAULTS.BASE_DELAY_MS,
        logger
      });
    }
    return _defaultTransport;
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
   * @param {Object} [deps] 依存注入(テスト用、本番でも使用可)
   * @param {Object} [deps.transport] { fetch(url, options) } を持つトランスポート
   * @param {Object} [deps.signer] { computeRsaSha256Signature, base64EncodeWebSafe, newBlob } (デフォルト: Utilities)
   * @returns {{ accessToken: string, instanceUrl: string }}
   * @throws {TypeError} 必須パラメータ欠落
   * @throws {Error} token endpoint が非 2xx を返した場合 (HttpError, HttpCore.interpretResponse 経由)
   */
  const getAccessTokenByJwt = (opts = {}, deps = {}) => {
    const { consumerKey, username, privateKey, sandbox = false, logger } = opts;
    if (typeof consumerKey !== 'string' || consumerKey === '') {
      throw new TypeError('consumerKey には Connected App の Consumer Key (string) を指定してください');
    }
    if (typeof username !== 'string' || username === '') {
      throw new TypeError('username には Salesforce ユーザーの username (string) を指定してください');
    }
    if (typeof privateKey !== 'string' || privateKey === '') {
      throw new TypeError('privateKey には PEM 形式の RSA 秘密鍵 (string) を指定してください');
    }

    const transport = deps.transport ?? getDefaultTransport(logger);
    const signer = deps.signer ?? Utilities;
    const audience = sandbox ? TOKEN_HOST.SANDBOX : TOKEN_HOST.PRODUCTION;
    const url = `${audience}/services/oauth2/token`;
    const jwt = buildJwt(signer, { consumerKey, username, audience, privateKey });

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

    return {
      accessToken: response.body.access_token,
      instanceUrl: response.body.instance_url
    };
  };

  return { getAccessTokenByJwt };
})();
