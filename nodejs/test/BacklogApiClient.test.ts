import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BacklogApiClient, BacklogApiError, BacklogCore } from '../src/BacklogApiClient.js';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.js';
import { HttpError, RetryExhaustedError } from '../src/httpTypes.js';
import { createMockLogger, makeRawResponse } from './helpers.js';

const SPACE_URL = 'https://example.backlog.jp';
const BASE_URL = 'https://example.backlog.jp/api/v2';

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
        throw new HttpError(`HTTPエラー ${raw.status}`, raw.status, raw.body, raw.headers, raw.text);
      }
      return raw;
    }),
  };
};

// ============================================================================
// バリデーション
// ============================================================================

describe('BacklogApiClient.create — バリデーション（spaceUrl）', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['空文字', ''],
    ['数値', 123],
  ] as [string, unknown][])('spaceUrl が %s だと TypeError', (_label, spaceUrl) => {
    expect(() =>
      // @ts-expect-error: runtime バリデーションを確認するため意図的に型違反
      BacklogApiClient.create(spaceUrl, { apiKey: 'k' }),
    ).toThrow(TypeError);
  });
});

describe('BacklogApiClient.create — バリデーション（auth）', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['数値', 123],
    ['空オブジェクト', {}],
    ['apiKey が空文字', { apiKey: '' }],
    ['accessToken が空文字', { accessToken: '' }],
    ['apiKey が非string', { apiKey: 123 }],
  ] as [string, unknown][])('auth が %s だと TypeError', (_label, auth) => {
    expect(() =>
      // @ts-expect-error: runtime バリデーションを確認するため意図的に型違反
      BacklogApiClient.create(SPACE_URL, auth),
    ).toThrow(TypeError);
  });
});

// ============================================================================
// クライアント構造
// ============================================================================

describe('BacklogApiClient.create — クライアント構造', () => {
  it('HTTP ショートカット / call / use / extend を備える', () => {
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' });
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
// URL 構築
// ============================================================================

describe('BacklogApiClient.create — URL 構築', () => {
  it('spaceUrl + /api/v2 + endpoint で URL を組む', async () => {
    const transport = mockTransport({ body: [] });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport });
    await client.get('/projects');
    expect(transport.calls[0].url).toBe(`${BASE_URL}/projects`);
  });

  it('spaceUrl の末尾スラッシュを許容する', async () => {
    const transport = mockTransport({ body: [] });
    const client = BacklogApiClient.create(`${SPACE_URL}/`, { apiKey: 'k' }, { transport });
    await client.get('/projects');
    expect(transport.calls[0].url).toBe(`${BASE_URL}/projects`);
  });

  it('クエリパラメータが付与される', async () => {
    const transport = mockTransport({ body: [] });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport });
    await client.get('/issues', { projectId: 1 });
    expect(transport.calls[0].url).toContain('projectId=1');
  });
});

// ============================================================================
// 認証
// ============================================================================

describe('BacklogApiClient.create — 認証', () => {
  it('apiKey 指定時は Backlog-API-Key ヘッダにトークンを乗せる', async () => {
    const transport = mockTransport({ body: [] });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'my-key' }, { transport });
    await client.get('/projects');
    expect(transport.calls[0].options?.headers?.['Backlog-API-Key']).toBe('my-key');
    expect(transport.calls[0].options?.headers?.['Authorization']).toBeUndefined();
  });

  it('accessToken 指定時は Authorization: Bearer を付与する（Backlog-API-Key は付かない）', async () => {
    const transport = mockTransport({ body: [] });
    const client = BacklogApiClient.create(SPACE_URL, { accessToken: 'tok' }, { transport });
    await client.get('/projects');
    expect(transport.calls[0].options?.headers?.['Authorization']).toBe('Bearer tok');
    expect(transport.calls[0].options?.headers?.['Backlog-API-Key']).toBeUndefined();
  });

  it('Accept: application/json が付与される', async () => {
    const transport = mockTransport({ body: [] });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport });
    await client.get('/projects');
    expect(transport.calls[0].options?.headers?.['Accept']).toBe('application/json');
  });
});

// ============================================================================
// レスポンスハンドラ
// ============================================================================

describe('BacklogApiClient.create — レスポンスハンドラ', () => {
  it('成功時はレスポンス body を返す', async () => {
    const body = [{ id: 1, name: 'Project A' }];
    const transport = mockTransport({ body });
    const client = BacklogApiClient.create<typeof body>(SPACE_URL, { apiKey: 'k' }, { transport });
    const result = await client.get('/projects');
    expect(result[0].name).toBe('Project A');
  });
});

// ============================================================================
// エラー正規化
// ============================================================================

describe('BacklogApiClient.create — エラー正規化', () => {
  it('{"errors":[...]} 形式のレスポンスから BacklogApiError をスローする（code / errors / response を保持）', async () => {
    const errors = [{ message: 'No project.', code: 6, moreInfo: '' }];
    const transport = mockTransport({ status: 404, body: { errors } });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport });

    let err: BacklogApiError | undefined;
    try {
      await client.get('/projects/0');
    } catch (e) {
      err = e as BacklogApiError;
    }

    expect(err).toBeInstanceOf(BacklogApiError);
    expect(err?.code).toBe(6);
    expect(err?.errors).toEqual(errors);
    expect(err?.response?.status).toBe(404);
    expect(err?.message).toContain('No project.');
  });

  it('errors 形式でないエラーレスポンス（4xx）は HttpError のまま伝播する', async () => {
    const transport = mockTransport({ status: 400, body: 'bad request' });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport });

    let err: unknown;
    try {
      await client.get('/projects');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect(err).not.toBeInstanceOf(BacklogApiError);
  });
});

// ============================================================================
// リトライ（X-RateLimit-Reset）
// ============================================================================

describe('BacklogApiClient.create — リトライ', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('429 で X-RateLimit-Reset（UNIX秒）を尊重してリトライする', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(now);
    const resetEpochSec = Math.floor(now.getTime() / 1000) + 5;

    const transport = mockTransport([
      {
        status: 429,
        headers: { 'X-RateLimit-Reset': String(resetEpochSec) },
        body: { errors: [{ message: 'rate limit', code: 13 }] },
      },
      { status: 200, body: { ok: true } },
    ]);
    const client = BacklogApiClient.create<{ ok: boolean }>(SPACE_URL, { apiKey: 'k' }, { transport });

    const promise = client.get('/projects');
    const assertion = expect(promise).resolves.toEqual({ ok: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
    expect(transport.calls.length).toBe(2);
  });

  it('503 は指数バックオフでリトライされる', async () => {
    const transport = mockTransport([
      { status: 503, body: 'down' },
      { status: 200, body: { ok: true } },
    ]);
    const client = BacklogApiClient.create<{ ok: boolean }>(SPACE_URL, { apiKey: 'k' }, {
      transport,
      baseDelayMs: 1,
    });

    const promise = client.get('/projects');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(2);
  });

  it('401（429 以外の 4xx）はリトライしない', async () => {
    const transport = mockTransport({ status: 401, body: { errors: [{ message: 'auth failed', code: 11 }] } });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'bad' }, { transport });

    await expect(client.get('/projects')).rejects.toThrow(BacklogApiError);
    expect(transport.calls.length).toBe(1);
  });

  it('連続 503 でリトライ上限に達すると RetryExhaustedError', async () => {
    const transport = mockTransport([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
    ]);
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport, baseDelayMs: 1 });

    const promise = client.get('/projects');
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(transport.calls.length).toBe(4);
  });
});

// ============================================================================
// BacklogCore.withRetry（単体）
// ============================================================================

describe('BacklogCore.withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('X-RateLimit-Reset が過去の時刻でも待機時間は 0 にクランプされる', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(now);
    const pastEpochSec = Math.floor(now.getTime() / 1000) - 100;

    let calls = 0;
    const transport: Transport = {
      fetch: vi.fn(async () => {
        calls++;
        if (calls === 1) {
          throw new HttpError('429', 429, null, { 'X-RateLimit-Reset': String(pastEpochSec) });
        }
        return makeRawResponse();
      }),
    };

    const retrying = BacklogCore.withRetry(transport, { maxRetries: 2 });
    const promise = retrying.fetch('https://example.backlog.jp/api/v2/projects');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('X-RateLimit-Reset が無い 429 は baseDelayMs にフォールバックする', async () => {
    let calls = 0;
    const transport: Transport = {
      fetch: vi.fn(async () => {
        calls++;
        if (calls === 1) {
          throw new HttpError('429', 429, null, {});
        }
        return makeRawResponse();
      }),
    };

    const retrying = BacklogCore.withRetry(transport, { maxRetries: 2, baseDelayMs: 250 });
    const promise = retrying.fetch('https://example.backlog.jp/api/v2/projects');
    const assertion = expect(promise).resolves.toBeDefined();

    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it('RetryExhaustedError は再スローして二重ラップしない', async () => {
    const error = new RetryExhaustedError('already exhausted');
    const transport: Transport = { fetch: vi.fn(async () => { throw error; }) };
    const retrying = BacklogCore.withRetry(transport, { maxRetries: 3 });

    await expect(retrying.fetch('https://example.backlog.jp/api/v2/x')).rejects.toThrow('already exhausted');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 拡張口 (use)
// ============================================================================

describe('BacklogApiClient.create — use()', () => {
  it('.use() で呼び出し側がドメインメソッドを注入できる', async () => {
    const transport = mockTransport({ body: [{ id: 1, name: 'Project A' }] });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport })
      .use('projects', (c) => () => c.get('/projects'));

    const result = await client.projects();
    expect((result as { name: string }[])[0].name).toBe('Project A');
  });
});

// ============================================================================
// logger
// ============================================================================

describe('BacklogApiClient.create — logger', () => {
  it('logger が transport ログを記録する', async () => {
    const logger = createMockLogger();
    const transport = mockTransport({ body: { ok: true } });
    const client = BacklogApiClient.create(SPACE_URL, { apiKey: 'k' }, { transport, logger });
    await client.get('/projects');

    const total =
      logger.calls.trace.length + logger.calls.debug.length +
      logger.calls.info.length + logger.calls.warn.length + logger.calls.error.length;
    expect(total).toBeGreaterThan(0);
  });
});
