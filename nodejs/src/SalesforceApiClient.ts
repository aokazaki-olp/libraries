/**
 * SalesforceApiClient.ts
 * @description Salesforce REST API のプロトコル層クライアント。
 *              認証(Bearer)・リトライ・ロギング・baseUrl 構築のみを提供する。
 *              SOQL クエリや sObject CRUD は呼び出し側で .use() する。
 *
 * 使用例:
 *   const sf = SalesforceApiClient.create(instanceUrl, accessToken, { logger: console });
 *   const result = await sf.get('/query', { q: 'SELECT Id, Name FROM Account LIMIT 10' });
 *
 *   // .use() でドメインメソッドを追加
 *   const client = sf.use('queryAll', c => (soql: string) => c.get('/query', { q: soql }));
 *   await client.queryAll('SELECT Id FROM Account');
 */

import { ApiClient } from './ApiClient.js';
import { HttpCore } from './HttpCore.js';
import type { BaseClient } from './ApiClient.js';
import type { Logger } from './LoggerFacade.js';
import type { Transport } from './httpTypes.js';

const DEFAULT_API_VERSION = 'v60.0';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const API_VERSION_PATTERN = /^v\d+\.\d+$/;

interface SalesforceClientOptions {
  apiVersion?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * Salesforce API クライアントを作成する
 *
 * @param instanceUrl - 組織固有の My Domain URL (例: https://yourorg.my.salesforce.com)
 * @param accessToken - OAuth access_token
 * @param options - オプション設定
 * @returns クライアント (call/get/post/put/patch/delete/use/extend)
 * @throws {TypeError} instanceUrl / accessToken が空文字の場合、apiVersion の形式が不正な場合
 */
const create = <TResponse = unknown>(
  instanceUrl: string,
  accessToken: string,
  options: SalesforceClientOptions = {},
): BaseClient<TResponse> => {
  if (typeof instanceUrl !== 'string' || instanceUrl === '') {
    throw new TypeError('instanceUrl には Salesforce instance URL (string) を指定してください');
  }
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new TypeError('accessToken には Salesforce OAuth access token (string) を指定してください');
  }

  const {
    apiVersion = DEFAULT_API_VERSION,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  if (!API_VERSION_PATTERN.test(apiVersion)) {
    throw new TypeError(
      `apiVersion には 'v60.0' のような /v\\d+\\.\\d+/ 形式を指定してください (received: ${apiVersion})`,
    );
  }

  const baseUrl = `${instanceUrl.replace(/\/+$/, '')}/services/data/${apiVersion}`;

  // デコレータ適用順 (内側 → 外側): Bearer → Retry → Logger
  // - Logger は最外で Retry が最終的に返した1回分を観測する
  // - Logger 通過時点では Authorization ヘッダがまだ付いていない（意図的）
  // - Retry は認証付きリクエストを再送できる
  return ApiClient.createClient<TResponse>({
    baseUrl,
    transport: injectedTransport ?? HttpCore.createTransport(),
    headers: { Accept: 'application/json' },
    logger,
    // レスポンスボディを TResponse として扱う（SF REST API の型保証は呼び出し側の責務）
    responseHandler: (response) => response.body as TResponse,
  })
    .extend(t => ApiClient.withBearerAuth(t, accessToken))
    .extend(t => HttpCore.withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend(t => HttpCore.withLogger(t, logger));
};

export const SalesforceApiClient = { create };
export type { SalesforceClientOptions };
