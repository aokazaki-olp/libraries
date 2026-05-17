/**
 * GBizInfoApiClient.ts
 * @description 経済産業省 gBizINFO API のプロトコル層クライアント。
 *              認証(X-hojinInfo-api-token ヘッダ)・リトライ・ロギング・baseUrl 構築のみを提供する。
 *              法人情報取得・補助金検索などのドメインメソッドは呼び出し側で .use() する。
 *
 * 使用例:
 *   const client = GBizInfoApiClient.create(token, { logger: console });
 *   const res = await client.get('/hojin/1234567890123');
 */

import { ApiClient } from './ApiClient.js';
import { HttpCore } from './HttpCore.js';
import type { BaseClient } from './ApiClient.js';
import type { Logger } from './LoggerFacade.js';
import type { Transport } from './httpTypes.js';

const BASE_URL = 'https://info.gbiz.go.jp/hojin/v1';
const AUTH_HEADER = 'X-hojinInfo-api-token';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

interface GBizInfoClientOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * gBizINFO API クライアントを作成する
 *
 * @param token - gBizINFO API トークン
 * @param options - オプション設定
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
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  // 認証は静的なカスタムヘッダ。Bearer ではないので withBearerAuth は使わない。
  // デコレータ適用順 (内側 → 外側): createClient(headers で token 付与) → Retry → Logger
  // - Logger は url/method/status のみを観測し headers を観測しない前提のため token は流出しない
  // - Retry は HttpError を捕捉して再送できる
  return ApiClient.createClient<TResponse>({
    baseUrl: BASE_URL,
    transport: injectedTransport ?? HttpCore.createTransport(),
    headers: {
      Accept: 'application/json',
      [AUTH_HEADER]: token,
    },
    logger,
    // レスポンスボディを TResponse として扱う (gBizINFO レスポンスの型保証は呼び出し側の責務)
    responseHandler: (response) => response.body as TResponse,
  })
    .extend(t => HttpCore.withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend(t => HttpCore.withLogger(t, logger));
};

export const GBizInfoApiClient = { create };
export type { GBizInfoClientOptions };
