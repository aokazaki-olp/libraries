/**
 * GBizInfoApiClient.ts
 *
 * @description 経済産業省 gBizINFO API のプロトコル層クライアント。
 *              認証(X-hojinInfo-api-token ヘッダ)・リトライ・ロギング・baseUrl 構築のみを提供する。
 *              法人情報取得・補助金検索などのドメインメソッドは呼び出し側で .use() する。
 *
 * 使用例:
 *   const client = GBizInfoApiClient.create(token, { logger: console });        // v2 (デフォルト)
 *   const client = GBizInfoApiClient.create(token, { version: 'v1' });          // v1 を明示
 *   const response = await client.get('/hojin/1234567890123');
 */

import { ApiClient } from './ApiClient.ts';
import { HttpCore } from './HttpCore.ts';
import type { BaseClient } from './ApiClient.ts';
import type { Logger } from './LoggerFacade.ts';
import type { Transport } from './httpTypes.ts';

type GBizInfoApiVersion = 'v1' | 'v2';

const BASE_URL = 'https://api.info.gbiz.go.jp/hojin';
const AUTH_HEADER = 'X-hojinInfo-api-token';
const DEFAULT_VERSION: GBizInfoApiVersion = 'v2';
const SUPPORTED_VERSIONS: readonly GBizInfoApiVersion[] = ['v1', 'v2'];
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

interface GBizInfoClientOptions {
  version?: GBizInfoApiVersion;
  maxRetries?: number;
  /** 5xx・通信エラーで再送するメソッド（既定は冪等なメソッドだけ。429 はメソッドを問わず再送） */
  retryMethods?: readonly string[];
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * gBizINFO API クライアントを作成する
 *
 * @param token - gBizINFO API トークン
 * @param options - オプション設定 (version 既定値は 'v2')
 * @returns クライアント (call/get/post/put/patch/delete/use/extend)。レスポンスは検証前の unknown。
 *   型を付けるときは呼び出し側で decode する（CODING_RULES.md §2.7）
 * @throws {TypeError} token が空文字または string 以外の場合、version が未対応の場合、
 *   maxRetries / baseDelayMs / retryMethods が不正な場合、
 *   logger が Logger として使えない場合
 */
const create = (token: string, options: GBizInfoClientOptions = {}): BaseClient => {
  if (typeof token !== 'string' || token === '') {
    throw new TypeError('token には gBizINFO API token (string) を指定してください');
  }

  const {
    version = DEFAULT_VERSION,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryMethods,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  // TS 型は as any 等でバイパスされるため、ランタイムでも未対応バージョンを弾く
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new TypeError(`version には ${SUPPORTED_VERSIONS.join(' / ')} を指定してください`);
  }

  // 認証は静的なカスタムヘッダ。Bearer ではないので withBearerAuth は使わない。
  // デコレータ適用順 (内側 → 外側): createClient(headers で token 付与) → Retry → Logger
  // - Logger は url/method/status のみを観測し headers を観測しない前提のため token は流出しない
  // - Retry は HttpError を捕捉して再送できる
  return ApiClient.createClient({
    baseUrl: `${BASE_URL}/${version}`,
    transport: injectedTransport ?? HttpCore.createTransport(),
    headers: {
      Accept: 'application/json',
      [AUTH_HEADER]: token,
    },
    responseHandler: (response) => response.body,
  })
    .extend((t) => HttpCore.withRetry(t, { maxRetries, baseDelayMs, retryMethods, logger }))
    .extend((t) => HttpCore.withLogger(t, logger));
};

export const GBizInfoApiClient = { create };
export type { GBizInfoClientOptions, GBizInfoApiVersion };
