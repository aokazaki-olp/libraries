import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/ApiClient.ts';
import { HttpCore } from '../src/HttpCore.ts';
import { SalesforceAuth } from '../src/SalesforceAuth.ts';
import { SalesforceApiClient } from '../src/SalesforceApiClient.ts';
import { SlackCore, SlackWebhookClient } from '../src/SlackClient.ts';
import { HttpError } from '../src/httpTypes.ts';
import { SalesforceApiClientPlugins } from '../src/plugins/salesforce.ts';
import { sleep } from '../src/shared/sleep.ts';
import { makeRawResponse, makeTransport } from './helpers.ts';

// ============================================================================
// sleep
// ============================================================================

describe('sleep', () => {
  it('signal なしなら指定時間後に resolve する', async () => {
    vi.useFakeTimers();
    try {
      const promise = sleep(100);
      await vi.advanceTimersByTimeAsync(100);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('中断済みの signal なら即座に reject する', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(10_000, controller.signal)).rejects.toThrow(/abort/i);
  });

  it('待機中に中断されると、その理由で reject する', async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort(new Error('stop'));
    await expect(promise).rejects.toThrow('stop');
  });
});

// ============================================================================
// signal の伝播
// ============================================================================

describe('signal の伝播', () => {
  it('ApiClient は RequestOptions.signal を Transport に渡す', async () => {
    const transport = makeTransport(() => Promise.resolve(makeRawResponse()));
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });
    const controller = new AbortController();

    await client.get('/items', undefined, { signal: controller.signal });

    expect(transport.calls[0]?.options?.signal).toBe(controller.signal);
  });

  it('createTransport は signal を got に渡す', async () => {
    const mockGotFn = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
    const transport = HttpCore.createTransport({ got: mockGotFn as unknown as import('got').Got });
    const controller = new AbortController();

    await transport.fetch('https://example.com', { signal: controller.signal });

    const calledOptions = mockGotFn.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(calledOptions.signal).toBe(controller.signal);
  });

  it('SlackWebhookClient.send は signal を Transport に渡す', async () => {
    const transport = makeTransport(() => Promise.resolve(makeRawResponse()));
    const webhook = SlackWebhookClient.create('https://hooks.slack.com/T/B/x', { transport });
    const controller = new AbortController();

    await webhook.send({ text: 'hi' }, { signal: controller.signal });

    expect(transport.calls[0]?.options?.signal).toBe(controller.signal);
  });

  it('SalesforceAuth.getAccessTokenByJwt は signal を Transport に渡す', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(
        makeRawResponse({
          body: { access_token: 't', instance_url: 'https://x.my.salesforce.com' },
        }),
      ),
    );
    const signer = {
      computeRsaSha256Signature: (): Buffer => Buffer.from('sig'),
      base64EncodeWebSafe: (bytes: Buffer): string => bytes.toString('base64url'),
      newBlob: (str: string): Buffer => Buffer.from(str, 'utf-8'),
    };
    const controller = new AbortController();

    await SalesforceAuth.getAccessTokenByJwt(
      {
        consumerKey: 'k',
        username: 'u',
        privateKey: 'p',
        tokenHost: 'https://x.my.salesforce.com',
        signal: controller.signal,
      },
      { transport, signer },
    );

    expect(transport.calls[0]?.options?.signal).toBe(controller.signal);
  });
});

// ============================================================================
// 中断されたらリトライしない
// ============================================================================

describe('中断されたらリトライしない', () => {
  it('HttpCore.withRetry: 中断済みなら再送せずに元の例外を投げる', async () => {
    const controller = new AbortController();
    const transport = makeTransport(() => {
      controller.abort();
      return Promise.reject(new Error('aborted by caller'));
    });
    const retrying = HttpCore.withRetry(transport, { maxRetries: 3, baseDelayMs: 1 });

    await expect(
      retrying.fetch('https://example.com', { signal: controller.signal }),
    ).rejects.toThrow('aborted by caller');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it('HttpCore.withRetry: バックオフ待機に入るところで中断されたら待機せずに reject する', async () => {
    const controller = new AbortController();
    const transport = makeTransport(() =>
      Promise.reject(new HttpError('HTTPエラー 503', 503, null)),
    );
    // withRetry は待機の直前に warn を出す。それを合図に中断する
    const logger = {
      trace: (): void => {},
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {
        controller.abort(new Error('stop waiting'));
      },
      error: (): void => {},
    };
    const retrying = HttpCore.withRetry(transport, { maxRetries: 3, baseDelayMs: 60_000, logger });

    await expect(
      retrying.fetch('https://example.com', { signal: controller.signal }),
    ).rejects.toThrow('stop waiting');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it('SlackCore.withRetry: 中断済みなら再送しない', async () => {
    const controller = new AbortController();
    const transport = makeTransport(() => {
      controller.abort();
      return Promise.reject(new HttpError('503', 503, null));
    });
    const retrying = SlackCore.withRetry(transport, { maxRetries: 3, baseDelayMs: 1 });

    await expect(
      retrying.fetch('https://slack.com/api/test', { signal: controller.signal }),
    ).rejects.toThrow(HttpError);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it('bulkIngest.waitForCompletion: ポーリング待機中に中断されたら reject し、以後ポーリングしない', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: { id: 'job001', state: 'InProgress' } })),
    );
    const sf = SalesforceApiClient.create('https://x.my.salesforce.com', 't', { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);
    const controller = new AbortController();

    const promise = bulk.waitForCompletion('job001', {
      intervalMs: 60_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(transport.fetch).toHaveBeenCalledTimes(1);
    });
    controller.abort(new Error('stop polling'));

    await expect(promise).rejects.toThrow('stop polling');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(transport.calls[0]?.options?.signal).toBe(controller.signal);
  });
});

// ============================================================================
// got との結合（localhost の遅いサーバー）
// ============================================================================

describe('got との結合: 中断で即座に止まる', () => {
  let server: http.Server;
  let url: string;
  let requests = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      requests++;
      setTimeout(() => {
        res.end('late');
      }, 5_000);
    });
    await new Promise<undefined>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(undefined);
      });
    });
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${String(port)}/`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<undefined>((resolve) => {
      server.close(() => {
        resolve(undefined);
      });
    });
  });

  it('createTransport + withRetry: 中断されたらリトライせずに reject する', async () => {
    const transport = HttpCore.withRetry(HttpCore.createTransport(), {
      maxRetries: 3,
      baseDelayMs: 1,
    });
    const before = requests;
    const started = Date.now();

    await expect(transport.fetch(url, { signal: AbortSignal.timeout(100) })).rejects.toThrow(
      /aborted/,
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(requests - before).toBe(1);
  });
});
