/**
 * InvoiceApiClient.ts
 * @description 国税庁 適格請求書発行事業者公表システム Web-API (通称: インボイス Web-API) の
 *              プロトコル層クライアント。認証(クエリパラメータ id)・必須共通クエリ(type/version)・
 *              リトライ・ロギング・baseUrl 構築のみを提供する。
 *              登録番号検索・差分取得・名称検索などのドメインメソッドは呼び出し側で .use() する。
 *
 * 注意:
 *   - 利用規約により「当該情報は、国税庁適格請求書発行事業者公表システム Web-API 機能による
 *     情報を加工して作成しています」等のクレジット表記が必要。表示は最終利用者の責務。
 *   - 認証 id はクエリパラメータで送信されるため、ログ出力時に URL ごと出るとログに残る可能性がある。
 *
 * 使用例:
 *   const client = InvoiceApiClient.create(appId, { logger: console });
 *   const res = await client.get('/num', { number: 'T1234567890123', history: 0 });
 */

import { ApiClient } from './ApiClient.js';
import { HttpCore } from './HttpCore.js';
import type { BaseClient } from './ApiClient.js';
import type { Logger } from './LoggerFacade.js';
import type { Transport } from './httpTypes.js';

type InvoiceApiVersion = '1';
type InvoiceResponseType = '01' | '21' | '31'; // 01=CSV, 21=JSON, 31=XML

const BASE_URL = 'https://web-api.invoice-kohyo.nta.go.jp';
const API_PATH_VERSION = '1';
const DEFAULT_VERSION: InvoiceApiVersion = '1';
const SUPPORTED_VERSIONS: readonly InvoiceApiVersion[] = ['1'];
const DEFAULT_TYPE: InvoiceResponseType = '21'; // JSON
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

interface InvoiceClientOptions {
  /** データバージョン (現状 '1' のみ)。 */
  version?: InvoiceApiVersion;
  /** レスポンス形式コード (01=CSV / 21=JSON / 31=XML)。既定: 21 (JSON)。 */
  type?: InvoiceResponseType;
  maxRetries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  transport?: Transport;
}

/**
 * インボイス Web-API クライアントを作成する
 *
 * @param applicationId - 国税庁から発行されたアプリケーション ID
 * @param options - オプション設定
 * @returns クライアント (call/get/post/put/patch/delete/use/extend)
 * @throws {TypeError} applicationId が空文字または string 以外の場合、version が未対応の場合
 */
const create = <TResponse = unknown>(
  applicationId: string,
  options: InvoiceClientOptions = {},
): BaseClient<TResponse> => {
  if (typeof applicationId !== 'string' || applicationId === '') {
    throw new TypeError('applicationId にはインボイス Web-API のアプリケーション ID (string) を指定してください');
  }

  const {
    version = DEFAULT_VERSION,
    type = DEFAULT_TYPE,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    logger,
    transport: injectedTransport,
  } = options;

  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new TypeError(`version には ${SUPPORTED_VERSIONS.join(' / ')} を指定してください`);
  }

  // 認証はクエリパラメータ (id) + 必須共通クエリ (type, version)。
  // デコレータ適用順 (内側 → 外側): createClient → Retry → Logger → QueryAuth
  // fetch 呼び出しは外側から内側へ伝播するため、QueryAuth が最外層に居ても
  // 内側の Logger は id を付与済みの URL を観測する。
  // 現状の HttpCore.withLogger は `${method} ${url}` 形式で URL をログ出力するため、
  // 認証 id はログに残る前提。マスクが必要になったら withLogger 側か
  // createClient の auth スロット化で構造的に解決する。
  return ApiClient.createClient<TResponse>({
    baseUrl: `${BASE_URL}/${API_PATH_VERSION}`,
    transport: injectedTransport ?? HttpCore.createTransport(),
    headers: {
      Accept: 'application/json',
    },
    logger,
    responseHandler: (response) => response.body as TResponse,
  })
    .extend(t => HttpCore.withRetry(t, { maxRetries, baseDelayMs, logger }))
    .extend(t => HttpCore.withLogger(t, logger))
    .extend(t => ApiClient.withQueryAuth(t, {
      id: applicationId,
      type,
      version,
    }));
};

export const InvoiceApiClient = { create };
export type { InvoiceClientOptions, InvoiceApiVersion, InvoiceResponseType };
