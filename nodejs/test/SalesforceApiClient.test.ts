import { describe, it, expect, vi } from 'vitest';
import { SalesforceApiClient } from '../src/SalesforceApiClient.js';
import type { FetchOptions, Transport } from '../src/types.js';
import { makeRawResponse } from './helpers.js';

// ============================================================================
// テストユーティリティ
// ============================================================================

const mockTransport = (body: unknown = null): Transport & { calls: { url: string; options?: FetchOptions }[] } => {
  const calls: { url: string; options?: FetchOptions }[] = [];
  return {
    calls,
    fetch: vi.fn(async (url: string, options?: FetchOptions) => {
      calls.push({ url, options });
      return makeRawResponse({ body });
    }),
  };
};

const VALID_INSTANCE_URL = 'https://yourorg.my.salesforce.com';
const VALID_ACCESS_TOKEN = 'valid-access-token';

// ============================================================================
// create — バリデーション
// ============================================================================

describe('SalesforceApiClient.create — バリデーション', () => {
  it.each([
    ['引数なし', [], 'instanceUrl'],
    ['instanceUrl が空文字', ['', 'token'], 'instanceUrl'],
    ['instanceUrl が null', [null, 'token'], 'instanceUrl'],
    ['instanceUrl が数値', [123, 'token'], 'instanceUrl'],
    ['accessToken が空文字', [VALID_INSTANCE_URL, ''], 'accessToken'],
    ['accessToken が null', [VALID_INSTANCE_URL, null], 'accessToken'],
    ['accessToken が数値', [VALID_INSTANCE_URL, 123], 'accessToken'],
  ] as [string, unknown[], string][])(
    '%s → TypeError（メッセージに "%s" を含む）',
    (_label, args, expectedInMessage) => {
      expect(() => (SalesforceApiClient.create as (...a: unknown[]) => unknown)(...args))
        .toThrow(TypeError);
      try {
        (SalesforceApiClient.create as (...a: unknown[]) => unknown)(...args);
      } catch (e) {
        expect((e as TypeError).message).toContain(expectedInMessage);
      }
    },
  );

  it('apiVersion の形式が不正な場合 TypeError', () => {
    expect(() =>
      SalesforceApiClient.create(VALID_INSTANCE_URL, VALID_ACCESS_TOKEN, { apiVersion: '60.0' }),
    ).toThrow(TypeError);
  });

  it('apiVersion が正しい形式なら成功する', () => {
    expect(() =>
      SalesforceApiClient.create(VALID_INSTANCE_URL, VALID_ACCESS_TOKEN, { apiVersion: 'v61.0' }),
    ).not.toThrow();
  });
});

// ============================================================================
// create — baseUrl の構築
// ============================================================================

describe('SalesforceApiClient.create — baseUrl', () => {
  const captureTransport = (): { calls: { url: string }[]; transport: Transport } => {
    const calls: { url: string }[] = [];
    const transport: Transport = {
      fetch: vi.fn(async (url: string) => {
        calls.push({ url });
        return makeRawResponse({ body: null });
      }),
    };
    return { calls, transport };
  };

  it('デフォルト apiVersion v60.0 で baseUrl を構築する', async () => {
    const { calls, transport } = captureTransport();
    const client = SalesforceApiClient.create(VALID_INSTANCE_URL, VALID_ACCESS_TOKEN);
    // transport を直接差し替えるため extend で wrap
    const extended = client.extend(() => transport);
    await extended.get('/query');
    expect(calls[0].url).toContain('/services/data/v60.0/query');
  });

  it('apiVersion を指定すると URL に反映される', async () => {
    const { calls, transport } = captureTransport();
    const client = SalesforceApiClient.create(VALID_INSTANCE_URL, VALID_ACCESS_TOKEN, { apiVersion: 'v61.0' });
    const extended = client.extend(() => transport);
    await extended.get('/query');
    expect(calls[0].url).toContain('/services/data/v61.0/query');
  });

  it('instanceUrl 末尾スラッシュを正規化する', async () => {
    const { calls, transport } = captureTransport();
    const client = SalesforceApiClient.create(
      'https://yourorg.my.salesforce.com/',
      VALID_ACCESS_TOKEN,
    );
    const extended = client.extend(() => transport);
    await extended.get('/query');
    // ダブルスラッシュにならないこと
    expect(calls[0].url).not.toContain('//services');
    expect(calls[0].url).toContain('https://yourorg.my.salesforce.com/services/data/v60.0/query');
  });
});

// ============================================================================
// create — Authorization ヘッダー
// ============================================================================

describe('SalesforceApiClient.create — Authorization ヘッダー', () => {
  it('Bearer トークンが Authorization ヘッダーに設定される', async () => {
    // transport を DI で最内側に差し込むことで Bearer デコレータがヘッダーを付けた後の状態を観測する
    const innerTransport: Transport = {
      fetch: vi.fn(async () => makeRawResponse()),
    };

    const client = SalesforceApiClient.create(VALID_INSTANCE_URL, 'my-sf-token', {
      transport: innerTransport,
    });
    await client.get('/sobjects');

    const innerCall = (innerTransport.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(innerCall[1]?.headers?.['Authorization']).toBe('Bearer my-sf-token');
  });
});

// ============================================================================
// create — HTTPメソッド
// ============================================================================

describe('SalesforceApiClient.create — HTTPメソッド', () => {
  const makeClient = (body: unknown = null) => {
    const transport = mockTransport(body);
    const client = SalesforceApiClient.create(VALID_INSTANCE_URL, VALID_ACCESS_TOKEN)
      .extend(() => transport);
    return { client, transport };
  };

  it('get() で GET リクエストを送る', async () => {
    const { client, transport } = makeClient({ records: [] });
    await client.get('/query', { q: 'SELECT Id FROM Account' });
    expect(transport.calls[0].options?.method).toBe('GET');
    expect(transport.calls[0].url).toContain('q=SELECT');
  });

  it('post() で POST リクエストを送る', async () => {
    const { client, transport } = makeClient({ id: 'new-id' });
    await client.post('/sobjects/Account', { Name: 'Test Corp' });
    expect(transport.calls[0].options?.method).toBe('POST');
    expect(transport.calls[0].options?.payload).toBe(JSON.stringify({ Name: 'Test Corp' }));
  });

  it('delete() で DELETE リクエストを送る', async () => {
    const { client, transport } = makeClient();
    await client.delete('/sobjects/Account/001xx000003GYn1');
    expect(transport.calls[0].options?.method).toBe('DELETE');
  });
});

// ============================================================================
// create — use() でドメインメソッドを追加
// ============================================================================

describe('SalesforceApiClient.create — use()', () => {
  it('queryAll メソッドをプラグインで追加できる', async () => {
    const transport = mockTransport({ records: [{ Id: '001', Name: 'Acme' }] });
    const client = SalesforceApiClient.create(VALID_INSTANCE_URL, VALID_ACCESS_TOKEN)
      .extend(() => transport)
      .use('queryAll', (c) => (soql: string) => c.get('/query', { q: soql }));

    const result = await client.queryAll('SELECT Id, Name FROM Account');
    expect(transport.calls[0].url).toContain('/query');
    expect(transport.calls[0].url).toContain('SELECT');
    expect(result).toEqual({ records: [{ Id: '001', Name: 'Acme' }] });
  });
});
