import { vi } from 'vitest';
import type { FetchOptions, RawResponse, Transport } from '../src/httpTypes.js';
import type { Logger } from '../src/LoggerFacade.js';

const makeLogMock = (key: keyof Logger, calls: Record<keyof Logger, unknown[][]>) =>
  vi.fn((...args: unknown[]) => { calls[key].push(args); });

export const createMockLogger = () => {
  const calls: Record<keyof Logger, unknown[][]> = {
    trace: [], debug: [], info: [], warn: [], error: [],
  };
  return {
    trace: makeLogMock('trace', calls),
    debug: makeLogMock('debug', calls),
    info:  makeLogMock('info',  calls),
    warn:  makeLogMock('warn',  calls),
    error: makeLogMock('error', calls),
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
