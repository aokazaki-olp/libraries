import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { SalesforceAuth } from '../src/SalesforceAuth.ts';
import { HttpError } from '../src/httpTypes.ts';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.ts';
import type { Signer } from '../src/SalesforceAuth.ts';
import { makeRawResponse } from './helpers.ts';

// ============================================================================
// テストユーティリティ
// ============================================================================

const makeMockSigner = () => {
  const computeRsaSha256Signature = vi.fn((_input: string, _privateKey: string) =>
    Buffer.from('mock-signature'),
  );
  const base64EncodeWebSafe = vi.fn((bytes: Buffer) => bytes.toString('base64url'));
  const newBlob = vi.fn((str: string) => Buffer.from(str, 'utf-8'));
  return { computeRsaSha256Signature, base64EncodeWebSafe, newBlob } satisfies Signer;
};

const makeMockTransport = (
  response?: Partial<RawResponse>,
): Transport & { calls: { url: string; options?: FetchOptions }[] } => {
  const calls: { url: string; options?: FetchOptions }[] = [];
  return {
    calls,
    fetch: vi.fn(async (url: string, options?: FetchOptions) => {
      calls.push({ url, options });
      return makeRawResponse(response);
    }),
  };
};

const VALID_OPTIONS = {
  consumerKey: 'consumer-key',
  username: 'integration@example.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  tokenHost: 'https://yourorg.my.salesforce.com',
};

// ============================================================================
// normalizeTokenHost — バリデーション
// ============================================================================

describe('SalesforceAuth.normalizeTokenHost — バリデーション', () => {
  it.each<[string, unknown, string]>([
    ['null', null, 'string'],
    ['number', 123, 'string'],
    ['undefined', undefined, 'string'],
  ])('%s → TypeError（"%s" を含む）', (_label, value, hint) => {
    expect(() => SalesforceAuth.normalizeTokenHost(value)).toThrow(TypeError);
    expect(() => SalesforceAuth.normalizeTokenHost(value)).toThrow(hint);
  });

  it.each<[string, string, string]>([
    ['空文字', '', 'My Domain URL'],
    ['trailing slash あり', 'https://yourorg.my.salesforce.com/', 'trailing slash'],
    ['大文字混入', 'https://YourOrg.my.salesforce.com', '小文字'],
    ['Lightning URL', 'https://yourorg.lightning.force.com', 'Lightning'],
    ['http://', 'http://yourorg.my.salesforce.com', 'https'],
    ['パスあり', 'https://yourorg.my.salesforce.com/services/oauth2/token', 'パス'],
  ])('%s → TypeError（メッセージに関連文字列を含む）', (_label, value, hint) => {
    expect(() => SalesforceAuth.normalizeTokenHost(value)).toThrow(TypeError);
    expect(() => SalesforceAuth.normalizeTokenHost(value)).toThrow(hint);
  });

  it.each(['https://yourorg.my.salesforce.com', 'https://yourorg--sbx.sandbox.my.salesforce.com'])(
    '正常な tokenHost "%s" はそのまま返す',
    (host) => {
      expect(SalesforceAuth.normalizeTokenHost(host)).toBe(host);
    },
  );
});

// ============================================================================
// getAccessTokenByJwt — 必須パラメータバリデーション
// ============================================================================

describe('SalesforceAuth.getAccessTokenByJwt — バリデーション', () => {
  const signer = makeMockSigner();

  it.each<[string, typeof VALID_OPTIONS, string]>([
    ['consumerKey が空文字', { ...VALID_OPTIONS, consumerKey: '' }, 'consumerKey'],
    [
      'consumerKey が非string',
      { ...VALID_OPTIONS, consumerKey: 123 as unknown as string },
      'consumerKey',
    ],
    ['username が空文字', { ...VALID_OPTIONS, username: '' }, 'username'],
    ['privateKey が空文字', { ...VALID_OPTIONS, privateKey: '' }, 'privateKey'],
  ])('%s → TypeError（"%s" を含む）', async (_label, options, expectedKey) => {
    await expect(SalesforceAuth.getAccessTokenByJwt(options, { signer })).rejects.toThrow(
      TypeError,
    );
    await expect(SalesforceAuth.getAccessTokenByJwt(options, { signer })).rejects.toThrow(
      expectedKey,
    );
  });

  it('tokenHost が不正な形式 → TypeError', async () => {
    await expect(
      SalesforceAuth.getAccessTokenByJwt(
        { ...VALID_OPTIONS, tokenHost: 'http://insecure.salesforce.com' },
        { signer },
      ),
    ).rejects.toThrow(TypeError);
  });
});

// ============================================================================
// getAccessTokenByJwt — 正常系
// ============================================================================

describe('SalesforceAuth.getAccessTokenByJwt — 正常系', () => {
  it('access_token と instance_url を返す', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: {
        access_token: 'sf-token-abc',
        instance_url: 'https://yourorg.my.salesforce.com',
      },
    });

    const result = await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    expect(result.accessToken).toBe('sf-token-abc');
    expect(result.instanceUrl).toBe('https://yourorg.my.salesforce.com');
  });

  it('token endpoint の URL が tokenHost + /services/oauth2/token になる', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: { access_token: 'tok', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe('https://yourorg.my.salesforce.com/services/oauth2/token');
  });

  it('token endpoint へのリクエストが POST + form-urlencoded になる', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: { access_token: 'tok', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    expect(transport.calls).toHaveLength(1);
    const options = transport.calls[0]?.options;
    expect(options?.method).toBe('POST');
    expect(options?.payload).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: expect.any(String),
    });
  });

  it('JWT に iss/sub/aud/exp クレームが含まれる', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: { access_token: 'tok', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    const blobCalls = signer.newBlob.mock.calls;
    const claimsJson = String(blobCalls[1]?.[0]); // 2回目の呼び出しがclaimsのJSON
    const claims: unknown = JSON.parse(claimsJson);

    expect(claims).toMatchObject({
      iss: VALID_OPTIONS.consumerKey,
      sub: VALID_OPTIONS.username,
      aud: VALID_OPTIONS.tokenHost,
      exp: expect.any(Number),
    });
  });

  it('request を持たない HttpError はそのまま投げる（作り直さない）', async () => {
    const signer = makeMockSigner();
    const original = new HttpError('HTTPエラー 400', 400, { error: 'invalid_grant' });
    const transport: Transport = {
      fetch: vi.fn(async () => {
        throw original;
      }),
    };

    await expect(
      SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer }),
    ).rejects.toBe(original);
  });

  it('request.body を持つ HttpError は assertion を伏せて作り直す（cause に元を残さない）', async () => {
    const signer = makeMockSigner();
    const transport: Transport = {
      fetch: vi.fn(async (_url: string, options?: FetchOptions) => {
        throw new HttpError('HTTPエラー 400', 400, { error: 'invalid_grant' }, {}, '', {
          body: options?.payload,
        });
      }),
    };

    let caughtError: unknown;
    try {
      await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });
    } catch (e) {
      caughtError = e;
    }

    if (!(caughtError instanceof HttpError)) {
      throw new Error('HttpError が投げられていません');
    }
    expect(caughtError.request?.body).toMatchObject({ assertion: '[REDACTED]' });
    expect(caughtError.cause).toBeUndefined();
  });

  it('JWT の signingInput が header.claims の Base64URL 連結形式になる', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: { access_token: 'tok', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    const signCalls = signer.computeRsaSha256Signature.mock.calls;
    const signingInput = String(signCalls[0]?.[0]);
    const parts = signingInput.split('.');
    expect(parts).toHaveLength(2);

    const header: unknown = JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString());
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT' });
  });
});

// ============================================================================
// getAccessTokenByJwt — defaultSigner (node:crypto)
// ============================================================================

describe('SalesforceAuth.getAccessTokenByJwt — defaultSigner (node:crypto)', () => {
  it('signer を省略しても PEM 鍵で JWT を生成して token endpoint に POST できる', async () => {
    // node:crypto で実際に署名できることを確認するため、実際の RSA 鍵ペアを生成して使う
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const transport = makeMockTransport({
      body: { access_token: 'sf-token', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    const result = await SalesforceAuth.getAccessTokenByJwt(
      { ...VALID_OPTIONS, privateKey: pem },
      { transport }, // signer を省略 → defaultSigner (node:crypto) を使用
    );

    expect(result.accessToken).toBe('sf-token');
    expect(result.instanceUrl).toBe('https://yourorg.my.salesforce.com');
  });
});

// ============================================================================
// getAccessTokenByJwt — レスポンス欠落
// ============================================================================

describe('SalesforceAuth.getAccessTokenByJwt — レスポンス欠落', () => {
  const signer = makeMockSigner();

  it('access_token が欠落している場合 Error をスロー', async () => {
    const transport = makeMockTransport({
      body: { instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await expect(
      SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer }),
    ).rejects.toThrow('access_token');
  });

  it('access_token が空文字の場合 Error をスロー', async () => {
    const transport = makeMockTransport({
      body: { access_token: '', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await expect(
      SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer }),
    ).rejects.toThrow('access_token');
  });

  it('instance_url が欠落している場合 Error をスロー', async () => {
    const transport = makeMockTransport({
      body: { access_token: 'tok' },
    });

    await expect(
      SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer }),
    ).rejects.toThrow('instance_url');
  });
});
