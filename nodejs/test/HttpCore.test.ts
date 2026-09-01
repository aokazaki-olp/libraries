import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpCore } from '../src/HttpCore.js';
import { HttpError, RetryExhaustedError } from '../src/httpTypes.js';
import type { RawResponse } from '../src/httpTypes.js';
import { createMockLogger, makeRawResponse, makeTransport } from './helpers.js';

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
    const logger = createMockLogger();
    const error = new HttpError('HTTPエラー 503', 503, null);
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls < 2) throw error;
      return makeRawResponse();
    });

    const retrying = HttpCore.withRetry(transport, { maxRetries: 2, baseDelayMs: 10, logger });
    const promise = retrying.fetch('https://example.com/api');
    await vi.runAllTimersAsync();
    await promise;

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0][0]).toContain('RETRY');
    expect(logger.warn.mock.calls[0][0]).toContain('503');
  });

  it('リトライ上限時に error ログを出力する', async () => {
    const error = new HttpError('HTTPエラー 503', 503, null);
    const logger = createMockLogger();
    const transport = makeErrorTransport(error);

    const retrying = HttpCore.withRetry(transport, { maxRetries: 1, baseDelayMs: 10, logger });
    const promise = retrying.fetch('https://example.com');
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toContain('exhausted');
  });
});

// ============================================================================
// withLogger
// ============================================================================

describe('HttpCore.withLogger', () => {
  it('logger が未指定の場合、元の transport をそのまま返す', () => {
    const transport = makeSuccessTransport();
    const logged = HttpCore.withLogger(transport, undefined);
    expect(logged).toBe(transport);
  });

  it('リクエスト前に debug、成功後に info ログを出力する', async () => {
    const logger = createMockLogger();
    const transport = makeSuccessTransport({ status: 200 });

    const logged = HttpCore.withLogger(transport, logger);
    await logged.fetch('https://example.com/api', { method: 'GET' });

    expect(logger.debug).toHaveBeenCalledOnce();
    expect(logger.debug.mock.calls[0][0]).toContain('→ GET https://example.com/api');

    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toContain('← 200 GET https://example.com/api');
  });

  it('エラー時に error ログを出力してエラーを再スローする', async () => {
    const logger = createMockLogger();
    const httpError = new HttpError('HTTPエラー 500', 500, null);
    const transport = makeErrorTransport(httpError);

    const logged = HttpCore.withLogger(transport, logger);
    await expect(logged.fetch('https://example.com')).rejects.toThrow(HttpError);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toContain('✖');
  });

  it('method が未指定の場合 GET とみなしてログに出力する', async () => {
    const logger = createMockLogger();
    const transport = makeSuccessTransport();
    const logged = HttpCore.withLogger(transport, logger);

    await logged.fetch('https://example.com');
    expect(logger.debug.mock.calls[0][0]).toContain('GET');
  });
});

// ============================================================================
// デコレータの積み重ね（統合）
// ============================================================================

describe('HttpCore — デコレータ積み重ね', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('withRetry + withLogger を積み重ねて動作する', async () => {
    const logger = createMockLogger();

    let calls = 0;
    const baseTransport = makeTransport(async () => {
      calls++;
      if (calls === 1) throw new HttpError('HTTPエラー 503', 503, null);
      return makeRawResponse({ status: 200, body: { data: 'ok' } });
    });

    const transport = HttpCore.withLogger(
      HttpCore.withRetry(baseTransport, { maxRetries: 2, baseDelayMs: 50 }),
      logger,
    );

    const promise = transport.fetch('https://example.com');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.body).toEqual({ data: 'ok' });
    expect(calls).toBe(2);
    expect(logger.info).toHaveBeenCalledOnce(); // Loggerは最外 → 最終成功1回のみ
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

  it('200 正常系 + JSON レスポンス: body が parse された object になる', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true,"data":42}',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    const result = await transport.fetch('https://example.com/api');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: 42 });
  });

  it('JSON でないテキストレスポンス: body が null で text が文字列になる', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'plain text response',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    const result = await transport.fetch('https://example.com/text');
    expect(result.body).toBe('plain text response');
    expect(result.text).toBe('plain text response');
  });

  it('payload が object の場合: fetchOptions.form が設定される', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: {},
      body: '{"result":"ok"}',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await transport.fetch('https://example.com/form', {
      method: 'POST',
      payload: { grant_type: 'client_credentials', client_id: 'xxx' },
    });

    const calledOptions = mockGotFn.mock.calls[0][1] as Record<string, unknown>;
    expect(calledOptions.form).toEqual({ grant_type: 'client_credentials', client_id: 'xxx' });
    expect(calledOptions.body).toBeUndefined();
  });

  it('payload が string の場合: fetchOptions.body が設定される', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: {},
      body: '{"result":"ok"}',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await transport.fetch('https://example.com/json', {
      method: 'POST',
      payload: '{"key":"value"}',
    });

    const calledOptions = mockGotFn.mock.calls[0][1] as Record<string, unknown>;
    expect(calledOptions.body).toBe('{"key":"value"}');
    expect(calledOptions.form).toBeUndefined();
  });

  it('timeoutMs が設定される: fetchOptions.timeout.request に反映される', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: {},
      body: '',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await transport.fetch('https://example.com/', { timeoutMs: 3000 });

    const calledOptions = mockGotFn.mock.calls[0][1] as Record<string, unknown>;
    expect((calledOptions.timeout as Record<string, unknown>).request).toBe(3000);
  });
});

// ============================================================================
// createTransport — bytes 抽出（除外リスト方式）
// ============================================================================

describe('HttpCore.createTransport — bytes 抽出', () => {
  it('JSON レスポンスでも bytes が Uint8Array で埋まる（既存の body/text 挙動は変わらない）', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      rawBody: Buffer.from('{"ok":true}'),
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    const result = await transport.fetch('https://example.com/api');

    expect(result.body).toEqual({ ok: true });
    expect(result.text).toBe('{"ok":true}');
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result.bytes as Uint8Array).toString()).toBe('{"ok":true}');
  });

  it('rawBody が無い（独自 transport 相当のレスポンス）場合 bytes は undefined', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    const result = await transport.fetch('https://example.com/api');

    expect(result.bytes).toBeUndefined();
  });

  it.each(['image/jpeg', 'audio/mpeg', 'video/mp4', 'application/octet-stream', 'application/pdf', 'application/zip'])(
    'Content-Type=%s は既知のバイナリ系として bytes のみを埋め、text は空文字・body は null にする',
    async (contentType) => {
      const binary = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const mockResponse = {
        statusCode: 200,
        headers: { 'content-type': contentType },
        body: binary.toString('latin1'),
        rawBody: binary,
      };
      const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
      const mockGot = mockGotFn as unknown as import('got').Got;

      const transport = HttpCore.createTransport({ got: mockGot });
      const result = await transport.fetch('https://example.com/file');

      expect(result.bytes).toEqual(new Uint8Array(binary));
      expect(result.text).toBe('');
      expect(result.body).toBeNull();
    },
  );

  it('Content-Type にパラメータが付いていても除外リスト判定できる（例: image/png; charset=binary）', async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const mockResponse = {
      statusCode: 200,
      headers: { 'content-type': 'image/png; charset=binary' },
      body: binary.toString('latin1'),
      rawBody: binary,
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    const result = await transport.fetch('https://example.com/file.png');

    expect(result.bytes).toEqual(new Uint8Array(binary));
    expect(result.text).toBe('');
  });

  it('Content-Type 不在の場合は今日と同じ挙動（text/body を埋め、bytes も併せて埋まる）', async () => {
    const mockResponse = {
      statusCode: 200,
      headers: {},
      body: 'plain text response',
      rawBody: Buffer.from('plain text response'),
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    const result = await transport.fetch('https://example.com/text');

    expect(result.text).toBe('plain text response');
    expect(result.body).toBe('plain text response');
    expect(result.bytes).toEqual(new Uint8Array(Buffer.from('plain text response')));
  });

  it('除外リストに該当し、かつ非2xxの場合は HttpError をスローする（body は null のまま）', async () => {
    const binary = Buffer.from([0x00, 0x01]);
    const mockResponse = {
      statusCode: 500,
      headers: { 'content-type': 'application/octet-stream' },
      body: binary.toString('latin1'),
      rawBody: binary,
    };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await expect(transport.fetch('https://example.com/file')).rejects.toThrow(HttpError);
  });
});

// ============================================================================
// createTransport — files（multipart 送信）
// ============================================================================

describe('HttpCore.createTransport — files（multipart 送信）', () => {
  it('files 指定時は got へ FormData を body として渡す（form / json は使わない）', async () => {
    const mockResponse = { statusCode: 200, headers: {}, body: '{}' };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await transport.fetch('https://example.com/upload', {
      method: 'POST',
      payload: { description: 'hello' },
      files: {
        file: {
          kind: 'file',
          filename: 'a.txt',
          contentType: 'text/plain',
          data: new Uint8Array([104, 105]),
        },
      },
    });

    const calledOptions = mockGotFn.mock.calls[0][1] as Record<string, unknown>;
    expect(calledOptions.body).toBeInstanceOf(FormData);
    expect(calledOptions.form).toBeUndefined();

    const form = calledOptions.body as FormData;
    expect(form.get('description')).toBe('hello');

    const filePart = form.get('file') as File;
    expect(filePart.name).toBe('a.txt');
    expect(filePart.type).toBe('text/plain');
    expect(await filePart.text()).toBe('hi');
  });

  it('files が配列の場合は同じキーで複数 append される', async () => {
    const mockResponse = { statusCode: 200, headers: {}, body: '{}' };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    const transport = HttpCore.createTransport({ got: mockGot });
    await transport.fetch('https://example.com/upload', {
      method: 'POST',
      files: {
        file: [
          { kind: 'file', filename: 'a.txt', data: new Uint8Array([97]) },
          { kind: 'file', filename: 'b.txt', data: new Uint8Array([98]) },
        ],
      },
    });

    const calledOptions = mockGotFn.mock.calls[0][1] as Record<string, unknown>;
    const form = calledOptions.body as FormData;
    const files = form.getAll('file') as File[];
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe('a.txt');
    expect(files[1].name).toBe('b.txt');
  });

  it('TransportDeps.formData を注入すると差し替わる', async () => {
    const mockResponse = { statusCode: 200, headers: {}, body: '{}' };
    const mockGotFn = vi.fn().mockResolvedValue(mockResponse);
    const mockGot = mockGotFn as unknown as import('got').Got;

    let createdCount = 0;
    const customFormData = (): FormData => {
      createdCount++;
      return new FormData();
    };

    const transport = HttpCore.createTransport({ got: mockGot, formData: customFormData });
    await transport.fetch('https://example.com/upload', {
      files: { file: { kind: 'file', filename: 'a.txt', data: new Uint8Array([1]) } },
    });

    expect(createdCount).toBe(1);
  });
});
