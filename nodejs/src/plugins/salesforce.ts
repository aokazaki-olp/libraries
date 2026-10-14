/**
 * plugins/salesforce.ts
 *
 * @description Salesforce REST API / Bulk API v2 用プラグインセット
 *
 * 使用例（REST API）:
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.soql(decodeAccount)); // decodeAccount: (row: unknown) => Account
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
 * abort() でジョブを中断しても、処理済みレコードはロールバックされない。
 * Bulk API v2 は逐次コミットであり、中断前に処理されたレコードは
 * すでに Salesforce に反映されている。
 *
 * ⚠️ Events について
 * Bulk API v2 Events（ジョブ状態変化イベント購読）は現バージョンでは未対応。
 * ポーリングによる状態監視（waitForCompletion）を使用すること。
 */

import type { BaseClient, Plugin } from '../ApiClient.ts';
import type { CallOptions, Decoder, FetchOptions } from '../httpTypes.ts';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
// shared は末端の共有ユーティリティ（コアにもクライアントにも依存しない）。
// プラグインはコアの型だけを見る（PLUGIN_SYSTEM_RULES §2.4）が、待機と例外の正規化はここから借りる
import { sleep } from '../shared/sleep.ts';
import { toError } from '../shared/toError.ts';

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
export type IngestState =
  'Open' | 'UploadComplete' | 'InProgress' | 'JobComplete' | 'Failed' | 'Aborted';
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

export interface GetResultsOptions extends CallOptions {
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

/** getResultsParallel のオプション（全ページを逐次取得する。並列取得は未対応） */
export type GetResultsParallelOptions = CallOptions;

export interface WaitOptions extends CallOptions {
  /**
   * タイムアウト（ミリ秒、デフォルト: 300_000 = 5分。Infinity で無期限）。ポーリング間隔だけでなく、ジョブ情報の取得 1 回分にも掛かる
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

/** soql() が追加するメソッド */
export interface SoqlMethods<TRow> {
  /**
   * SOQL クエリを実行する（1 ページ分。最大 2000 件）
   * @param soql - SOQL クエリ文字列
   * @param callOptions - 中断シグナル等
   * @returns クエリ結果（records は decodeRow を通した値）
   * @throws {Error} 応答が SOQL の結果形式でない場合。decodeRow が投げた例外もそのまま伝わる
   */
  query(soql: string, callOptions?: CallOptions): Promise<SoqlResult<TRow>>;
  /**
   * SOQL クエリを全件取得する（nextRecordsUrl を自動的に辿る）
   * @param soql - SOQL クエリ文字列
   * @param callOptions - 中断シグナル等
   * @returns 全ページのレコード（decodeRow を通した値）
   * @throws {Error} 応答が SOQL の結果形式でない場合。decodeRow が投げた例外もそのまま伝わる
   */
  queryAll(soql: string, callOptions?: CallOptions): Promise<TRow[]>;
}

/** sobject() が追加するメソッド */
export interface SobjectMethods<TRecord> {
  /**
   * @param id - Salesforce レコード ID (15桁 or 18桁)
   * @param callOptions - 中断シグナル等
   * @returns レコード（decode を通した値）
   * @throws {Error} decode が投げた例外
   */
  findById(id: string, callOptions?: CallOptions): Promise<TRecord>;
  /**
   * @param data - 作成するレコードのフィールド値
   * @param callOptions - 中断シグナル等
   * @returns 作成されたレコードの id と success フラグ
   * @throws {Error} 応答が id / success を持たない場合
   */
  create(data: Partial<TRecord>, callOptions?: CallOptions): Promise<SobjectCreateResult>;
  /**
   * @param id - 更新対象のレコード ID
   * @param data - 更新するフィールド値
   * @param callOptions - 中断シグナル等
   */
  update(id: string, data: Partial<TRecord>, callOptions?: CallOptions): Promise<void>;
  /**
   * @param id - 削除対象のレコード ID
   * @param callOptions - 中断シグナル等
   */
  delete(id: string, callOptions?: CallOptions): Promise<void>;
}

export interface SobjectCreateResult {
  id: string;
  success: boolean;
}

/** bulkIngest() が返すプラグインオブジェクトの型 */
export interface BulkIngestPlugin {
  createJob(options: CreateIngestJobOptions, callOptions?: CallOptions): Promise<IngestJobInfo>;
  upload(jobId: string, csv: string, callOptions?: CallOptions): Promise<void>;
  close(jobId: string, callOptions?: CallOptions): Promise<IngestJobInfo>;
  abort(jobId: string, callOptions?: CallOptions): Promise<IngestJobInfo>;
  deleteJob(jobId: string, callOptions?: CallOptions): Promise<void>;
  getJob(jobId: string, callOptions?: CallOptions): Promise<IngestJobInfo>;
  listJobs(
    options?: ListIngestJobsOptions,
    callOptions?: CallOptions,
  ): Promise<ListIngestJobsResponse>;
  getSuccessfulResults(jobId: string, callOptions?: CallOptions): Promise<string>;
  getFailedResults(jobId: string, callOptions?: CallOptions): Promise<string>;
  getUnprocessedRecords(jobId: string, callOptions?: CallOptions): Promise<string>;
  waitForCompletion(jobId: string, options?: WaitOptions): Promise<IngestJobInfo>;
}

/** bulkQuery() が返すプラグインオブジェクトの型 */
export interface BulkQueryPlugin {
  createJob(options: CreateQueryJobOptions, callOptions?: CallOptions): Promise<QueryJobInfo>;
  abort(jobId: string, callOptions?: CallOptions): Promise<void>;
  deleteJob(jobId: string, callOptions?: CallOptions): Promise<void>;
  getJob(jobId: string, callOptions?: CallOptions): Promise<QueryJobInfo>;
  listJobs(
    options?: ListQueryJobsOptions,
    callOptions?: CallOptions,
  ): Promise<ListQueryJobsResponse>;
  getResults(jobId: string, options?: GetResultsOptions): Promise<QueryResultsPage>;
  getResultsParallel(jobId: string, options?: GetResultsParallelOptions): Promise<string>;
  waitForCompletion(jobId: string, options?: WaitOptions): Promise<QueryJobInfo>;
}

// ============================================================================
// 内部ヘルパー
// ============================================================================

const INGEST_STATES: ReadonlySet<string> = new Set<IngestState>([
  'Open',
  'UploadComplete',
  'InProgress',
  'JobComplete',
  'Failed',
  'Aborted',
]);
const QUERY_STATES: ReadonlySet<string> = new Set<QueryState>([
  'UploadComplete',
  'InProgress',
  'JobComplete',
  'Failed',
  'Aborted',
]);

// Ingest / Query で終了状態が将来変わる可能性に備えて別定数として定義している
const TERMINAL_INGEST_STATES: ReadonlySet<string> = new Set<IngestState>([
  'JobComplete',
  'Failed',
  'Aborted',
]);
const TERMINAL_QUERY_STATES: ReadonlySet<string> = new Set<QueryState>([
  'JobComplete',
  'Failed',
  'Aborted',
]);

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** 文字列なら nextRecordsUrl として持たせる（Salesforce は最終ページで null を返す） */
const withNextRecordsUrl = (next: unknown): { nextRecordsUrl?: string } =>
  typeof next === 'string' ? { nextRecordsUrl: next } : {};

/**
 * SOQL 応答のエンベロープ（records / totalSize / done）を検査し、各行を decodeRow に通す
 *
 * @throws {Error} エンベロープの形をしていない場合。decodeRow が投げた例外もそのまま伝わる
 */
const toSoqlResult = <TRow>(body: unknown, decodeRow: Decoder<TRow>): SoqlResult<TRow> => {
  const records: unknown = isObject(body) ? Reflect.get(body, 'records') : undefined;
  const totalSize: unknown = isObject(body) ? Reflect.get(body, 'totalSize') : undefined;
  const done: unknown = isObject(body) ? Reflect.get(body, 'done') : undefined;
  if (!isObject(body) || !Array.isArray(records) || typeof totalSize !== 'number') {
    throw new Error('Salesforce /query が SOQL の結果形式でない応答を返しました');
  }
  if (typeof done !== 'boolean') {
    throw new Error('Salesforce /query が SOQL の結果形式でない応答を返しました');
  }
  return {
    records: records.map((row: unknown) => decodeRow(row)),
    totalSize,
    done,
    ...withNextRecordsUrl(Reflect.get(body, 'nextRecordsUrl')),
  };
};

const INGEST_LABEL = 'Salesforce Bulk API (ingest)';
const QUERY_LABEL = 'Salesforce Bulk API (query)';

/**
 * Bulk API のジョブ情報のうち、ライブラリの動作が依存する id と state（waitForCompletion の終了判定）を検査する
 *
 * @throws {Error} id が文字列でない、または state が既知の値でない場合
 */
const checkJobInfo = (body: unknown, states: ReadonlySet<string>, label: string): void => {
  const id: unknown = isObject(body) ? Reflect.get(body, 'id') : undefined;
  const state: unknown = isObject(body) ? Reflect.get(body, 'state') : undefined;
  if (typeof id !== 'string' || typeof state !== 'string' || !states.has(state)) {
    throw new Error(`${label} がジョブ情報の形式でない応答を返しました`);
  }
};

// 以下2つの as は、id と state を checkJobInfo で検査したうえで、残りのフィールドを
// Bulk API 2.0 Developer Guide の Job Info の Response Body の記載に基づいて型付けするもの（PLUGIN_SYSTEM_RULES §2.5）

/** Ingest ジョブ情報を検査する */
const toIngestJob = (body: unknown): IngestJobInfo => {
  checkJobInfo(body, INGEST_STATES, INGEST_LABEL);
  return body as IngestJobInfo;
};

/** Query ジョブ情報を検査する */
const toQueryJob = (body: unknown): QueryJobInfo => {
  checkJobInfo(body, QUERY_STATES, QUERY_LABEL);
  return body as QueryJobInfo;
};

/**
 * Bulk API のジョブ一覧を検査する（各ジョブは decodeJob で検査する）
 *
 * @throws {Error} records が配列でない、done が真偽値でない、またはジョブ情報が不正な場合
 */
const toJobList = <TJob>(
  body: unknown,
  decodeJob: Decoder<TJob>,
  label: string,
): { records: TJob[]; done: boolean; nextRecordsUrl?: string } => {
  const records: unknown = isObject(body) ? Reflect.get(body, 'records') : undefined;
  const done: unknown = isObject(body) ? Reflect.get(body, 'done') : undefined;
  if (!isObject(body) || !Array.isArray(records) || typeof done !== 'boolean') {
    throw new Error(`${label} がジョブ一覧の形式でない応答を返しました`);
  }
  return {
    records: records.map((record: unknown) => decodeJob(record)),
    done,
    ...withNextRecordsUrl(Reflect.get(body, 'nextRecordsUrl')),
  };
};

/**
 * CSV を返すエンドポイントの応答を文字列として受ける
 *
 * 空のボディは Transport が null にするので空文字に戻す。
 *
 * @throws {Error} 文字列でも空でもない応答の場合
 */
const toCsv = (body: unknown): string => {
  if (typeof body === 'string') {
    return body;
  }
  if (body == null) {
    return '';
  }
  throw new Error(`CSV を期待した応答に ${typeof body} が返りました`);
};

/** 複数 CSV ページを結合する（先頭ページのヘッダー行を保持し、以降のヘッダー行を除去） */
const mergeCsvPages = (pages: string[]): string => {
  const [first, ...rest] = pages;
  if (first === undefined) {
    return '';
  }
  if (rest.length === 0) {
    return first;
  }
  // 末尾の \r?\n を除去してから LF で結合する（末尾改行による空行挿入を防ぐ）
  // 入力が CRLF であっても結合後は LF に統一される（Salesforce は LF/CRLF 両対応）
  const parts = [first.replace(/\r?\n$/, '')];
  for (const page of rest) {
    const headerEnd = page.indexOf('\n');
    if (headerEnd >= 0) {
      const tail = page.slice(headerEnd + 1).replace(/\r?\n$/, '');
      if (tail) {
        parts.push(tail);
      }
    }
  }
  return parts.join('\n');
};

/** タイマーに渡せる最大のミリ秒（これを超えると Node は 1ms に丸める） */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * waitForCompletion の待ち時間の設定を検査する（作成時に fail-fast させる）
 *
 * @throws {TypeError} timeoutMs が 0 以上の数（Infinity は無期限）でない場合、
 *   intervalMs が 1 以上でタイマーの上限以下の有限数でない場合
 */
const assertWaitOptions = (timeoutMs: number, intervalMs: number): void => {
  if (Number.isNaN(timeoutMs) || timeoutMs < 0) {
    throw new TypeError(
      `timeoutMs には 0 以上の数（無期限なら Infinity）を指定してください (received: ${String(timeoutMs)})`,
    );
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > MAX_TIMER_MS) {
    throw new TypeError(
      `intervalMs には 1〜${String(MAX_TIMER_MS)} の数を指定してください (received: ${String(intervalMs)})`,
    );
  }
};

/** 残り時間で打ち切る signal を作る。残り時間がタイマーで表せない（0 以下・無期限・上限超え）なら作らない */
const deadlineSignal = (deadline: number): AbortSignal | undefined => {
  const remaining = deadline - Date.now();
  return remaining > 0 && remaining <= MAX_TIMER_MS
    ? AbortSignal.timeout(Math.ceil(remaining))
    : undefined;
};

/**
 * ジョブが終了状態になるまでポーリングする（bulkIngest / bulkQuery 共通）
 *
 * timeoutMs はポーリング間隔だけでなく、ジョブ情報の取得 1 回分にも掛ける。
 * timeoutMs が 0 でも 1 回は取得する（取得の時点で終了していれば返す）。
 *
 * @throws {TypeError} timeoutMs / intervalMs が不正な場合
 * @throws {Error} タイムアウトした場合
 * @throws signal が中断された場合、その理由
 */
const pollUntilTerminal = async <TJob extends { state: string }>(
  fetchJob: (callOptions: CallOptions) => Promise<TJob>,
  terminalStates: ReadonlySet<string>,
  label: string,
  options: WaitOptions,
): Promise<TJob> => {
  const { timeoutMs = 300_000, intervalMs = 10_000, signal } = options;
  assertWaitOptions(timeoutMs, intervalMs);
  const deadline = Date.now() + timeoutMs;
  const timeoutError = (cause?: unknown): Error =>
    new Error(`${label} がタイムアウトしました (${String(timeoutMs)}ms)`, { cause });

  for (;;) {
    const timeout = deadlineSignal(deadline);
    const signals = [signal, timeout].filter((s) => s !== undefined);
    const requestSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    let job: TJob;
    try {
      job = await fetchJob({ signal: requestSignal });
    } catch (e) {
      if (timeout?.aborted === true && signal?.aborted !== true) {
        throw timeoutError(e);
      }
      throw e;
    }
    if (terminalStates.has(job.state)) {
      return job;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw timeoutError();
    }
    await sleep(Math.min(intervalMs, remaining), signal);
  }
};

// ============================================================================
// soql プラグイン
// ============================================================================

const buildSoql =
  <TRow>(decodeRow: Decoder<TRow>): Plugin<unknown, SoqlMethods<TRow>> =>
  (client) => ({
    query: async (soqlQuery, callOptions) =>
      toSoqlResult(
        await client.get('/query', { q: soqlQuery }, { signal: callOptions?.signal }),
        decodeRow,
      ),

    queryAll: async (soqlQuery, callOptions) => {
      const signal = callOptions?.signal;
      const records: TRow[] = [];
      let result = toSoqlResult(
        await client.get('/query', { q: soqlQuery }, { signal }),
        decodeRow,
      );
      records.push(...result.records);
      while (!result.done && result.nextRecordsUrl) {
        // SF が返す nextRecordsUrl は /services/data/vXX.X/query/... の絶対パス形式。
        // ApiClient は baseUrl (/services/data/vXX.X) に endpoint を追記するため、
        // 重複する先頭部分を除去して相対パス (/query/...) に変換する。
        const nextPath = result.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+/, '');
        result = toSoqlResult(await client.get(nextPath, undefined, { signal }), decodeRow);
        records.push(...result.records);
      }
      return records;
    },
  });

/**
 * SOQL クエリプラグイン
 *
 * 行の型を付けるときは、行を検証して変換する decodeRow を渡す（CODING_RULES.md §2.7）。
 * 省略すると行は unknown のまま返る。
 *
 * @param decodeRow - 各行の検証・変換
 * @returns query / queryAll を追加するプラグイン
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.soql(decodeAccount));
 *   await sf.query('SELECT Id FROM Account');
 *   await sf.queryAll('SELECT Id FROM Account'); // nextRecordsUrl を自動追跡
 */
function soql(): Plugin<unknown, SoqlMethods<unknown>>;
function soql<TRow>(decodeRow: Decoder<TRow>): Plugin<unknown, SoqlMethods<TRow>>;
function soql<TRow>(
  decodeRow?: Decoder<TRow>,
): Plugin<unknown, SoqlMethods<TRow>> | Plugin<unknown, SoqlMethods<unknown>> {
  return decodeRow ? buildSoql(decodeRow) : buildSoql((row) => row);
}

// ============================================================================
// sobject プラグイン
// ============================================================================

/** decode 省略時の既定: オブジェクトであることだけを検査する */
const toRecord = (body: unknown): Record<string, unknown> => {
  if (!isObject(body)) {
    throw new Error('Salesforce sObject API がレコードの形式でない応答を返しました');
  }
  return Object.fromEntries(Object.entries(body));
};

/** POST /sobjects/{type} の応答（id / success）を検査する */
const toCreateResult = (body: unknown): SobjectCreateResult => {
  const id: unknown = isObject(body) ? Reflect.get(body, 'id') : undefined;
  const success: unknown = isObject(body) ? Reflect.get(body, 'success') : undefined;
  if (typeof id !== 'string' || typeof success !== 'boolean') {
    throw new Error('Salesforce sObject API がレコード作成結果の形式でない応答を返しました');
  }
  return { id, success };
};

const buildSobject =
  <TRecord>(type: string, decode: Decoder<TRecord>): Plugin<unknown, SobjectMethods<TRecord>> =>
  (client) => ({
    findById: async (id, callOptions) =>
      decode(
        await client.get(`/sobjects/${type}/${id}`, undefined, { signal: callOptions?.signal }),
      ),

    create: async (data, callOptions) =>
      toCreateResult(await client.post(`/sobjects/${type}`, data, { signal: callOptions?.signal })),

    // PATCH / DELETE は 204 No Content を返すので、戻り値は無い
    update: async (id, data, callOptions) => {
      await client.patch(`/sobjects/${type}/${id}`, data, { signal: callOptions?.signal });
    },

    delete: async (id, callOptions) => {
      await client.delete(`/sobjects/${type}/${id}`, { signal: callOptions?.signal });
    },
  });

/**
 * sObject CRUD プラグイン
 *
 * レコードの型を付けるときは、レコードを検証して変換する decode を渡す（CODING_RULES.md §2.7）。
 * 省略するとレコードは Record<string, unknown> として返る。
 *
 * @param type - sObject API 名 (例: 'Account', 'Contact')
 * @param decode - レコードの検証・変換
 * @returns findById / create / update / delete を追加するプラグイン
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.sobject('Account', decodeAccount));
 *   const account = await sf.findById('001...');
 *   await sf.update('001...', { Name: 'New Name' });
 */
function sobject(type: string): Plugin<unknown, SobjectMethods<Record<string, unknown>>>;
function sobject<TRecord>(
  type: string,
  decode: Decoder<TRecord>,
): Plugin<unknown, SobjectMethods<TRecord>>;
function sobject<TRecord>(
  type: string,
  decode?: Decoder<TRecord>,
):
  | Plugin<unknown, SobjectMethods<TRecord>>
  | Plugin<unknown, SobjectMethods<Record<string, unknown>>> {
  return decode ? buildSobject(type, decode) : buildSobject(type, toRecord);
}

// ============================================================================
// bulkIngest
// ============================================================================

/**
 * Bulk API v2 Ingest プラグイン
 *
 * @param client - SalesforceApiClient.create() で作成したクライアント
 * @returns Ingest ジョブ操作のオブジェクト
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
 * abort() でジョブを中断しても処理済みレコードは Salesforce に反映済みとなる。
 *
 * @remarks `.use()` 非対応。`SalesforceApiClientPlugins.bulkIngest(sfClient)` の形で直接呼び出す。
 *   bulkIngest と bulkQuery はメソッド名（createJob / getJob / abort 等）が衝突するため、
 *   クライアントへ合成せず独立したオブジェクトとして返す。
 *   各メソッドの末尾引数 callOptions.signal で中断できる。
 */
const bulkIngest = (client: BaseClient): BulkIngestPlugin => {
  /**
   * Ingest ジョブを作成する
   * @param options - 操作種別・対象オブジェクト等の設定
   * @param callOptions - 中断シグナル等
   * @returns 作成されたジョブ情報
   * @throws {Error} 応答がジョブ情報の形式でない場合
   */
  const createJob = async (
    options: CreateIngestJobOptions,
    callOptions?: CallOptions,
  ): Promise<IngestJobInfo> =>
    toIngestJob(await client.post('/jobs/ingest', options, { signal: callOptions?.signal }));

  /**
   * CSV データをアップロードする（Content-Type: text/csv）
   * @param jobId - アップロード対象ジョブ ID
   * @param csv - RFC4180 形式の CSV 文字列（ヘッダー行必須）
   * @param callOptions - 中断シグナル等
   */
  const upload = async (jobId: string, csv: string, callOptions?: CallOptions): Promise<void> => {
    await client.call({
      method: 'PUT',
      endpoint: `/jobs/ingest/${jobId}/batches`,
      rawBody: csv,
      headers: { 'Content-Type': 'text/csv' },
      signal: callOptions?.signal,
    });
  };

  const patchState = async (
    jobId: string,
    state: 'UploadComplete' | 'Aborted',
    callOptions?: CallOptions,
  ): Promise<IngestJobInfo> =>
    toIngestJob(
      await client.patch(`/jobs/ingest/${jobId}`, { state }, { signal: callOptions?.signal }),
    );

  /**
   * ジョブをクローズしてデータ処理を開始する（state: UploadComplete）
   * @param jobId - クローズ対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns 更新されたジョブ情報
   * @throws {Error} 応答がジョブ情報の形式でない場合
   */
  const close = (jobId: string, callOptions?: CallOptions): Promise<IngestJobInfo> =>
    patchState(jobId, 'UploadComplete', callOptions);

  /**
   * ジョブを中断する（state: Aborted）
   *
   * ⚠️ 処理済みレコードはロールバックされない
   *
   * @param jobId - 中断対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns 更新されたジョブ情報
   * @throws {Error} 応答がジョブ情報の形式でない場合
   */
  const abort = (jobId: string, callOptions?: CallOptions): Promise<IngestJobInfo> =>
    patchState(jobId, 'Aborted', callOptions);

  /**
   * ジョブを削除する（Aborted 状態のジョブのみ削除可能）
   * @param jobId - 削除対象ジョブ ID
   * @param callOptions - 中断シグナル等
   */
  const deleteJob = async (jobId: string, callOptions?: CallOptions): Promise<void> => {
    await client.delete(`/jobs/ingest/${jobId}`, { signal: callOptions?.signal });
  };

  /**
   * ジョブ情報を取得する
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns ジョブ情報
   * @throws {Error} 応答がジョブ情報の形式でない場合
   */
  const getJob = async (jobId: string, callOptions?: CallOptions): Promise<IngestJobInfo> =>
    toIngestJob(
      await client.get(`/jobs/ingest/${jobId}`, undefined, { signal: callOptions?.signal }),
    );

  /**
   * Ingest ジョブ一覧を取得する
   * @param options - フィルター条件
   * @param callOptions - 中断シグナル等
   * @returns ジョブ一覧
   * @throws {Error} 応答がジョブ一覧の形式でない場合
   */
  const listJobs = async (
    options?: ListIngestJobsOptions,
    callOptions?: CallOptions,
  ): Promise<ListIngestJobsResponse> =>
    toJobList(
      // { ...undefined } は空オブジェクトになるため options が undefined でも安全
      await client.get('/jobs/ingest', { ...options }, { signal: callOptions?.signal }),
      toIngestJob,
      INGEST_LABEL,
    );

  const getCsv = async (path: string, callOptions?: CallOptions): Promise<string> =>
    toCsv(await client.get(path, undefined, { signal: callOptions?.signal }));

  /**
   * 処理成功レコードの結果 CSV を取得する
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns CSV 文字列
   * @throws {Error} 応答が CSV でない場合
   */
  const getSuccessfulResults = (jobId: string, callOptions?: CallOptions): Promise<string> =>
    getCsv(`/jobs/ingest/${jobId}/successfulResults`, callOptions);

  /**
   * 処理失敗レコードの結果 CSV を取得する（sf__Error, sf__Id 列を含む）
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns CSV 文字列
   * @throws {Error} 応答が CSV でない場合
   */
  const getFailedResults = (jobId: string, callOptions?: CallOptions): Promise<string> =>
    getCsv(`/jobs/ingest/${jobId}/failedResults`, callOptions);

  /**
   * 未処理レコードの CSV を取得する
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns CSV 文字列
   * @throws {Error} 応答が CSV でない場合
   */
  const getUnprocessedRecords = (jobId: string, callOptions?: CallOptions): Promise<string> =>
    getCsv(`/jobs/ingest/${jobId}/unprocessedrecords`, callOptions);

  /**
   * ジョブが完了状態になるまでポーリングして待機する
   *
   * @param jobId - 待機対象ジョブ ID
   * @param options - timeoutMs（既定 300_000）・intervalMs（既定 10_000）・signal
   *   （中断してもジョブ自体は止まらない。止めるなら abort を呼ぶ）
   * @returns 完了時のジョブ情報（state: JobComplete | Failed | Aborted）
   * @throws {TypeError} timeoutMs / intervalMs が不正な場合
   * @throws {Error} タイムアウトした場合
   * @throws signal が中断された場合、その理由（既定は AbortError）
   */
  const waitForCompletion = (jobId: string, options: WaitOptions = {}): Promise<IngestJobInfo> =>
    pollUntilTerminal(
      (callOptions) => getJob(jobId, callOptions),
      TERMINAL_INGEST_STATES,
      `BulkIngest ジョブ (${jobId})`,
      options,
    );

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
 * @returns Query ジョブ操作のオブジェクト
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
 * @remarks `.use()` 非対応。`SalesforceApiClientPlugins.bulkQuery(sfClient)` の形で直接呼び出す。
 *   bulkIngest と bulkQuery はメソッド名（createJob / getJob / abort 等）が衝突するため、
 *   クライアントへ合成せず独立したオブジェクトとして返す。
 *   各メソッドの末尾引数（callOptions / options）の signal で中断できる。
 */
const bulkQuery = (client: BaseClient): BulkQueryPlugin => {
  /**
   * Query ジョブを作成して即座に処理を開始する
   * @param options - クエリ文字列・操作種別等の設定
   * @param callOptions - 中断シグナル等
   * @returns 作成されたジョブ情報
   * @throws {Error} 応答がジョブ情報の形式でない場合
   */
  const createJob = async (
    options: CreateQueryJobOptions,
    callOptions?: CallOptions,
  ): Promise<QueryJobInfo> =>
    toQueryJob(await client.post('/jobs/query', options, { signal: callOptions?.signal }));

  /**
   * ジョブを中断する
   *
   * SF Bulk API v2 の仕様上、Query ジョブの中断と削除は同一エンドポイント（DELETE）を使用する。
   * Ingest ジョブの abort（PATCH）とは異なる点に注意。
   *
   * @param jobId - 中断対象ジョブ ID
   * @param callOptions - 中断シグナル等
   */
  const abort = async (jobId: string, callOptions?: CallOptions): Promise<void> => {
    await client.delete(`/jobs/query/${jobId}`, { signal: callOptions?.signal });
  };

  /**
   * ジョブを削除する
   *
   * SF Bulk API v2 の仕様上、Query ジョブの削除と中断は同一エンドポイント（DELETE）を使用する。
   * abort() と同じエンドポイントだが、用途に応じて使い分けること。
   *
   * @param jobId - 削除対象ジョブ ID
   * @param callOptions - 中断シグナル等
   */
  const deleteJob = async (jobId: string, callOptions?: CallOptions): Promise<void> => {
    await client.delete(`/jobs/query/${jobId}`, { signal: callOptions?.signal });
  };

  /**
   * ジョブ情報を取得する
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns ジョブ情報
   * @throws {Error} 応答がジョブ情報の形式でない場合
   */
  const getJob = async (jobId: string, callOptions?: CallOptions): Promise<QueryJobInfo> =>
    toQueryJob(
      await client.get(`/jobs/query/${jobId}`, undefined, { signal: callOptions?.signal }),
    );

  /**
   * Query ジョブ一覧を取得する
   * @param options - フィルター条件
   * @param callOptions - 中断シグナル等
   * @returns ジョブ一覧
   * @throws {Error} 応答がジョブ一覧の形式でない場合
   */
  const listJobs = async (
    options?: ListQueryJobsOptions,
    callOptions?: CallOptions,
  ): Promise<ListQueryJobsResponse> =>
    toJobList(
      // { ...undefined } は空オブジェクトになるため options が undefined でも安全
      await client.get('/jobs/query', { ...options }, { signal: callOptions?.signal }),
      toQueryJob,
      QUERY_LABEL,
    );

  /**
   * クエリ結果 CSV を 1 ページ取得する（Partial Downloads / Winter '25 対応）
   *
   * Sforce-Locator レスポンスヘッダーを自動的にキャプチャして nextLocator に格納する。
   *
   * @param jobId - 取得対象ジョブ ID
   * @param options - maxRecords（最大取得件数）・locator（前回の nextLocator）・signal
   * @returns CSV 文字列と次ページのロケーター
   * @throws {Error} 応答が CSV でない場合
   */
  const getResults = async (
    jobId: string,
    options: GetResultsOptions = {},
  ): Promise<QueryResultsPage> => {
    let nextLocator: string | null = null;

    // Sforce-Locator レスポンスヘッダーをキャプチャするために transport をラップする。
    // SalesforceApiClient の responseHandler は response.body のみを返すため
    // ヘッダーは transport デコレータ層で取得する必要がある。
    // extend() は additionalMethods をリセットするが、capturingClient は .get() のみ使用するため問題ない。
    const capturingClient = client.extend((transport) => ({
      fetch: async (url: string, fetchOptions?: FetchOptions) => {
        const response = await transport.fetch(url, fetchOptions);
        // HTTP ヘッダーは RFC 7230 でケースインセンシティブなため、小文字正規化して検索する
        const locatorEntry = Object.entries(response.headers).find(
          ([name]) => name.toLowerCase() === 'sforce-locator',
        );
        const rawLocator = locatorEntry?.[1];
        nextLocator = typeof rawLocator === 'string' && rawLocator !== 'null' ? rawLocator : null;
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

    const csv = toCsv(
      await capturingClient.get(`/jobs/query/${jobId}/results`, query, {
        signal: options.signal,
      }),
    );
    return { csv, nextLocator };
  };

  /**
   * クエリ結果 CSV を全ページ取得して結合した文字列を返す
   *
   * Partial Downloads に対応し、全ページを順次取得してヘッダー行の重複を除去して結合する。
   * 名前に反して並列取得はしない（Salesforce にチャンク指定の取得 API が無いため、ページを逐次たどる）。
   *
   * @param jobId - 取得対象ジョブ ID
   * @param options - signal
   * @returns ヘッダー行 1 行 + 全データ行を結合した CSV 文字列
   * @throws {Error} 応答が CSV でない場合
   */
  const getResultsParallel = async (
    jobId: string,
    options: GetResultsParallelOptions = {},
  ): Promise<string> => {
    const pages: string[] = [];
    let locator: string | null = null;

    do {
      const page = await getResults(jobId, {
        signal: options.signal,
        ...(locator != null ? { locator } : {}),
      });
      pages.push(page.csv);
      locator = page.nextLocator;
    } while (locator !== null);

    return mergeCsvPages(pages);
  };

  /**
   * ジョブが完了状態になるまでポーリングして待機する
   *
   * @param jobId - 待機対象ジョブ ID
   * @param options - timeoutMs（既定 300_000）・intervalMs（既定 10_000）・signal
   *   （中断してもジョブ自体は止まらない。止めるなら abort を呼ぶ）
   * @returns 完了時のジョブ情報（state: JobComplete | Failed | Aborted）
   * @throws {TypeError} timeoutMs / intervalMs が不正な場合
   * @throws {Error} タイムアウトした場合
   * @throws signal が中断された場合、その理由（既定は AbortError）
   */
  const waitForCompletion = (jobId: string, options: WaitOptions = {}): Promise<QueryJobInfo> =>
    pollUntilTerminal(
      (callOptions) => getJob(jobId, callOptions),
      TERMINAL_QUERY_STATES,
      `BulkQuery ジョブ (${jobId})`,
      options,
    );

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
    // csv-parse は cast オプション未指定なら全フィールドを文字列で返す（columns: true でヘッダー名がキー）
    return parse<Record<string, string>>(csv, { columns: true, skip_empty_lines: true });
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
    const records = parse(csv, { columns: true, skip_empty_lines: true });
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
    const rows = parse(csv, { columns: false, to_line: 1 });
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
      const [headerRow, ...dataRows] = parse(csv, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
      });

      if (headerRow === undefined) {
        errors.push({ message: 'ヘッダー行がありません' });
        return {
          valid: false,
          errors,
          warnings,
          summary: { rowCount: 0, columnCount: 0, headers: [] },
        };
      }

      headers = headerRow;
      columnCount = headers.length;
      rowCount = dataRows.length;

      if (headers.some((h) => h === '')) {
        errors.push({ message: '空のヘッダー列が含まれています' });
      }

      const uniqueHeaders = new Set(headers);
      if (uniqueHeaders.size !== headers.length) {
        errors.push({ message: '重複したヘッダー列が含まれています' });
      }

      for (const [i, row] of dataRows.entries()) {
        if (row.length !== columnCount) {
          errors.push({
            row: i + 2,
            message: `列数がヘッダーと一致しません (expected: ${String(columnCount)}, actual: ${String(row.length)})`,
          });
        }
      }

      if (!headers.includes('Id')) {
        warnings.push({ message: 'Id 列がありません（update / upsert / delete 操作では必須）' });
      }

      if (rowCount === 0) {
        warnings.push({ message: 'データ行が 0 件です' });
      }

      if (rowCount > 150_000_000) {
        errors.push({
          message: `レコード数が Bulk API v2 の上限（1億5000万件）を超えています: ${String(rowCount)} 件`,
        });
      }
    } catch (e) {
      errors.push({ message: `CSV パースエラー: ${toError(e).message}` });
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
