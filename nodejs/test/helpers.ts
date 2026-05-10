import { vi } from 'vitest';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.js';
import type { Logger } from '../src/LoggerFacade.js';

export const createMockLogger = () => {
  const calls: Record<keyof Logger, unknown[][]> = {
    trace: [], debug: [], info: [], warn: [], error: [],
  };
  const make = (key: keyof Logger) =>
    vi.fn((...args: unknown[]) => { calls[key].push(args); });
  return {
    trace: make('trace'),
    debug: make('debug'),
    info:  make('info'),
    warn:  make('warn'),
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

export const makeTransport = (
  impl: (url: string, options?: FetchOptions) => Promise<RawResponse>,
): Transport & { calls: { url: string; options?: FetchOptions }[] } => {
  const fetchFn = vi.fn(async (url: string, options?: FetchOptions) => impl(url, options));
  return {
    get calls() {
      return fetchFn.mock.calls.map(([url, options]) => ({ url, options }));
    },
    fetch: fetchFn,
  };
};

export const mockTransport = (
  response?: Partial<RawResponse>,
): Transport & { calls: { url: string; options?: FetchOptions }[] } =>
  makeTransport(() => Promise.resolve(makeRawResponse(response)));
