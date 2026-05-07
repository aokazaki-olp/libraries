import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpCore } from '../src/HttpCore.js';
import { HttpError, RetryExhaustedError } from '../src/types.js';
import type { RawResponse } from '../src/types.js';
import { makeRawResponse, makeTransport } from './helpers.js';

// ============================================================================
// テストユーティリティ
// ============================================================================

const makeSuccessTransport = (response?: Partial<RawResponse>) =>
  makeTransport(() => Promise.resolve(makeRawResponse(response)));

const makeErrorTransport = (error: unknown) =>
  makeTransport(() => Promise.reject(error));

// ============================================================================
// cloneHeaders / mergeHeaders / hasHeader
// ============================================================================

describe('HttpCore.cloneHeaders', () => {
  it('ヘッダーをコピーして返す', () => {
    const original = { 'Content-Type': 'application/json' };
    const cloned = HttpCore.cloneHeaders(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
  });

  it('undefined を渡すと空オブジェクトを返す', () => {
    expect(HttpCore.cloneHeaders(undefined)).toEqual({});
  });
});

describe('HttpCore.mergeHeaders', () => {
  it('base と override をマージする', () => {
    const base = { 'Accept': 'application/json', 'X-Custom': 'base' };
    const override = { 'X-Custom': 'overridden', 'Authorization': 'Bearer token' };
    expect(HttpCore.mergeHeaders(base, override)).toEqual({
      'Accept': 'application/json',
      'X-Custom': 'overridden',
      'Authorization': 'Bearer token',
    });
  });

  it('override が undefined でも動作する', () => {
    const base = { 'Accept': 'application/json' };
    expect(HttpCore.mergeHeaders(base, undefined)).toEqual(base);
  });
});

describe('HttpCore.hasHeader', () => {
  it('キーが存在する場合 true を返す', () => {
    expect(HttpCore.hasHeader({ 'Content-Type': 'application/json' }, 'Content-Type')).toBe(true);
  });

  it('大文字小文字を区別しない', () => {
    expect(HttpCore.hasHeader({ 'content-type': 'application/json' }, 'Content-Type')).toBe(true);
    expect(HttpCore.hasHeader({ 'CONTENT-TYPE': 'application/json' }, 'content-type')).toBe(true);
  });

  it('存在しない場合 false を返す', () => {
    expect(HttpCore.hasHeader({ 'Accept': 'application/json' }, 'Content-Type')).toBe(false);
  });

  it('空オブジェクトは false を返す', () => {
    expect(HttpCore.hasHeader({}, 'Content-Type')).toBe(false);
  });
});

// ============================================================================
// withRetry — 成功ケース
// ============================================================================

describe('HttpCore.withRetry — 成功ケース', () => {
  it('初回成功でそのまま返す', async () => {
    const expected = makeRawResponse({ status: 200, body: { ok: true } });
    const transport = makeSuccessTransport({ status: 200, body: { ok: true } });
    const retrying = HttpCore.withRetry(transport, { maxRetries: 3 });
    const result = await retrying.fetch('https://example.com');
    expect(result).toEqual(expected);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// withRetry — リトライ対象ステータス
// ============================================================================

describe('HttpCore.withRetry — リトライ対象', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([429, 500, 502, 503, 504])('status=%i はリトライする', async (status) => {
    const error = new HttpError(`HTTPエラー ${status}`, status, null);
    let callCount = 0;
    const transport = makeTransport(async () => {
      callCount++;
      if (callCount < 3) {
        throw error;
      }
      return makeRawResponse({ status: 200 });
    });

    const retrying = HttpCore.withRetry(transport, { maxRetries: 3, baseDelayMs: 100 });
    const promise = retrying.fetch('https://example.com');
    // タイマーを進める（2回分のバックオフ）
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(200);
    expect(callCount).toBe(3);
  });

  it('maxRetries 回リトライして失敗したら RetryExhaustedError をスローする', async () => {
    const error = new HttpError('HTTPエラー 503', 503, null);
    const transport = makeErrorTransport(error);

    const retrying = HttpCore.withRetry(transport, { maxRetries: 2, baseDelayMs: 100 });
    const promise = retrying.fetch('https://example.com');
    // rejects を先に登録してから unhandled rejection を防ぐ
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(transport.fetch).toHaveBeenCalledTimes(3); // 初回 + 2回リトライ
  });

  it('指数バックオフ: 2回リトライで 100ms, 200ms のスリープが発生する', async () => {
    const error = new HttpError('HTTPエラー 503', 503, null);
    const transport = makeErrorTransport(error);
    const retrying = HttpCore.withRetry(transport, { maxRetries: 2, baseDelayMs: 100 });

    const promise = retrying.fetch('https://example.com');
    // unhandled rejection を防ぐために先に登録する
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);

    // attempt=0: まずマイクロタスク（初回fetch失敗）を処理してからタイマーが設定される
    await vi.advanceTimersByTimeAsync(0);

    // attempt=0: 100ms * 2^0 = 100ms のタイマーが1個あるはず
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);

    // attempt=1: 100ms * 2^1 = 200ms のタイマーが1個あるはず
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);

    await assertion;
  });
});

// ============================================================================
// withRetry — リトライ対象外
// ============================================================================

describe('HttpCore.withRetry — リトライ対象外', () => {
  it.each([400, 401, 403, 404, 422])('status=%i はリトライしない', async (status) => {
    const error = new HttpError(`HTTPエラー ${status}`, status, null);
    const transport = makeErrorTransport(error);
    const retrying = HttpCore.withRetry(transport, { maxRetries: 3 });

    await expect(retrying.fetch('https://example.com')).rejects.toThrow(HttpError);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it('RetryExhaustedError は再スローして二重ラップしない', async () => {
    const error = new RetryExhaustedError('already exhausted');
    const transport = makeErrorTransport(error);
    const retrying = HttpCore.withRetry(transport, { maxRetries: 3 });

    await expect(retrying.fetch('https://example.com')).rejects.toThrow('already exhausted');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// withRetry — ロギング
// ============================================================================

describe('HttpCore.withRetry — ロギング', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('リトライ時に warn ログを出力する', async () => {
    const warn = vi.fn();
    const error = new HttpError('HTTPエラー 503', 503, null);
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls < 2) throw error;
      return makeRawResponse();
    });

    const retrying = HttpCore.withRetry(transport, { maxRetries: 2, baseDelayMs: 10, logger: { warn, error: vi.fn() } });
    const promise = retrying.fetch('https://example.com/api');
    await vi.runAllTimersAsync();
    await promise;

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('RETRY');
    expect(warn.mock.calls[0][0]).toContain('503');
  });

  it('リトライ上限時に error ログを出力する', async () => {
    const error = new HttpError('HTTPエラー 503', 503, null);
    const errorLog = vi.fn();
    const transport = makeErrorTransport(error);

    const retrying = HttpCore.withRetry(transport, { maxRetries: 1, baseDelayMs: 10, logger: { warn: vi.fn(), error: errorLog } });
    const promise = retrying.fetch('https://example.com');
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls[0][0]).toContain('exhausted');
  });
});

// ============================================================================
// withLogger
// ============================================================================

describe('HttpCore.withLogger', () => {
  it('logger が null の場合、元の transport をそのまま返す', () => {
    const transport = makeSuccessTransport();
    const logged = HttpCore.withLogger(transport, null);
    expect(logged).toBe(transport);
  });

  it('リクエスト前に debug、成功後に info ログを出力する', async () => {
    const debug = vi.fn();
    const info = vi.fn();
    const transport = makeSuccessTransport({ status: 200 });

    const logged = HttpCore.withLogger(transport, { debug, info, error: vi.fn() });
    await logged.fetch('https://example.com/api', { method: 'GET' });

    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0][0]).toContain('→ GET https://example.com/api');

    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toContain('← 200 GET https://example.com/api');
  });

  it('エラー時に error ログを出力してエラーを再スローする', async () => {
    const error = vi.fn();
    const httpError = new HttpError('HTTPエラー 500', 500, null);
    const transport = makeErrorTransport(httpError);

    const logged = HttpCore.withLogger(transport, { debug: vi.fn(), info: vi.fn(), error });
    await expect(logged.fetch('https://example.com')).rejects.toThrow(HttpError);

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('✖');
  });

  it('method が未指定の場合 GET とみなしてログに出力する', async () => {
    const debug = vi.fn();
    const transport = makeSuccessTransport();
    const logged = HttpCore.withLogger(transport, { debug, info: vi.fn(), error: vi.fn() });

    await logged.fetch('https://example.com');
    expect(debug.mock.calls[0][0]).toContain('GET');
  });
});

// ============================================================================
// デコレータの積み重ね（統合）
// ============================================================================

describe('HttpCore — デコレータ積み重ね', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('withRetry + withLogger を積み重ねて動作する', async () => {
    const debugLog = vi.fn();
    const infoLog = vi.fn();

    let calls = 0;
    const baseTransport = makeTransport(async () => {
      calls++;
      if (calls === 1) throw new HttpError('HTTPエラー 503', 503, null);
      return makeRawResponse({ status: 200, body: { data: 'ok' } });
    });

    const transport = HttpCore.withLogger(
      HttpCore.withRetry(baseTransport, { maxRetries: 2, baseDelayMs: 50 }),
      { debug: debugLog, info: infoLog, error: vi.fn(), warn: vi.fn() },
    );

    const promise = transport.fetch('https://example.com');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.body).toEqual({ data: 'ok' });
    expect(calls).toBe(2);
    expect(infoLog).toHaveBeenCalledOnce(); // Loggerは最外 → 最終成功1回のみ
  });
});

// ============================================================================
// createTransport
// ============================================================================

describe('HttpCore.createTransport — got 統合', () => {
  it('非2xxレスポンスで HttpError をスローする', async () => {
    const mockResponse = {
      statusCode: 404,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"Not Found"}',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    // Got インターフェースに合わせてキャスト
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await expect(transport.fetch('https://example.com/not-found', { method: 'GET' })).rejects.toThrow(HttpError);
  });
});
