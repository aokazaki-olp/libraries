import { vi } from 'vitest';
import type { FetchOptions, RawResponse, Transport } from '../src/types.js';

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
  const calls: { url: string; options?: FetchOptions }[] = [];
  return {
    calls,
    fetch: vi.fn(async (url, options) => {
      calls.push({ url, options });
      return impl(url, options);
    }),
  };
};

export const mockTransport = (
  response?: Partial<RawResponse>,
): Transport & { calls: { url: string; options?: FetchOptions }[] } =>
  makeTransport(() => Promise.resolve(makeRawResponse(response)));
