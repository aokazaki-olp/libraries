import { vi, type Mock } from 'vitest';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.ts';
import type { Logger } from '../src/LoggerFacade.ts';

export const createMockLogger = () => {
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

type FetchFn = (url: string, options?: FetchOptions) => Promise<RawResponse>;

/** fetch をメソッドではなく Mock のプロパティとして持つ（expect(transport.fetch) で this を失わない） */
type MockTransport = Omit<Transport, 'fetch'> & {
  fetch: Mock<FetchFn>;
  calls: { url: string; options?: FetchOptions }[];
};

export const makeTransport = (impl: FetchFn): MockTransport => {
  const fetchFn = vi.fn(async (url: string, options?: FetchOptions) => impl(url, options));
  return {
    get calls() {
      return fetchFn.mock.calls.map(([url, options]) => ({ url, options }));
    },
    fetch: fetchFn,
  };
};

export const mockTransport = (response?: Partial<RawResponse>): MockTransport =>
  makeTransport(() => Promise.resolve(makeRawResponse(response)));
