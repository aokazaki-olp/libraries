import { describe, it, expect, vi } from 'vitest';
import { InvoiceApiClient } from '../src/InvoiceApiClient.js';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.js';
import { HttpError } from '../src/httpTypes.js';
import { createMockLogger, makeRawResponse } from './helpers.js';

const VALID_APP_ID = 'app-id-xxxxxxxx';
const BASE_URL = 'https://web-api.invoice-kohyo.nta.go.jp/1';

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

describe('InvoiceApiClient.create — バリデーション', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['空文字', ''],
    ['数値', 123],
    ['真偽値 true', true],
    ['オブジェクト', {}],
    ['配列', []],
  ] as [string, unknown][])(
    'applicationId が %s だと TypeError',
    (_label, appId) => {
      expect(() =>
        // @ts-expect-error: runtime バリデーションを確認するため意図的に型違反
        InvoiceApiClient.create(appId),
      ).toThrow(TypeError);
    },
  );

  it('未対応 version 指定で TypeError', () => {
    expect(() =>
      // @ts-expect-error: runtime バリデーション
      InvoiceApiClient.create(VALID_APP_ID, { version: '2' }),
    ).toThrow(/version/);
  });
});

// ============================================================================
// クライアント構造
// ============================================================================

describe('InvoiceApiClient.create — クライアント構造', () => {
  it('HTTP ショートカット / call / use / extend を備える', () => {
    const client = InvoiceApiClient.create(VALID_APP_ID);
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.call).toBe('function');
    expect(typeof client.use).toBe('function');
    expect(typeof client.extend).toBe('function');
  });
});

// ============================================================================
// URL 構築 / 認証クエリ
// ============================================================================

describe('InvoiceApiClient.create — URL 構築', () => {
  it('baseUrl + endpoint で URL を組む', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await client.get('/num', { number: 'T1234567890123' });
    expect(transport.calls[0].url.startsWith(`${BASE_URL}/num`)).toBe(true);
  });

  it('認証クエリ id / 既定 type=21 / 既定 version=1 が自動付与される', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await client.get('/num', { number: 'T1234567890123' });
    const url = transport.calls[0].url;
    expect(url).toContain(`id=${VALID_APP_ID}`);
    expect(url).toContain('type=21');
    expect(url).toContain('version=1');
    expect(url).toContain('number=T1234567890123');
  });

  it('type オプションでレスポンス形式コードを変更できる', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport, type: '01' });
    await client.get('/num', { number: 'T1234567890123' });
    expect(transport.calls[0].url).toContain('type=01');
  });

  it('ユーザ指定のクエリと認証クエリが両立する (& で連結)', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await client.get('/diff', { from: '2026-05-01', to: '2026-05-19' });
    const url = transport.calls[0].url;
    expect(url).toContain('from=2026-05-01');
    expect(url).toContain('to=2026-05-19');
    expect(url).toContain(`id=${VALID_APP_ID}`);
  });

  it('クエリ未指定でも認証クエリで ? が付く', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await client.get('/num');
    expect(transport.calls[0].url).toContain('?');
    expect(transport.calls[0].url).toContain(`id=${VALID_APP_ID}`);
  });
});

// ============================================================================
// ヘッダ
// ============================================================================

describe('InvoiceApiClient.create — ヘッダ', () => {
  it('Accept: application/json が付与される', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await client.get('/num');
    expect(transport.calls[0].options?.headers?.['Accept']).toBe('application/json');
  });

  it('Authorization ヘッダは付与されない', async () => {
    const transport = mockTransport({ body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await client.get('/num');
    expect(transport.calls[0].options?.headers?.['Authorization']).toBeUndefined();
  });
});

// ============================================================================
// レスポンスハンドラ
// ============================================================================

describe('InvoiceApiClient.create — レスポンス', () => {
  it('成功時はレスポンス body を返す', async () => {
    const body = { announcement: [{ registratedNumber: 'T1234567890123', name: '株式会社A' }] };
    const transport = mockTransport({ body });
    const client = InvoiceApiClient.create<typeof body>(VALID_APP_ID, { transport });
    const result = await client.get('/num', { number: 'T1234567890123' });
    expect(result.announcement[0].registratedNumber).toBe('T1234567890123');
  });

  it('HTTP 404 では HttpError がスローされる', async () => {
    const transport = mockTransport({ status: 404, body: {} });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport });
    await expect(client.get('/num', { number: 'T0000000000000' })).rejects.toThrow(/404/);
  });
});

// ============================================================================
// リトライ
// ============================================================================

describe('InvoiceApiClient.create — リトライ', () => {
  it('503 が返ると再試行され、200 で成功する', async () => {
    const transport = mockTransport([
      { status: 503, body: 'service unavailable' },
      { status: 200, body: { ok: true } },
    ]);
    const client = InvoiceApiClient.create<{ ok: boolean }>(VALID_APP_ID, {
      transport,
      baseDelayMs: 1,
    });
    const result = await client.get('/num');
    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(2);
  });
});

// ============================================================================
// 拡張口 (use)
// ============================================================================

describe('InvoiceApiClient.create — use()', () => {
  it('.use() で byNumber 等のドメインメソッドを注入できる', async () => {
    const transport = mockTransport({ body: { announcement: [{ name: '株式会社A' }] } });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport })
      .use('byNumber', (c) => (number: string) =>
        c.get('/num', { number, history: 0 }),
      );
    const result = await client.byNumber('T1234567890123');
    expect((result as { announcement: { name: string }[] }).announcement[0].name).toBe('株式会社A');
    const url = transport.calls[0].url;
    expect(url).toContain('number=T1234567890123');
    expect(url).toContain('history=0');
    expect(url).toContain(`id=${VALID_APP_ID}`);
  });
});

// ============================================================================
// logger
// ============================================================================

describe('InvoiceApiClient.create — logger', () => {
  it('logger が transport ログを記録する', async () => {
    const logger = createMockLogger();
    const transport = mockTransport({ body: { ok: true } });
    const client = InvoiceApiClient.create(VALID_APP_ID, { transport, logger });
    await client.get('/num');
    const total =
      logger.calls.trace.length + logger.calls.debug.length +
      logger.calls.info.length + logger.calls.warn.length + logger.calls.error.length;
    expect(total).toBeGreaterThan(0);
  });
});
