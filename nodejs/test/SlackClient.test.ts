import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackCore, SlackApiClient, SlackWebhookClient } from '../src/SlackClient.js';
import { SlackApiError } from '../src/SlackClient.js';
import { HttpError, RetryExhaustedError } from '../src/httpTypes.js';
import type { RawResponse } from '../src/httpTypes.js';
import { makeTransport } from './helpers.js';

// ============================================================================
// テストユーティリティ
// ============================================================================

const makeRawResponse = (overrides: Partial<RawResponse> = {}): RawResponse => ({
  status: 200,
  headers: {},
  body: { ok: true },
  text: '{"ok":true}',
  ...overrides,
});

const makeSuccessTransport = (body: unknown = { ok: true }) =>
  makeTransport(() => Promise.resolve(makeRawResponse({ body, text: JSON.stringify(body) })));

const makeHttpErrorTransport = (status: number, headers: Record<string, string> = {}) =>
  makeTransport(() => Promise.reject(new HttpError(`HTTP ${status}`, status, null, headers)));

// ============================================================================
// SlackCore.withRetry — 成功ケース
// ============================================================================

describe('SlackCore.withRetry — 成功ケース', () => {
  it('成功時はリトライせず1回で返す', async () => {
    const transport = makeSuccessTransport();
    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });
    const result = await retrying.fetch('https://slack.com/api/test');

    expect((result.body as { ok: boolean }).ok).toBe(true);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// SlackCore.withRetry — 429 Retry-After
// ============================================================================

describe('SlackCore.withRetry — 429 Retry-After', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('429 で Retry-After を尊重してリトライする', async () => {
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls === 1) throw new HttpError('429', 429, null, { 'Retry-After': '2' });
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(calls).toBe(2);
  });

  it('Retry-After が小文字でも認識する', async () => {
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls === 1) throw new HttpError('429', 429, null, { 'retry-after': '1' });
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(calls).toBe(2);
  });

  it('Retry-After がない場合 1秒待機', async () => {
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls === 1) throw new HttpError('429', 429, null, {});
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });
    const promise = retrying.fetch('https://slack.com/api/test');

    const assertion = expect(promise).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(1); // 1秒タイマーが1個
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(2);
  });

  it('Retry-After が非数値の場合も 1秒にフォールバック', async () => {
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls === 1)
        throw new HttpError('429', 429, null, { 'Retry-After': 'Thu, 01 Dec 2026 16:00:00 GMT' });
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(2);
  });

  it('429 が maxRetries 回続いたら RetryExhaustedError', async () => {
    const transport = makeHttpErrorTransport(429, { 'Retry-After': '1' });
    const retrying = SlackCore.withRetry(transport, { maxRetries: 2 });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(transport.fetch).toHaveBeenCalledTimes(3); // 初回 + 2回
  });
});

// ============================================================================
// SlackCore.withRetry — 5xx 指数バックオフ
// ============================================================================

describe('SlackCore.withRetry — 5xx リトライ', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([500, 502, 503, 504])('status=%i でリトライする', async (status) => {
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls < 3) throw new HttpError(`${status}`, status, null);
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, { maxRetries: 3, baseDelayMs: 100 });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(calls).toBe(3);
  });

  it('5xx が maxRetries 回続いたら RetryExhaustedError', async () => {
    const transport = makeHttpErrorTransport(503);
    const retrying = SlackCore.withRetry(transport, { maxRetries: 2, baseDelayMs: 100 });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(transport.fetch).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// SlackCore.withRetry — リトライ対象外
// ============================================================================

describe('SlackCore.withRetry — リトライ対象外', () => {
  it.each([400, 401, 403, 404, 422])('status=%i はリトライしない', async (status) => {
    const transport = makeHttpErrorTransport(status);
    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });

    await expect(retrying.fetch('https://slack.com/api/test')).rejects.toThrow(HttpError);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it('RetryExhaustedError は再スローして二重ラップしない', async () => {
    const transport = makeTransport(() =>
      Promise.reject(new RetryExhaustedError('already exhausted')),
    );
    const retrying = SlackCore.withRetry(transport, { maxRetries: 3 });

    await expect(retrying.fetch('https://slack.com/api/test')).rejects.toThrow('already exhausted');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// SlackCore.withRetry — ロギング
// ============================================================================

describe('SlackCore.withRetry — ロギング', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('429 リトライ時に warn を出力する', async () => {
    const warn = vi.fn();
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls < 2) throw new HttpError('429', 429, null, { 'Retry-After': '1' });
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, {
      maxRetries: 3,
      logger: { warn, error: vi.fn() },
    });
    const promise = retrying.fetch('https://slack.com/api/test', { method: 'POST' });
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('[Slack]');
    expect(warn.mock.calls[0][0]).toContain('RETRY');
    expect(warn.mock.calls[0][0]).toContain('429');
    expect(warn.mock.calls[0][0]).toContain('Retry-After=1s');
  });

  it('5xx リトライ時に warn を出力する', async () => {
    const warn = vi.fn();
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls < 2) throw new HttpError('503', 503, null);
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, {
      maxRetries: 3,
      baseDelayMs: 10,
      logger: { warn, error: vi.fn() },
    });
    const promise = retrying.fetch('https://slack.com/api/test', { method: 'POST' });
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('status=503');
  });

  it('リトライ上限時に error を出力する', async () => {
    const errorLog = vi.fn();
    const transport = makeHttpErrorTransport(503);
    const retrying = SlackCore.withRetry(transport, {
      maxRetries: 1,
      baseDelayMs: 10,
      logger: { warn: vi.fn(), error: errorLog },
    });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls[0][0]).toContain('exhausted');
  });

  it('method 未指定の場合 GET がログに出る', async () => {
    const warn = vi.fn();
    let calls = 0;
    const transport = makeTransport(async () => {
      calls++;
      if (calls < 2) throw new HttpError('503', 503, null);
      return makeRawResponse();
    });

    const retrying = SlackCore.withRetry(transport, {
      maxRetries: 2,
      baseDelayMs: 10,
      logger: { warn, error: vi.fn() },
    });
    const promise = retrying.fetch('https://slack.com/api/test');
    const assertion = expect(promise).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(warn.mock.calls[0][0]).toContain('GET');
  });
});

// ============================================================================
// SlackApiClient.create — バリデーション
// ============================================================================

describe('SlackApiClient.create — バリデーション', () => {
  it('token が空文字の場合 TypeError をスローする', () => {
    expect(() => SlackApiClient.create('')).toThrow(TypeError);
  });

  it.each([[null], [undefined], [123], [true]])(
    'token=%s（非string）の場合 TypeError をスローする',
    (token) => {
      expect(() => SlackApiClient.create(token as unknown as string)).toThrow(TypeError);
    },
  );
});

describe('SlackWebhookClient.create — バリデーション', () => {
  it('webhookUrl が空文字の場合 TypeError をスローする', () => {
    expect(() => SlackWebhookClient.create('')).toThrow(TypeError);
  });

  it.each([[null], [undefined], [123], [true]])(
    'webhookUrl=%s（非string）の場合 TypeError をスローする',
    (webhook) => {
      expect(() => SlackWebhookClient.create(webhook as unknown as string)).toThrow(TypeError);
    },
  );
});

describe('SlackApiClient.create — バリデーション不要（token は string のみ）', () => {
  it('create でクライアントが返る（インターフェース確認）', () => {
    const transport = makeSuccessTransport();
    const client = SlackApiClient.create('xoxb-token', { transport });
    expect(typeof client.call).toBe('function');
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
  });
});

// ============================================================================
// SlackApiClient.create — 正常系
// ============================================================================

describe('SlackApiClient.create — 正常系', () => {
  it('POST /chat.postMessage で ok:true のボディを返す', async () => {
    const responseBody = { ok: true, ts: '123.456', channel: 'C123' };
    const transport = makeSuccessTransport(responseBody);
    const client = SlackApiClient.create('xoxb-token', { transport });

    const result = await client.post('/chat.postMessage', { channel: 'C123', text: 'hi' });
    expect((result as typeof responseBody).ok).toBe(true);
    expect((result as typeof responseBody).ts).toBe('123.456');
  });

  it('Authorization: Bearer ヘッダーが付いている', async () => {
    const innerTransport = makeSuccessTransport();
    const client = SlackApiClient.create('xoxb-my-token', { transport: innerTransport });
    await client.post('/chat.postMessage', {});

    const call = (innerTransport.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]?.headers?.['Authorization']).toBe('Bearer xoxb-my-token');
  });

  it('baseUrl が https://slack.com/api になる', async () => {
    const transport = makeSuccessTransport();
    const client = SlackApiClient.create('token', { transport });
    await client.post('/chat.postMessage', {});

    expect(transport.calls[0].url).toContain('https://slack.com/api');
    expect(transport.calls[0].url).toContain('chat.postMessage');
  });
});

// ============================================================================
// SlackApiClient.create — ok:false → SlackApiError
// ============================================================================

describe('SlackApiClient.create — ok:false', () => {
  it.each([
    'channel_not_found',
    'not_in_channel',
    'invalid_auth',
    'token_revoked',
    'missing_scope',
  ])('error="%s" → SlackApiError をスローする', async (errorCode) => {
    const transport = makeSuccessTransport({ ok: false, error: errorCode });
    const client = SlackApiClient.create('xoxb-token', { transport });

    await expect(client.post('/chat.postMessage', {})).rejects.toThrow(SlackApiError);
    await expect(client.post('/chat.postMessage', {})).rejects.toThrow(errorCode);
  });

  it('ok:false で error フィールドがない → "slack_error"', async () => {
    const transport = makeSuccessTransport({ ok: false });
    const client = SlackApiClient.create('xoxb-token', { transport });

    let err: SlackApiError | undefined;
    try {
      await client.post('/chat.postMessage', {});
    } catch (e) {
      err = e as SlackApiError;
    }

    expect(err).toBeInstanceOf(SlackApiError);
    expect(err?.code).toBe('slack_error');
  });

  it('response_metadata が SlackApiError に伝播する', async () => {
    const transport = makeSuccessTransport({
      ok: false,
      error: 'invalid_arguments',
      response_metadata: { messages: ['[ERROR] invalid channel'] },
    });
    const client = SlackApiClient.create('xoxb-token', { transport });

    let err: SlackApiError | undefined;
    try {
      await client.post('/chat.postMessage', {});
    } catch (e) {
      err = e as SlackApiError;
    }

    expect(err?.metadata).toEqual({ messages: ['[ERROR] invalid channel'] });
  });
});

// ============================================================================
// SlackApiClient — use() でドメインメソッド追加
// ============================================================================

describe('SlackApiClient — use()', () => {
  it('postMessage メソッドを use() で追加できる', async () => {
    const transport = makeSuccessTransport({ ok: true, ts: '999.000' });
    const client = SlackApiClient.create('token', { transport })
      .use('postMessage', c => (channel: string, text: string) =>
        c.post('/chat.postMessage', { channel, text }),
      );

    const result = await client.postMessage('#general', 'Hello!');
    expect((result as { ok: boolean }).ok).toBe(true);
    expect(transport.calls[0].url).toContain('chat.postMessage');
  });
});

// ============================================================================
// SlackWebhookClient.create — インターフェース
// ============================================================================

describe('SlackWebhookClient.create — インターフェース', () => {
  it('send メソッドが返る', () => {
    const client = SlackWebhookClient.create('https://hooks.slack.com/xxx');
    expect(typeof client.send).toBe('function');
  });

  it('maxRetries: 0 でリトライなしクライアント作成', () => {
    const client = SlackWebhookClient.create('https://hooks.slack.com/xxx', { maxRetries: 0 });
    expect(typeof client.send).toBe('function');
  });
});

// ============================================================================
// SlackWebhookClient.send — 正常系
// ============================================================================

describe('SlackWebhookClient.send — 正常系', () => {
  it('POST + JSON ペイロードで Webhook URL に送信する', async () => {
    const transport = makeSuccessTransport('ok');
    const client = SlackWebhookClient.create('https://hooks.slack.com/T/B/xxx', { transport });

    await client.send({ text: 'Hello Webhook!' });

    expect(transport.calls[0].url).toBe('https://hooks.slack.com/T/B/xxx');
    expect(transport.calls[0].options?.method).toBe('POST');
    expect(transport.calls[0].options?.headers?.['Content-Type']).toContain('application/json');
    expect(transport.calls[0].options?.payload).toBe(JSON.stringify({ text: 'Hello Webhook!' }));
  });

  it('blocks フィールドを含む Block Kit ペイロードを送信できる', async () => {
    const transport = makeSuccessTransport('ok');
    const client = SlackWebhookClient.create('https://hooks.slack.com/xxx', { transport });
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Hello*' } }];

    await client.send({ blocks });

    const sentPayload = JSON.parse(transport.calls[0].options?.payload as string);
    expect(sentPayload.blocks).toEqual(blocks);
  });
});

// ============================================================================
// SlackWebhookClient.send — 静的メソッド
// ============================================================================

describe('SlackWebhookClient.send — 静的メソッド', () => {
  it('静的 send がクライアント作成と同じ動作をする', async () => {
    const transport = makeSuccessTransport('ok');
    await SlackWebhookClient.send(
      'https://hooks.slack.com/xxx',
      { text: 'static send' },
      { transport },
    );

    expect(transport.calls[0].options?.payload).toBe(JSON.stringify({ text: 'static send' }));
  });
});
