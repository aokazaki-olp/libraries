/**
 * GBizInfoApiClient.ts
 * @description 経済産業省 gBizINFO API のプロトコル層クライアント。
 *              認証(X-hojinInfo-api-token ヘッダ)・リトライ・ロギング・baseUrl 構築のみを提供する。
 *              法人情報取得・補助金検索などのドメインメソッドは呼び出し側で .use() する。
 *
 * 使用例:
 *   const client = GBizInfoApiClient.create(token, { logger: console });        // v2 (デフォルト)
 *   const client = GBizInfoApiClient.create(token, { version: 'v1' });          // v1 を明示
 *   const res = await client.get('/hojin/1234567890123');
 */

import { ApiClient } from './ApiClient.js';
import { HttpCore } from './HttpCore.js';
import type { BaseClient } from './ApiClient.js';
import type { Logger } from './LoggerFacade.js';
import type { Transport } from './httpTypes.js';

const BASE_URL = 'https://api.info.gbiz.go.jp/hojin';
const AUTH_HEADER = 'X-hojinInfo-api-token';
const DEFAULT_VERSION: GBizInfoApiVersion = 'v2';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

type GBizInfoApiVersion = 'v1' | 'v2';

interface GBizInfoClientOptions {
  version?: GBizInfoApiVersion;
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * gBizINFO API クライアントを作成する
 *
 * @param token - gBizINFO API トークン
 * @param options - オプション設定 (version 既定値は 'v2')
 * @returns クライアント (call/get/post/put/patch/delete/use/extend)
 * @throws {TypeError} token が空文字または string 以外の場合
 */
const create = <TResponse = unknown>(
  token: string,
  options: GBizInfoClientOptions = {},
): BaseClient<TResponse> => {
  if (typeof token !== 'string' || token === '') {
    throw new TypeError('token には gBizINFO API token (string) を指定してください');
  }

  const {
    version = DEFAULT_VERSION,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  return ApiClient.createClient<TResponse>({
    baseUrl: `${BASE_URL}/${version}`,
    transport: injectedTransport ?? HttpCore.createTransport(),
    headers: {
      Accept: 'application/json',
      [AUTH_HEADER]: token,
    },
    logger,
    responseHandler: (response) => response.body as TResponse,
  })
    .extend(t => HttpCore.withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend(t => HttpCore.withLogger(t, logger));
};

export const GBizInfoApiClient = { create };
export type { GBizInfoClientOptions, GBizInfoApiVersion };
