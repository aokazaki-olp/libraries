/**
 * plugins/salesforce.ts
 * @description Salesforce REST API / Bulk API v2 用プラグインセット
 *
 * 使用例（REST API）:
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.soql<Account>());
 *   const result = await sf.query('SELECT Id, Name FROM Account LIMIT 10');
 *
 * 使用例（Bulk API v2 Ingest）:
 *   const bulk = SalesforceApiClientPlugins.bulkIngest(sfClient);
 *   const job  = await bulk.createJob({ operation: 'insert', object: 'Account' });
 *   await bulk.upload(job.id, csvString);
 *   await bulk.close(job.id);
 *   const done = await bulk.waitForCompletion(job.id);
 *   const ok   = await bulk.getSuccessfulResults(job.id); // CSV文字列
 *
 * 使用例（Bulk API v2 Query）:
 *   const query = SalesforceApiClientPlugins.bulkQuery(sfClient);
 *   const job   = await query.createJob({ operation: 'query', query: 'SELECT Id FROM Account' });
 *   const done  = await query.waitForCompletion(job.id);
 *   const page  = await query.getResults(job.id);
 *   const full  = await query.getResultsParallel(job.id); // 全ページ結合
 *
 * ⚠️ GAS実行時間制限について
 * waitForCompletion() はポーリングにより完了を待機する。GAS の実行時間上限
 * （標準: 6分 / GWS: 30分）内に処理が完了しない場合タイムアウトエラーが発生する。
 * 大量レコード（目安: 標準GAS=1万件超、GWS=20万件超）を扱う場合は、
 * PropertiesService と時間ベーストリガーを組み合わせた分割実行を検討すること。
 *
 * ⚠️ Abort について
 * abortJob() でジョブを中断しても、処理済みレコードはロールバックされない。
 * Bulk API v2 は逐次コミットであり、中断前に処理されたレコードは
 * すでに Salesforce に反映されている。
 *
 * ⚠️ Events について
 * Bulk API v2 Events（ジョブ状態変化イベント購読）は現バージョンでは未対応。
 * ポーリングによる状態監視（waitForCompletion）を使用すること。
 */

import type { BaseClient, Plugin } from '../ApiClient.js';
import type { FetchOptions } from '../httpTypes.js';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// ============================================================================
// 共通型定義（REST API）
// ============================================================================

export interface SoqlResult<TRow = unknown> {
  records: TRow[];
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
}

// ============================================================================
// Bulk API v2 型定義
// ============================================================================

export type IngestOperation = 'insert' | 'update' | 'upsert' | 'delete' | 'hardDelete';
export type IngestState = 'Open' | 'UploadComplete' | 'InProgress' | 'JobComplete' | 'Failed' | 'Aborted';
export type QueryOperation = 'query' | 'queryAll';
export type QueryState = 'UploadComplete' | 'InProgress' | 'JobComplete' | 'Failed' | 'Aborted';
export type ColumnDelimiter = 'COMMA' | 'TAB' | 'SEMICOLON' | 'PIPE' | 'CARET' | 'BACKQUOTE';
export type LineEnding = 'LF' | 'CRLF';

export interface CreateIngestJobOptions {
  operation: IngestOperation;
  object: string;
  externalIdFieldName?: string;
  columnDelimiter?: ColumnDelimiter;
  lineEnding?: LineEnding;
}

export interface IngestJobInfo {
  id: string;
  state: IngestState;
  operation: IngestOperation;
  object: string;
  externalIdFieldName?: string;
  createdById: string;
  createdDate: string;
  systemModstamp: string;
  concurrencyMode: 'Parallel';
  contentType: 'CSV';
  apiVersion: number;
  contentUrl: string;
  jobType: 'V2Ingest';
  lineEnding: LineEnding;
  columnDelimiter: ColumnDelimiter;
  numberRecordsProcessed?: number;
  numberRecordsFailed?: number;
  retries?: number;
  totalProcessingTime?: number;
}

export interface ListIngestJobsOptions {
  isPkChunkingSupported?: boolean;
  jobType?: 'V2Ingest';
  queryLocator?: string;
}

export interface ListIngestJobsResponse {
  records: IngestJobInfo[];
  done: boolean;
  nextRecordsUrl?: string;
}

export interface CreateQueryJobOptions {
  operation: QueryOperation;
  query: string;
  columnDelimiter?: ColumnDelimiter;
  lineEnding?: LineEnding;
}

export interface QueryJobInfo {
  id: string;
  state: QueryState;
  operation: QueryOperation;
  query: string;
  createdById: string;
  createdDate: string;
  systemModstamp: string;
  concurrencyMode: 'Parallel';
  contentType: 'CSV';
  apiVersion: number;
  jobType: 'V2Query';
  lineEnding: LineEnding;
  columnDelimiter: ColumnDelimiter;
  numberRecordsProcessed?: number;
}

export interface ListQueryJobsOptions {
  isPkChunkingSupported?: boolean;
  jobType?: 'V2Query';
  queryLocator?: string;
}

export interface ListQueryJobsResponse {
  records: QueryJobInfo[];
  done: boolean;
  nextRecordsUrl?: string;
}

export interface GetResultsOptions {
  /** 最大取得件数（Partial Downloads / Winter '25） */
  maxRecords?: number;
  /** ページネーションロケーター（前回レスポンスの nextLocator から取得） */
  locator?: string;
}

export interface QueryResultsPage {
  /** CSV 文字列（ヘッダー行を含む） */
  csv: string;
  /** 次ページのロケーター。null の場合は最終ページ */
  nextLocator: string | null;
}

export interface GetResultsParallelOptions {
  /**
   * 将来用（現在は未使用）
   * 注意: 現実装はページを逐次取得して結合する。Salesforce がチャンクインデックス指定 API を
   * 提供する場合に真の並列化が有効になる。
   */
  parallelism?: number;
}

export interface WaitOptions {
  /**
   * タイムアウト（ミリ秒、デフォルト: 300_000 = 5分）
   * GWS 環境では最大 25 分程度まで延長可能
   */
  timeoutMs?: number;
  /** ポーリング間隔（ミリ秒、デフォルト: 10_000） */
  intervalMs?: number;
}

export interface ValidationError {
  row?: number;
  message: string;
}

export interface ValidationWarning {
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  summary: {
    rowCount: number;
    columnCount: number;
    headers: string[];
  };
}

/** bulkIngest() が返すプラグインオブジェクトの型 */
export interface BulkIngestPlugin {
  createJob(options: CreateIngestJobOptions): Promise<IngestJobInfo>;
  upload(jobId: string, csv: string): Promise<void>;
  close(jobId: string): Promise<IngestJobInfo>;
  abort(jobId: string): Promise<IngestJobInfo>;
  deleteJob(jobId: string): Promise<void>;
  getJob(jobId: string): Promise<IngestJobInfo>;
  listJobs(options?: ListIngestJobsOptions): Promise<ListIngestJobsResponse>;
  getSuccessfulResults(jobId: string): Promise<string>;
  getFailedResults(jobId: string): Promise<string>;
  getUnprocessedRecords(jobId: string): Promise<string>;
  waitForCompletion(jobId: string, options?: WaitOptions): Promise<IngestJobInfo>;
}

/** bulkQuery() が返すプラグインオブジェクトの型 */
export interface BulkQueryPlugin {
  createJob(options: CreateQueryJobOptions): Promise<QueryJobInfo>;
  abort(jobId: string): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  getJob(jobId: string): Promise<QueryJobInfo>;
  listJobs(options?: ListQueryJobsOptions): Promise<ListQueryJobsResponse>;
  getResults(jobId: string, options?: GetResultsOptions): Promise<QueryResultsPage>;
  getResultsParallel(jobId: string, options?: GetResultsParallelOptions): Promise<string>;
  waitForCompletion(jobId: string, options?: WaitOptions): Promise<QueryJobInfo>;
}

// ============================================================================
// 内部ヘルパー
// ============================================================================

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Ingest / Query で終了状態が将来変わる可能性に備えて別定数として定義している
const TERMINAL_INGEST_STATES = new Set<IngestState>(['JobComplete', 'Failed', 'Aborted']);
const TERMINAL_QUERY_STATES = new Set<QueryState>(['JobComplete', 'Failed', 'Aborted']);

/** 複数 CSV ページを結合する（先頭ページのヘッダー行を保持し、以降のヘッダー行を除去） */
const mergeCsvPages = (pages: string[]): string => {
  if (pages.length === 0) {
    return '';
  }
  if (pages.length === 1) {
    return pages[0];
  }
  // 末尾の \r?\n を除去してから LF で結合する（末尾改行による空行挿入を防ぐ）
  // 入力が CRLF であっても結合後は LF に統一される（Salesforce は LF/CRLF 両対応）
  const parts = [pages[0].replace(/\r?\n$/, '')];
  for (let i = 1; i < pages.length; i++) {
    const idx = pages[i].indexOf('\n');
    if (idx >= 0) {
      const tail = pages[i].slice(idx + 1).replace(/\r?\n$/, '');
      if (tail) {
        parts.push(tail);
      }
    }
  }
  return parts.join('\n');
};

// ============================================================================
// soql プラグイン
// ============================================================================

/**
 * SOQL クエリプラグイン
 *
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.soql<Account>());
 *   await sf.query('SELECT Id FROM Account');
 *   await sf.queryAll('SELECT Id FROM Account'); // nextRecordsUrl を自動追跡
 */
const soql = <TRow = unknown>(): Plugin<unknown, {
  /**
   * SOQL クエリを実行する（最大 2000 件）
   * @param soql - SOQL クエリ文字列
   */
  query(soql: string): Promise<SoqlResult<TRow>>;
  /**
   * SOQL クエリを全件取得する（nextRecordsUrl を自動的に辿る）
   * @param soql - SOQL クエリ文字列
   */
  queryAll(soql: string): Promise<TRow[]>;
}> => (client) => ({
  query: (q) =>
    // SF /query は SoqlResult 形式で返すことが SF REST API 仕様で保証される
    client.get('/query', { q }) as Promise<SoqlResult<TRow>>,

  queryAll: async (q) => {
    const records: TRow[] = [];
    // SF /query は SoqlResult 形式で返すことが SF REST API 仕様で保証される（soql.query と同じ理由）
    let result = await client.get('/query', { q }) as SoqlResult<TRow>;
    records.push(...result.records);
    while (!result.done && result.nextRecordsUrl) {
      // SF が返す nextRecordsUrl は /services/data/vXX.X/query/... の絶対パス形式。
      // ApiClient は baseUrl (/services/data/vXX.X) に endpoint を追記するため、
      // 重複する先頭部分を除去して相対パス (/query/...) に変換する。
      const relPath = result.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+/, '');
      // 継続ページも同じく SF REST API 仕様で SoqlResult 形式が保証される
      result = await client.get(relPath) as SoqlResult<TRow>;
      records.push(...result.records);
    }
    return records;
  },
});

// ============================================================================
// sobject プラグイン
// ============================================================================

/**
 * sObject CRUD プラグイン
 *
 * @param type - sObject API 名 (例: 'Account', 'Contact')
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.sobject<Account>('Account'));
 *   const acc = await sf.findById('001...');
 *   await sf.update('001...', { Name: 'New Name' });
 */
const sobject = <TRecord = unknown>(type: string): Plugin<unknown, {
  /**
   * @param id - Salesforce レコード ID (15桁 or 18桁)
   */
  findById(id: string): Promise<TRecord>;
  /**
   * @param data - 作成するレコードのフィールド値
   * @returns 作成されたレコードの id と success フラグ
   */
  create(data: Partial<TRecord>): Promise<{ id: string; success: boolean }>;
  /**
   * @param id - 更新対象のレコード ID
   * @param data - 更新するフィールド値
   */
  update(id: string, data: Partial<TRecord>): Promise<void>;
  /**
   * @param id - 削除対象のレコード ID
   */
  delete(id: string): Promise<void>;
}> => (client) => ({
  findById: (id) =>
    // SF /sobjects/{type}/{id} は TRecord 形式で返すことが SF REST API 仕様で保証される
    client.get(`/sobjects/${type}/${id}`) as Promise<TRecord>,

  create: (data) =>
    // SF /sobjects/{type} POST のレスポンス形式は SF REST API 仕様で保証される
    client.post(`/sobjects/${type}`, data) as Promise<{ id: string; success: boolean }>,

  update: (id, data) =>
    // SF PATCH は 204 No Content を返し、BaseClient が void 相当を返す
    client.patch(`/sobjects/${type}/${id}`, data) as Promise<void>,

  delete: (id) =>
    // SF DELETE は 204 No Content を返し、BaseClient が void 相当を返す
    client.delete(`/sobjects/${type}/${id}`) as Promise<void>,
});

// ============================================================================
// bulkIngest
// ============================================================================

/**
 * Bulk API v2 Ingest プラグイン
 *
 * @param client - SalesforceApiClient.create() で作成したクライアント
 *
 * 典型的な使用フロー:
 * ```
 * const bulk = SalesforceApiClientPlugins.bulkIngest(sfClient);
 * const job  = await bulk.createJob({ operation: 'insert', object: 'Account' });
 * await bulk.upload(job.id, csvString);   // Content-Type: text/csv で送信
 * await bulk.close(job.id);               // UploadComplete → 処理開始
 * const done = await bulk.waitForCompletion(job.id);
 * if (done.state === 'JobComplete') {
 *   const ok  = await bulk.getSuccessfulResults(job.id);
 *   const err = await bulk.getFailedResults(job.id);
 * }
 * ```
 *
 * ⚠️ Abort はロールバックではない
 * abortJob() でジョブを中断しても処理済みレコードは Salesforce に反映済みとなる。
 *
 * @remarks `.use()` パターン非対応。`SalesforceApiClientPlugins.bulkIngest(sfClient)` の形で直接呼び出すこと。
 */
const bulkIngest = (client: BaseClient<unknown>): BulkIngestPlugin => {
  /**
   * Ingest ジョブを作成する
   * @param options - 操作種別・対象オブジェクト等の設定
   * @returns 作成されたジョブ情報
   */
  // 以下の as キャストは、BaseClient<unknown> のメソッドが Promise<unknown> を返すことに対し、
  // SF Bulk API v2 仕様で保証されるレスポンス形状へ変換するもの。プラグイン内部に閉じ込める。

  const createJob = (options: CreateIngestJobOptions): Promise<IngestJobInfo> =>
    client.post('/jobs/ingest', options) as Promise<IngestJobInfo>;

  /**
   * CSV データをアップロードする（Content-Type: text/csv）
   * @param jobId - アップロード対象ジョブ ID
   * @param csv - RFC4180 形式の CSV 文字列（ヘッダー行必須）
   */
  const upload = (jobId: string, csv: string): Promise<void> =>
    client.call({
      method: 'PUT',
      endpoint: `/jobs/ingest/${jobId}/batches`,
      rawBody: csv,
      headers: { 'Content-Type': 'text/csv' },
    }) as Promise<void>;

  /**
   * ジョブをクローズしてデータ処理を開始する（state: UploadComplete）
   * @param jobId - クローズ対象ジョブ ID
   * @returns 更新されたジョブ情報
   */
  const close = (jobId: string): Promise<IngestJobInfo> =>
    client.patch(`/jobs/ingest/${jobId}`, { state: 'UploadComplete' }) as Promise<IngestJobInfo>;

  /**
   * ジョブを中断する（state: Aborted）
   *
   * ⚠️ 処理済みレコードはロールバックされない
   *
   * @param jobId - 中断対象ジョブ ID
   * @returns 更新されたジョブ情報
   */
  const abort = (jobId: string): Promise<IngestJobInfo> =>
    client.patch(`/jobs/ingest/${jobId}`, { state: 'Aborted' }) as Promise<IngestJobInfo>;

  /**
   * ジョブを削除する（Aborted 状態のジョブのみ削除可能）
   * @param jobId - 削除対象ジョブ ID
   */
  const deleteJob = (jobId: string): Promise<void> =>
    client.delete(`/jobs/ingest/${jobId}`) as Promise<void>;

  /**
   * ジョブ情報を取得する
   * @param jobId - 取得対象ジョブ ID
   * @returns ジョブ情報
   */
  const getJob = (jobId: string): Promise<IngestJobInfo> =>
    client.get(`/jobs/ingest/${jobId}`) as Promise<IngestJobInfo>;

  /**
   * Ingest ジョブ一覧を取得する
   * @param options - フィルター条件
   * @returns ジョブ一覧
   */
  const listJobs = (options?: ListIngestJobsOptions): Promise<ListIngestJobsResponse> =>
    // { ...undefined } は空オブジェクトになるため options が undefined でも安全
    client.get('/jobs/ingest', { ...options }) as Promise<ListIngestJobsResponse>;

  /**
   * 処理成功レコードの結果 CSV を取得する
   * @param jobId - 取得対象ジョブ ID
   * @returns CSV 文字列
   */
  const getSuccessfulResults = (jobId: string): Promise<string> =>
    client.get(`/jobs/ingest/${jobId}/successfulResults`) as Promise<string>;

  /**
   * 処理失敗レコードの結果 CSV を取得する（sf__Error, sf__Id 列を含む）
   * @param jobId - 取得対象ジョブ ID
   * @returns CSV 文字列
   */
  const getFailedResults = (jobId: string): Promise<string> =>
    client.get(`/jobs/ingest/${jobId}/failedResults`) as Promise<string>;

  /**
   * 未処理レコードの CSV を取得する
   * @param jobId - 取得対象ジョブ ID
   * @returns CSV 文字列
   */
  const getUnprocessedRecords = (jobId: string): Promise<string> =>
    client.get(`/jobs/ingest/${jobId}/unprocessedrecords`) as Promise<string>;

  /**
   * ジョブが完了状態になるまでポーリングして待機する
   *
   * @param jobId - 待機対象ジョブ ID
   * @param options.timeoutMs - タイムアウト（ミリ秒、デフォルト: 300_000 = 5分）
   * @param options.intervalMs - ポーリング間隔（ミリ秒、デフォルト: 10_000）
   * @returns 完了時のジョブ情報（state: JobComplete | Failed | Aborted）
   * @throws {Error} タイムアウトした場合
   */
  const waitForCompletion = async (jobId: string, options: WaitOptions = {}): Promise<IngestJobInfo> => {
    const { timeoutMs = 300_000, intervalMs = 10_000 } = options;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const job = await getJob(jobId);
      if (TERMINAL_INGEST_STATES.has(job.state)) {
        return job;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`BulkIngest ジョブ (${jobId}) がタイムアウトしました (${timeoutMs}ms)`);
      }
      await sleep(Math.min(intervalMs, remaining));
    }
  };

  return {
    createJob,
    upload,
    close,
    abort,
    deleteJob,
    getJob,
    listJobs,
    getSuccessfulResults,
    getFailedResults,
    getUnprocessedRecords,
    waitForCompletion,
  };
};

// ============================================================================
// bulkQuery
// ============================================================================

/**
 * Bulk API v2 Query プラグイン
 *
 * @param client - SalesforceApiClient.create() で作成したクライアント
 *
 * 典型的な使用フロー:
 * ```
 * const query = SalesforceApiClientPlugins.bulkQuery(sfClient);
 * const job   = await query.createJob({ operation: 'query', query: 'SELECT Id FROM Account' });
 * const done  = await query.waitForCompletion(job.id);
 * // 1ページずつ取得
 * let page = await query.getResults(done.id);
 * while (page.nextLocator) {
 *   page = await query.getResults(done.id, { locator: page.nextLocator });
 * }
 * // または全ページまとめて取得
 * const fullCsv = await query.getResultsParallel(done.id);
 * ```
 *
 * @remarks `.use()` パターン非対応。`SalesforceApiClientPlugins.bulkQuery(sfClient)` の形で直接呼び出すこと。
 */
const bulkQuery = (client: BaseClient<unknown>): BulkQueryPlugin => {
  // 以下の as キャストは、BaseClient<unknown> のメソッドが Promise<unknown> を返すことに対し、
  // SF Bulk API v2 仕様で保証されるレスポンス形状へ変換するもの。プラグイン内部に閉じ込める。

  /**
   * Query ジョブを作成して即座に処理を開始する
   * @param options - クエリ文字列・操作種別等の設定
   * @returns 作成されたジョブ情報
   */
  const createJob = (options: CreateQueryJobOptions): Promise<QueryJobInfo> =>
    client.post('/jobs/query', options) as Promise<QueryJobInfo>;

  /**
   * ジョブを中断する
   *
   * SF Bulk API v2 の仕様上、Query ジョブの中断と削除は同一エンドポイント（DELETE）を使用する。
   * Ingest ジョブの abort（PATCH）とは異なる点に注意。
   *
   * @param jobId - 中断対象ジョブ ID
   */
  const abort = (jobId: string): Promise<void> =>
    client.delete(`/jobs/query/${jobId}`) as Promise<void>;

  /**
   * ジョブを削除する
   *
   * SF Bulk API v2 の仕様上、Query ジョブの削除と中断は同一エンドポイント（DELETE）を使用する。
   * abort() と同じエンドポイントだが、用途に応じて使い分けること。
   *
   * @param jobId - 削除対象ジョブ ID
   */
  const deleteJob = (jobId: string): Promise<void> =>
    client.delete(`/jobs/query/${jobId}`) as Promise<void>;

  /**
   * ジョブ情報を取得する
   * @param jobId - 取得対象ジョブ ID
   * @returns ジョブ情報
   */
  const getJob = (jobId: string): Promise<QueryJobInfo> =>
    client.get(`/jobs/query/${jobId}`) as Promise<QueryJobInfo>;

  /**
   * Query ジョブ一覧を取得する
   * @param options - フィルター条件
   * @returns ジョブ一覧
   */
  const listJobs = (options?: ListQueryJobsOptions): Promise<ListQueryJobsResponse> =>
    // { ...undefined } は空オブジェクトになるため options が undefined でも安全
    client.get('/jobs/query', { ...options }) as Promise<ListQueryJobsResponse>;

  /**
   * クエリ結果 CSV を 1 ページ取得する（Partial Downloads / Winter '25 対応）
   *
   * Sforce-Locator レスポンスヘッダーを自動的にキャプチャして nextLocator に格納する。
   *
   * @param jobId - 取得対象ジョブ ID
   * @param options.maxRecords - 最大取得件数（Partial Downloads）
   * @param options.locator - 前回レスポンスの nextLocator（ページネーション）
   * @returns CSV 文字列と次ページのロケーター
   */
  const getResults = async (jobId: string, options: GetResultsOptions = {}): Promise<QueryResultsPage> => {
    let nextLocator: string | null = null;

    // Sforce-Locator レスポンスヘッダーをキャプチャするために transport をラップする。
    // SalesforceApiClient の responseHandler は response.body のみを返すため
    // ヘッダーは transport デコレータ層で取得する必要がある。
    // extend() は additionalMethods をリセットするが、capturingClient は .get() のみ使用するため問題ない。
    const capturingClient = client.extend((t) => ({
      fetch: async (url: string, fetchOptions?: FetchOptions) => {
        const response = await t.fetch(url, fetchOptions);
        // HTTP ヘッダーは RFC 7230 でケースインセンシティブなため、小文字正規化して検索する
        const locatorEntry = Object.entries(response.headers)
          .find(([k]) => k.toLowerCase() === 'sforce-locator');
        const rawLocator = locatorEntry?.[1];
        nextLocator =
          typeof rawLocator === 'string' && rawLocator !== 'null'
            ? rawLocator
            : null;
        return response;
      },
    }));

    const query: Record<string, unknown> = {};
    if (options.maxRecords != null) {
      query['maxRecords'] = options.maxRecords;
    }
    if (options.locator != null) {
      query['locator'] = options.locator;
    }

    // SF Bulk API v2 Query Results エンドポイントは text/csv を返し、SalesforceApiClient が文字列として処理する
    const csv = await capturingClient.get(`/jobs/query/${jobId}/results`, query) as string;
    return { csv, nextLocator };
  };

  /**
   * クエリ結果 CSV を全ページ取得して結合した文字列を返す
   *
   * Partial Downloads に対応し、全ページを順次取得してヘッダー行の重複を除去して結合する。
   *
   * ⚠️ 真の並列ダウンロード（Salesforce チャンクインデックス API）は現時点では未対応。
   * parallelism オプションは将来の拡張のために予約されている。
   *
   * @param jobId - 取得対象ジョブ ID
   * @param options.parallelism - 将来用（現在は未使用）
   * @returns ヘッダー行 1 行 + 全データ行を結合した CSV 文字列
   */
  const getResultsParallel = async (jobId: string, options: GetResultsParallelOptions = {}): Promise<string> => {
    void options; // parallelism は将来の並列化実装のために予約されており現在は未使用
    const pages: string[] = [];
    let locator: string | null = null;

    do {
      const page = await getResults(jobId, locator != null ? { locator } : {});
      pages.push(page.csv);
      locator = page.nextLocator;
    } while (locator !== null);

    return mergeCsvPages(pages);
  };

  /**
   * ジョブが完了状態になるまでポーリングして待機する
   *
   * @param jobId - 待機対象ジョブ ID
   * @param options.timeoutMs - タイムアウト（ミリ秒、デフォルト: 300_000 = 5分）
   * @param options.intervalMs - ポーリング間隔（ミリ秒、デフォルト: 10_000）
   * @returns 完了時のジョブ情報（state: JobComplete | Failed | Aborted）
   * @throws {Error} タイムアウトした場合
   */
  const waitForCompletion = async (jobId: string, options: WaitOptions = {}): Promise<QueryJobInfo> => {
    const { timeoutMs = 300_000, intervalMs = 10_000 } = options;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const job = await getJob(jobId);
      if (TERMINAL_QUERY_STATES.has(job.state)) {
        return job;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`BulkQuery ジョブ (${jobId}) がタイムアウトしました (${timeoutMs}ms)`);
      }
      await sleep(Math.min(intervalMs, remaining));
    }
  };

  return {
    createJob,
    abort,
    deleteJob,
    getJob,
    listJobs,
    getResults,
    getResultsParallel,
    waitForCompletion,
  };
};

// ============================================================================
// Utils
// ============================================================================

/**
 * Bulk API v2 CSV ユーティリティ
 *
 * Salesforce Bulk API v2 が扱う CSV（RFC4180 準拠・ヘッダー行あり）の
 * パース・生成・検証を提供する純粋関数群。
 */
const Utils = {
  /**
   * CSV 文字列をオブジェクト配列に変換する
   * @param csv - ヘッダー行付き RFC4180 CSV 文字列
   * @returns レコードの配列
   */
  csvToRecords(csv: string): Record<string, string>[] {
    if (!csv || csv.trim() === '') {
      return [];
    }
    // csv-parse/sync は any を返すため、SF Bulk API v2 CSV の形式（文字列フィールドのみ）に合わせてキャスト
    return parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  },

  /**
   * オブジェクト配列を CSV 文字列に変換する
   * @param records - レコードの配列
   * @returns ヘッダー行付き RFC4180 CSV 文字列
   */
  recordsToCsv(records: Record<string, string>[]): string {
    if (records.length === 0) {
      return '';
    }
    // csv-stringify はデフォルトで末尾 \n を付加するため除去して GAS 版と統一する
    return stringify(records, { header: true }).replace(/\r?\n$/, '');
  },

  /**
   * CSV のデータ行数を返す（ヘッダー行を除く）
   * @param csv - RFC4180 CSV 文字列
   * @returns データ行数
   */
  csvRowCount(csv: string): number {
    if (!csv || csv.trim() === '') {
      return 0;
    }
    // csv-parse/sync は any を返すため、件数取得目的で unknown[] にキャスト
    const records = parse(csv, { columns: true, skip_empty_lines: true }) as unknown[];
    return records.length;
  },

  /**
   * CSV のヘッダー列名の配列を返す
   * @param csv - RFC4180 CSV 文字列
   * @returns ヘッダー列名の配列
   */
  csvHeaders(csv: string): string[] {
    if (!csv || csv.trim() === '') {
      return [];
    }
    // csv-parse/sync は any を返すため、ヘッダー行のみ取得して string[][] にキャスト
    const rows = parse(csv, { columns: false, to_line: 1 }) as string[][];
    return rows[0] ?? [];
  },

  /**
   * CSV の形式を検証して結果を返す
   *
   * 検証内容:
   * - RFC4180 準拠チェック（クォート・列数一致）
   * - ヘッダー行の存在・重複確認
   * - Salesforce 固有チェック（Id 列の有無・件数上限 1.5億件）
   *
   * @param csv - 検証対象の CSV 文字列
   * @returns 検証結果（valid, errors, warnings, summary）
   */
  validateCsv(csv: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!csv || csv.trim() === '') {
      return {
        valid: false,
        errors: [{ message: 'CSV が空です' }],
        warnings: [],
        summary: { rowCount: 0, columnCount: 0, headers: [] },
      };
    }

    let headers: string[] = [];
    let rowCount = 0;
    let columnCount = 0;

    try {
      // columns: false で1回だけパースし、行配列から直接検証する（二重パース回避）
      // csv-parse/sync は any を返すため、行×列の2次元配列として string[][] にキャスト
      const allRows = parse(csv, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];

      if (allRows.length === 0) {
        errors.push({ message: 'ヘッダー行がありません' });
        return { valid: false, errors, warnings, summary: { rowCount: 0, columnCount: 0, headers: [] } };
      }

      headers = allRows[0];
      columnCount = headers.length;
      const dataRows = allRows.slice(1);
      rowCount = dataRows.length;

      if (headers.some(h => h === '')) {
        errors.push({ message: '空のヘッダー列が含まれています' });
      }

      const uniqueHeaders = new Set(headers);
      if (uniqueHeaders.size !== headers.length) {
        errors.push({ message: '重複したヘッダー列が含まれています' });
      }

      for (const [i, row] of dataRows.entries()) {
        if (row.length !== columnCount) {
          errors.push({ row: i + 2, message: `列数がヘッダーと一致しません (expected: ${columnCount}, actual: ${row.length})` });
        }
      }

      if (!headers.includes('Id')) {
        warnings.push({ message: 'Id 列がありません（update / upsert / delete 操作では必須）' });
      }

      if (rowCount === 0) {
        warnings.push({ message: 'データ行が 0 件です' });
      }

      if (rowCount > 150_000_000) {
        errors.push({ message: `レコード数が Bulk API v2 の上限（1億5000万件）を超えています: ${rowCount} 件` });
      }
    } catch (e) {
      errors.push({ message: `CSV パースエラー: ${e instanceof Error ? e.message : String(e)}` });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: { rowCount, columnCount, headers },
    };
  },
} as const;

// ============================================================================
// エクスポート
// ============================================================================

export const SalesforceApiClientPlugins = {
  soql,
  sobject,
  bulkIngest,
  bulkQuery,
  Utils,
} as const;
