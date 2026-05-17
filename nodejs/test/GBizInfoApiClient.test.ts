import { describe, it, expect, vi } from 'vitest';
import { GBizInfoApiClient } from '../src/GBizInfoApiClient.js';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.js';
import { HttpError } from '../src/httpTypes.js';
import { createMockLogger, makeRawResponse } from './helpers.js';

const VALID_TOKEN = 'my-token-12345';
const BASE_URL = 'https://info.gbiz.go.jp/hojin/v1';

const mockTransport = (
  responses: Partial<RawResponse> | Partial<RawResponse>[] = {},
): Transport & { calls: { url: string; options?: FetchOptions }[] } => {
  const list = Array.isArray(responses) ? responses : [responses];
  let i = 0;
  const calls: { url: string; options?: FetchOptions }[] = [];
  return {
    calls,
    fetch: vi.fn(async (url: string, options?: FetchOptions) => {
      calls.push({ url, options });
      const r = list[Math.min(i, list.length - 1)];
      i++;
      const raw = makeRawResponse(r);
      // createTransport の契約に合わせ、2xx 以外は HttpError を throw する
      if (raw.status < 200 || raw.status >= 300) {
        throw new HttpError(`HTTPエラー ${raw.status}`, raw.status, raw.body);
      }
      return raw;
    }),
  };
};

// ============================================================================
// バリデーション
// ============================================================================

describe('GBizInfoApiClient.create — バリデーション', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['空文字', ''],
    ['数値', 123],
    ['真偽値 true', true],
    ['真偽値 false', false],
    ['オブジェクト', {}],
    ['配列', []],
  ] as [string, unknown][])(
    'token が %s だと TypeError',
    (_label, token) => {
      expect(() =>
        // @ts-expect-error: runtime バリデーションを確認するため意図的に型違反
        GBizInfoApiClient.create(token),
      ).toThrow(TypeError);
      try {
        // @ts-expect-error: 同上
        GBizInfoApiClient.create(token);
      } catch (e) {
        expect((e as TypeError).message).toContain('gBizINFO API token');
      }
    },
  );
});

// ============================================================================
// クライアント構造
// ============================================================================

describe('GBizInfoApiClient.create — クライアント構造', () => {
  it('HTTP ショートカット / call / use / extend を備える', () => {
    const client = GBizInfoApiClient.create(VALID_TOKEN);
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.patch).toBe('function');
    expect(typeof client.delete).toBe('function');
    expect(typeof client.call).toBe('function');
    expect(typeof client.use).toBe('function');
    expect(typeof client.extend).toBe('function');
  });
});

// ============================================================================
// 認証ヘッダ
// ============================================================================

describe('GBizInfoApiClient.create — 認証ヘッダ', () => {
  it('X-hojinInfo-api-token ヘッダにトークンを乗せる', async () => {
    const transport = mockTransport({ body: { 'hojin-infos': [] } });
    const client = GBizInfoApiClient.create(VALID_TOKEN, { transport });
    await client.get('/hojin/1234567890123');
    expect(transport.calls[0].options?.headers?.['X-hojinInfo-api-token']).toBe(VALID_TOKEN);
  });

  it('Authorization ヘッダは付与されない (Bearer ではない)', async () => {
    const transport = mockTransport({ body: {} });
    const client = GBizInfoApiClient.create('t', { transport });
    await client.get('/hojin/1');
    expect(transport.calls[0].options?.headers?.['Authorization']).toBeUndefined();
  });

  it('Accept: application/json が付与される', async () => {
    const transport = mockTransport({ body: {} });
    const client = GBizInfoApiClient.create('t', { transport });
    await client.get('/hojin/1');
    expect(transport.calls[0].options?.headers?.['Accept']).toBe('application/json');
  });
});

// ============================================================================
// URL 構築
// ============================================================================

describe('GBizInfoApiClient.create — URL 構築', () => {
  it('baseUrl + endpoint で URL を組む', async () => {
    const transport = mockTransport({ body: {} });
    const client = GBizInfoApiClient.create('t', { transport });
    await client.get('/hojin/1234567890123');
    expect(transport.calls[0].url.startsWith(`${BASE_URL}/hojin/1234567890123`)).toBe(true);
  });

  it('クエリパラメータが付与される', async () => {
    const transport = mockTransport({ body: {} });
    const client = GBizInfoApiClient.create('t', { transport });
    await client.get('/hojin', { name: 'テスト株式会社', limit: 10 });
    const url = transport.calls[0].url;
    expect(url).toContain(`name=${encodeURIComponent('テスト株式会社')}`);
    expect(url).toContain('limit=10');
  });

  it('クエリ未指定だと ? が付かない', async () => {
    const transport = mockTransport({ body: {} });
    const client = GBizInfoApiClient.create('t', { transport });
    await client.get('/hojin/1');
    expect(transport.calls[0].url).not.toContain('?');
  });
});

// ============================================================================
// レスポンスハンドラ
// ============================================================================

describe('GBizInfoApiClient.create — レスポンスハンドラ', () => {
  it('成功時はレスポンス body を返す', async () => {
    const body = { 'hojin-infos': [{ corporate_number: '1234567890123', name: 'A 社' }] };
    const transport = mockTransport({ body });
    const client = GBizInfoApiClient.create<typeof body>('t', { transport });
    const result = await client.get('/hojin/1234567890123');
    expect(result['hojin-infos'][0].corporate_number).toBe('1234567890123');
  });

  it('HTTP 404 では HttpError がスローされる', async () => {
    const transport = mockTransport({ status: 404, body: { errors: [{ message: 'Not Found' }] } });
    const client = GBizInfoApiClient.create('t', { transport });
    await expect(client.get('/hojin/0000000000000')).rejects.toThrow(/404/);
  });

  it('4xx は即時スロー (再試行されない)', async () => {
    const transport = mockTransport([
      { status: 401, body: { error: 'unauthorized' } },
      { status: 200, body: { ok: true } },
    ]);
    const client = GBizInfoApiClient.create('bad', { transport });
    await expect(client.get('/hojin/1')).rejects.toThrow(/401/);
    expect(transport.calls.length).toBe(1);
  });
});

// ============================================================================
// リトライ
// ============================================================================

describe('GBizInfoApiClient.create — リトライ', () => {
  it('503 が返ると再試行され、200 で成功する', async () => {
    const transport = mockTransport([
      { status: 503, body: 'service unavailable' },
      { status: 200, body: { ok: true } },
    ]);
    const client = GBizInfoApiClient.create<{ ok: boolean }>('t', {
      transport,
      baseDelayMs: 1,
    });
    const result = await client.get('/hojin/1');
    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(2);
  });

  it('429 が返るとリトライされる', async () => {
    const transport = mockTransport([
      { status: 429, body: 'Too Many Requests' },
      { status: 200, body: { ok: true } },
    ]);
    const client = GBizInfoApiClient.create<{ ok: boolean }>('t', {
      transport,
      baseDelayMs: 1,
    });
    const result = await client.get('/hojin/1');
    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(2);
  });

  it('連続 503 でリトライ上限に達するとエラー', async () => {
    const transport = mockTransport([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
    ]);
    const client = GBizInfoApiClient.create('t', { transport, baseDelayMs: 1 });
    await expect(client.get('/hojin/1')).rejects.toThrow();
    expect(transport.calls.length).toBe(4);
  });
});

// ============================================================================
// 拡張口 (use)
// ============================================================================

describe('GBizInfoApiClient.create — use()', () => {
  it('.use() で呼び出し側がメソッドを注入できる', async () => {
    const transport = mockTransport({ body: { name: 'A 社' } });
    const client = GBizInfoApiClient.create('t', { transport })
      .use('byCorporateNumber', (c) => (corporateNumber: string) =>
        c.get(`/hojin/${corporateNumber}`),
      );
    const result = await client.byCorporateNumber('1234567890123');
    expect((result as { name: string }).name).toBe('A 社');
    expect(transport.calls[0].url.endsWith('/hojin/1234567890123')).toBe(true);
  });

  it('複数の use() を連鎖できる', async () => {
    const transport = mockTransport({ body: { ok: 1 } });
    const client = GBizInfoApiClient.create('t', { transport })
      .use('byNumber', (c) => (n: string) => c.get(`/hojin/${n}`))
      .use('search', (c) => (name: string) => c.get('/hojin', { name }));
    expect(typeof client.byNumber).toBe('function');
    expect(typeof client.search).toBe('function');
    await client.byNumber('1');
    await client.search('A 社');
    expect(transport.calls.length).toBe(2);
  });
});

// ============================================================================
// logger
// ============================================================================

describe('GBizInfoApiClient.create — logger', () => {
  it('logger が transport ログを記録する', async () => {
    const logger = createMockLogger();
    const transport = mockTransport({ body: { ok: true } });
    const client = GBizInfoApiClient.create('t', { transport, logger });
    await client.get('/hojin/1');
    const total =
      logger.calls.trace.length + logger.calls.debug.length +
      logger.calls.info.length + logger.calls.warn.length + logger.calls.error.length;
    expect(total).toBeGreaterThan(0);
  });
});
