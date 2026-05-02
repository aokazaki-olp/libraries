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
 *   - テスタビリティ確保のため第 2 引数 dependencies で transport / signer を注入可能
 *     (ApiClient.createClient({ transport }) と同じパターン)
 *   - iss/sub/aud は ASCII 想定(External Client App key / username / URL)
 *   - tokenHost は組織固有 My Domain URL を必須とする
 *     (Spring '26 以降の External Client Apps では login/test.salesforce.com 固定では動作しない)
 *
 * 使用例:
 *   const { accessToken, instanceUrl } = SalesforceAuth.getAccessTokenByJwt({
 *     consumerKey: 'XXX',
 *     username: 'integration@example.com.prod',
 *     privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
 *     tokenHost: 'https://yourcompany.my.salesforce.com'
 *   });
 *   const sf = SalesforceApiClient.create(instanceUrl, accessToken);
 */
const SalesforceAuth = (() => {
  const JWT_LIFETIME_SEC = 180; // 3 分以内が Salesforce の要件
  const CONFIG = Object.freeze({
    DEFAULT_MAX_RETRIES: 3,
    DEFAULT_BASE_DELAY_MS: 500
  });

  /**
   * tokenHost の形式不正を早期検知する(fail-fast)。
   * 暗黙の値変換は行わず、誤入力は TypeError で弾く。
   */
  const normalizeTokenHost = (host) => {
    if (typeof host !== 'string') {
      throw new TypeError(
        'tokenHost には組織の My Domain URL (string) を指定してください ' +
        '(例: https://yourcompany.my.salesforce.com)'
      );
    }
    const raw = host.trim();
    if (raw === '') {
      throw new TypeError(
        'tokenHost には組織の My Domain URL を指定してください ' +
        '(例: https://yourcompany.my.salesforce.com)'
      );
    }
    if (raw !== raw.toLowerCase()) {
      throw new TypeError(
        'tokenHost は全て小文字で指定してください。received: ' + host
      );
    }
    if (raw.endsWith('/')) {
      throw new TypeError(
        'tokenHost には trailing slash を含めないでください。received: ' + host
      );
    }
    if (raw.includes('.lightning.force.com')) {
      throw new TypeError(
        'tokenHost に Lightning URL は指定できません。My Domain URL を指定してください。received: ' + host
      );
    }
    if (!/^https:\/\/[^/]+$/.test(raw)) {
      throw new TypeError(
        'tokenHost は https:// で始まるホスト部のみを指定してください ' +
        '(http:// 不可、/services/oauth2/token などのパス指定不可)。received: ' + host
      );
    }
    return raw;
  };

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
   * Spring '26 以降の External Client Apps では login.salesforce.com /
   * test.salesforce.com を固定で使う方式が動作しないため、組織固有の
   * My Domain URL を tokenHost に必ず指定すること。
   *
   * @param {Object} options
   * @param {string} options.consumerKey
   *   External Client App / Connected App の Consumer Key。
   * @param {string} options.username
   *   Salesforce Username。メールアドレスと異なる場合がある。
   *   設定 → ユーザー → 「ユーザー名」列の値を使用すること。
   *   (例: integration@example.com.prod)
   * @param {string} options.privateKey
   *   PEM 形式の RSA 秘密鍵。
   *   GAS の Utilities.computeRsaSha256Signature では PKCS#8 形式が必須
   *   (`-----BEGIN PRIVATE KEY-----` で始まること)。
   *   PKCS#1 (`BEGIN RSA PRIVATE KEY`) の場合は事前変換が必要:
   *     openssl pkcs8 -topk8 -nocrypt -in key.pem -out key_pkcs8.pem
   * @param {string} options.tokenHost
   *   組織固有の My Domain URL。ホスト部のみ指定する。
   *   - 含めない: /services/oauth2/token、trailing slash
   *   - 指定不可: Lightning URL (.lightning.force.com)
   *   - 本番例:    https://yourcompany.my.salesforce.com
   *   - Sandbox例: https://yourcompany--sbx.sandbox.my.salesforce.com
   * @param {Object} [options.logger] LoggerFacade 互換ロガー
   * @param {number} [options.maxRetries] 最大リトライ回数 (デフォルト: 3)
   * @param {number} [options.baseDelayMs] リトライ基本遅延ミリ秒 (デフォルト: 500)
   * @param {Object} [dependencies] 依存注入(テスト用、本番でも使用可)
   * @param {Object} [dependencies.transport] { fetch(url, options) } を持つトランスポート(注入時は retry/logger も呼び出し側責務)
   * @param {Object} [dependencies.signer] { computeRsaSha256Signature, base64EncodeWebSafe, newBlob } (デフォルト: Utilities)
   * @returns {{ accessToken: string, instanceUrl: string }}
   * @throws {TypeError} 必須パラメータ欠落 / tokenHost の形式不正
   * @throws {Error} token endpoint が非 2xx を返した場合 (HttpError, HttpCore.interpretResponse 経由)
   * @throws {Error} レスポンスに access_token / instance_url が欠落していた場合
   */
  const getAccessTokenByJwt = (options = {}, dependencies = {}) => {
    const {
      consumerKey,
      username,
      privateKey,
      tokenHost,
      logger,
      maxRetries = CONFIG.DEFAULT_MAX_RETRIES,
      baseDelayMs = CONFIG.DEFAULT_BASE_DELAY_MS
    } = options;
    if (typeof consumerKey !== 'string' || consumerKey === '') {
      throw new TypeError('consumerKey には External Client App の Consumer Key (string) を指定してください');
    }
    if (typeof username !== 'string' || username === '') {
      throw new TypeError('username には Salesforce ユーザーの username (string) を指定してください');
    }
    if (typeof privateKey !== 'string' || privateKey === '') {
      throw new TypeError('privateKey には PEM 形式 (PKCS#8) の RSA 秘密鍵 (string) を指定してください');
    }
    const audience = normalizeTokenHost(tokenHost);

    const transport = dependencies.transport ?? buildDefaultTransport(logger, { maxRetries, baseDelayMs });
    const signer = dependencies.signer ?? Utilities;
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
        // 署名済み JWT。access_token と交換可能な credential のためログ出力禁止。
        assertion: jwt
      },
      muteHttpExceptions: true
    };
    // 上記 assertion が HttpError.request.body 経由でログ/通知に乗らないよう、
    // interpretResponse には redacted 版を渡す。
    const redactedBody = {
      grant_type: fetchOptions.payload.grant_type,
      assertion: '[REDACTED]'
    };

    const rawResponse = transport.fetch(url, fetchOptions);
    const response = HttpCore.interpretResponse(rawResponse, { url, body: redactedBody });

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
