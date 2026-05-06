/**
 * SalesforceAuth.ts
 * @description Salesforce OAuth トークン取得ヘルパ。JWT Bearer Flow 実装。
 *              node:crypto を使用。SalesforceApiClient とは独立。
 *
 * 使用例:
 *   const { accessToken, instanceUrl } = await SalesforceAuth.getAccessTokenByJwt({
 *     consumerKey: 'XXX',
 *     username: 'integration@example.com.prod',
 *     privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
 *     tokenHost: 'https://yourcompany.my.salesforce.com',
 *   });
 *   const sf = SalesforceApiClient.create(instanceUrl, accessToken);
 */

import { createSign } from 'node:crypto';
import { HttpCore } from './HttpCore.js';
import { HttpError } from './types.js';
import type { Transport } from './types.js';

const JWT_LIFETIME_SEC = 180;

// ============================================================================
// Signer インターフェース（テスト用 DI）
// ============================================================================

interface Signer {
  computeRsaSha256Signature(input: string, privateKey: string): Buffer;
  base64EncodeWebSafe(bytes: Buffer): string;
  newBlob(str: string): Buffer;
}

const defaultSigner: Signer = {
  computeRsaSha256Signature: (input: string, privateKey: string): Buffer => {
    const sign = createSign('RSA-SHA256');
    sign.update(input);
    return sign.sign(privateKey);
  },
  base64EncodeWebSafe: (bytes: Buffer): string =>
    bytes.toString('base64url'),
  newBlob: (str: string): Buffer =>
    Buffer.from(str, 'utf-8'),
};

// ============================================================================
// tokenHost バリデーション
// ============================================================================

const normalizeTokenHost = (host: unknown): string => {
  if (typeof host !== 'string') {
    throw new TypeError(
      'tokenHost には組織の My Domain URL (string) を指定してください ' +
      '(例: https://yourcompany.my.salesforce.com)',
    );
  }
  const raw = host.trim();
  if (raw === '') {
    throw new TypeError(
      'tokenHost には組織の My Domain URL を指定してください ' +
      '(例: https://yourcompany.my.salesforce.com)',
    );
  }
  if (raw !== raw.toLowerCase()) {
    throw new TypeError(`tokenHost は全て小文字で指定してください。received: ${host}`);
  }
  if (raw.endsWith('/')) {
    throw new TypeError(`tokenHost には trailing slash を含めないでください。received: ${host}`);
  }
  if (raw.includes('.lightning.force.com')) {
    throw new TypeError(
      `tokenHost に Lightning URL は指定できません。My Domain URL を指定してください。received: ${host}`,
    );
  }
  if (!/^https:\/\/[^/]+$/.test(raw)) {
    throw new TypeError(
      'tokenHost は https:// で始まるホスト部のみを指定してください ' +
      '(http:// 不可、/services/oauth2/token などのパス指定不可)。' +
      `received: ${host}`,
    );
  }
  return raw;
};

// ============================================================================
// JWT 構築
// ============================================================================

interface JwtParams {
  consumerKey: string;
  username: string;
  audience: string;
  privateKey: string;
}

const base64UrlEncode = (signer: Signer, bytes: Buffer): string =>
  signer.base64EncodeWebSafe(bytes).replace(/=+$/, '');

const buildJwt = (signer: Signer, params: JwtParams): string => {
  const { consumerKey, username, audience, privateKey } = params;
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: consumerKey,
    sub: username,
    aud: audience,
    exp: now + JWT_LIFETIME_SEC,
  };

  const headerBytes = signer.newBlob(JSON.stringify(header));
  const claimsBytes = signer.newBlob(JSON.stringify(claims));
  const headerB64 = base64UrlEncode(signer, headerBytes);
  const claimsB64 = base64UrlEncode(signer, claimsBytes);
  const signingInput = `${headerB64}.${claimsB64}`;
  const signature = signer.computeRsaSha256Signature(signingInput, privateKey);
  return `${signingInput}.${base64UrlEncode(signer, signature)}`;
};

// ============================================================================
// getAccessTokenByJwt
// ============================================================================

interface JwtOptions {
  consumerKey: string;
  username: string;
  privateKey: string;
  tokenHost: string;
  logger?: unknown;
  maxRetries?: number;
  baseDelayMs?: number;
}

interface JwtDependencies {
  transport?: Transport;
  signer?: Signer;
}

interface TokenResult {
  accessToken: string;
  instanceUrl: string;
}

/**
 * JWT Bearer Flow で access_token を取得する
 *
 * Spring '26 以降の External Client Apps では login.salesforce.com /
 * test.salesforce.com を固定で使う方式が動作しないため、組織固有の
 * My Domain URL を tokenHost に必ず指定すること。
 *
 * @param options - JWT認証オプション
 * @param options.consumerKey - External Client App の Consumer Key
 * @param options.username - Salesforce ユーザーの username
 * @param options.privateKey - PEM形式 (PKCS#8) の RSA秘密鍵
 * @param options.tokenHost - 組織固有の My Domain URL（ホスト部のみ）
 * @param options.logger - LoggerFacade 互換ロガー
 * @param dependencies - 依存注入（テスト用）
 * @returns {{ accessToken: string, instanceUrl: string }}
 * @throws {TypeError} 必須パラメータ欠落 / tokenHost の形式不正
 * @throws {HttpError} token endpoint が非 2xx を返した場合
 * @throws {Error} レスポンスに access_token / instance_url が欠落していた場合
 */
const getAccessTokenByJwt = async (
  options: JwtOptions,
  dependencies: JwtDependencies = {},
): Promise<TokenResult> => {
  const {
    consumerKey,
    username,
    privateKey,
    tokenHost,
    logger,
    maxRetries = 3,
    baseDelayMs = 500,
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

  let transport = dependencies.transport;
  if (!transport) {
    transport = HttpCore.createTransport();
    transport = HttpCore.withRetry(transport, { maxRetries, baseDelayMs, logger });
    transport = HttpCore.withLogger(transport, logger);
  }

  const signer = dependencies.signer ?? defaultSigner;
  const url = `${audience}/services/oauth2/token`;
  const jwt = buildJwt(signer, { consumerKey, username, audience, privateKey });

  // form-urlencoded で POST（ApiClient.call は JSON.stringify するため使えない）
  // payload をオブジェクトで渡すと form-urlencoded としてエンコードされる
  const redactedBody = {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: '[REDACTED]',
  };

  let response;
  try {
    response = await transport.fetch(url, {
      method: 'POST',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        // 署名済み JWT。access_token と交換可能な credential のためログ出力禁止
        assertion: jwt,
      },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      // assertion が request.body 経由でログに乗らないよう redacted 版に差し替え
      throw new HttpError(
        e.message,
        e.status,
        e.body,
        e.headers,
        e.text,
        { ...e.request, body: redactedBody },
      );
    }
    throw e;
  }

  const body = response.body as Record<string, unknown> | null;
  const accessToken = body?.access_token;
  const instanceUrl = body?.instance_url;

  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('Salesforce token response に access_token が含まれません');
  }
  if (typeof instanceUrl !== 'string' || instanceUrl === '') {
    throw new Error('Salesforce token response に instance_url が含まれません');
  }

  return { accessToken, instanceUrl };
};

export const SalesforceAuth = { getAccessTokenByJwt, normalizeTokenHost };
export type { JwtOptions, JwtDependencies, TokenResult, Signer };
