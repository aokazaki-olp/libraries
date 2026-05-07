import { describe, it, expect, vi } from 'vitest';
import { SalesforceAuth } from '../src/SalesforceAuth.js';
import { HttpError } from '../src/types.js';
import type { FetchOptions, RawResponse, Signer, Transport } from '../src/SalesforceAuth.js';

// ============================================================================
// テストユーティリティ
// ============================================================================

const makeRawResponse = (overrides: Partial<RawResponse> = {}): RawResponse => ({
  status: 200,
  headers: {},
  body: null,
  text: '',
  ...overrides,
});

const makeMockSigner = (): Signer => ({
  computeRsaSha256Signature: vi.fn(() => Buffer.from('mock-signature')),
  base64EncodeWebSafe: vi.fn((bytes: Buffer) => bytes.toString('base64url')),
  newBlob: vi.fn((str: string) => Buffer.from(str, 'utf-8')),
});

const makeMockTransport = (response?: Partial<RawResponse>): Transport & { calls: unknown[] } => {
  const calls: unknown[] = [];
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
  it.each([
    ['null', null, 'string'],
    ['number', 123, 'string'],
    ['undefined', undefined, 'string'],
  ] as [string, unknown, string][])(
    '%s → TypeError（"%s" を含む）',
    (_label, value, expected) => {
      expect(() => SalesforceAuth.normalizeTokenHost(value)).toThrow(TypeError);
    },
  );

  it.each([
    ['空文字', '', 'My Domain URL'],
    ['trailing slash あり', 'https://yourorg.my.salesforce.com/', 'trailing slash'],
    ['大文字混入', 'https://YourOrg.my.salesforce.com', '小文字'],
    ['Lightning URL', 'https://yourorg.lightning.force.com', 'Lightning'],
    ['http://', 'http://yourorg.my.salesforce.com', 'https'],
    ['パスあり', 'https://yourorg.my.salesforce.com/services/oauth2/token', 'パス'],
  ] as [string, string, string][])(
    '%s → TypeError（メッセージに関連文字列を含む）',
    (_label, value, _hint) => {
      expect(() => SalesforceAuth.normalizeTokenHost(value)).toThrow(TypeError);
    },
  );

  it.each([
    'https://yourorg.my.salesforce.com',
    'https://yourorg--sbx.sandbox.my.salesforce.com',
  ])('正常な tokenHost "%s" はそのまま返す', (host) => {
    expect(SalesforceAuth.normalizeTokenHost(host)).toBe(host);
  });
});

// ============================================================================
// getAccessTokenByJwt — 必須パラメータバリデーション
// ============================================================================

describe('SalesforceAuth.getAccessTokenByJwt — バリデーション', () => {
  const signer = makeMockSigner();

  it.each([
    ['consumerKey が空文字', { ...VALID_OPTIONS, consumerKey: '' }, 'consumerKey'],
    ['consumerKey が非string', { ...VALID_OPTIONS, consumerKey: 123 as unknown as string }, 'consumerKey'],
    ['username が空文字', { ...VALID_OPTIONS, username: '' }, 'username'],
    ['privateKey が空文字', { ...VALID_OPTIONS, privateKey: '' }, 'privateKey'],
  ] as [string, typeof VALID_OPTIONS, string][])(
    '%s → TypeError（"%s" を含む）',
    async (_label, options, expectedKey) => {
      await expect(
        SalesforceAuth.getAccessTokenByJwt(options, { signer }),
      ).rejects.toThrow(TypeError);
      await expect(
        SalesforceAuth.getAccessTokenByJwt(options, { signer }),
      ).rejects.toThrow(expectedKey);
    },
  );

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

    const call = transport.calls[0] as { url: string; options: FetchOptions };
    expect(call.url).toBe('https://yourorg.my.salesforce.com/services/oauth2/token');
  });

  it('token endpoint へのリクエストが POST + form-urlencoded になる', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: { access_token: 'tok', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    const call = transport.calls[0] as { url: string; options: FetchOptions };
    expect(call.options?.method).toBe('POST');
    // payload がオブジェクトであれば form-urlencoded として送られる
    expect(typeof call.options?.payload).toBe('object');
    const payload = call.options?.payload as Record<string, string>;
    expect(payload?.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(typeof payload?.assertion).toBe('string');
  });

  it('JWT に iss/sub/aud/exp クレームが含まれる', async () => {
    const signer = makeMockSigner();
    const transport = makeMockTransport({
      body: { access_token: 'tok', instance_url: 'https://yourorg.my.salesforce.com' },
    });

    await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });

    // signer.newBlob に渡されたクレームJSON を検証
    const blobCalls = (signer.newBlob as ReturnType<typeof vi.fn>).mock.calls;
    const claimsJson = blobCalls[1][0] as string; // 2回目の呼び出しがclaimsのJSON
    const claims = JSON.parse(claimsJson) as Record<string, unknown>;

    expect(claims['iss']).toBe(VALID_OPTIONS.consumerKey);
    expect(claims['sub']).toBe(VALID_OPTIONS.username);
    expect(claims['aud']).toBe(VALID_OPTIONS.tokenHost);
    expect(typeof claims['exp']).toBe('number');
  });

  it('JWT の assertion がログに流出しない（redacted で HttpError を再スロー）', async () => {
    const signer = makeMockSigner();
    const transport: Transport = {
      fetch: vi.fn(async () => {
        throw new HttpError('HTTPエラー 400', 400, { error: 'invalid_grant' });
      }),
    };

    let caughtError: unknown;
    try {
      await SalesforceAuth.getAccessTokenByJwt(VALID_OPTIONS, { transport, signer });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(HttpError);
    const httpError = caughtError as HttpError;
    // request.body に assertion が含まれていないこと
    const requestBody = httpError.request?.body as Record<string, unknown> | undefined;
    expect(requestBody?.['assertion']).toBe('[REDACTED]');
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
