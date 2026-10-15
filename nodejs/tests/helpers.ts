/**
 * helpers.ts
 *
 * @description テスト用のモック（ロガー・Transport・レスポンス）
 */

import { vi, type Mock } from 'vitest';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.ts';
import type { Logger } from '../src/LoggerFacade.ts';

type MockLogger = { [K in keyof Logger]: Mock<(...args: unknown[]) => void> } & {
  calls: Record<keyof Logger, unknown[][]>;
};

/** 文字列の payload を取り出す（JSON 化して送った body を検査するため） */
export const payloadText = (options?: FetchOptions): string =>
  typeof options?.payload === 'string' ? options.payload : '';

export const createMockLogger = (): MockLogger => {
  const calls: Record<keyof Logger, unknown[][]> = {
    trace: [],
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  const make = (key: keyof Logger) =>
    vi.fn((...args: unknown[]) => {
      calls[key].push(args);
    });
  return {
    trace: make('trace'),
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    calls,
  };
};

export const makeRawResponse = (overrides: Partial<RawResponse> = {}): RawResponse => ({
  status: 200,
  headers: {},
  body: null,
  text: '',
  ...overrides,
});

type FetchFunction = (url: string, options?: FetchOptions) => Promise<RawResponse>;

/** fetch をメソッドではなく Mock のプロパティとして持つ（expect(transport.fetch) で this を失わない） */
type MockTransport = Omit<Transport, 'fetch'> & {
  fetch: Mock<FetchFunction>;
  calls: { url: string; options?: FetchOptions }[];
};

export const makeTransport = (implementation: FetchFunction): MockTransport => {
  const fetchFunction = vi.fn(async (url: string, options?: FetchOptions) =>
    implementation(url, options),
  );
  return {
    get calls() {
      return fetchFunction.mock.calls.map(([url, options]) => ({ url, options }));
    },
    fetch: fetchFunction,
  };
};

export const mockTransport = (response?: Partial<RawResponse>): MockTransport =>
  makeTransport(() => Promise.resolve(makeRawResponse(response)));
