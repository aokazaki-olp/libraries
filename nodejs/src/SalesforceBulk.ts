/**
 * SalesforceBulk.ts
 *
 * @description Salesforce Bulk API v2（Ingest / Query）のクライアントと CSV ユーティリティ
 *
 * .use() では合成しない。bulkIngest と bulkQuery はメソッド名（createJob / getJob / abort 等）が
 * 衝突するため、SalesforceApiClient を渡して独立したオブジェクトとして受け取る。
 *
 * 使用例（Ingest）:
 *   const bulk = SalesforceBulk.bulkIngest(sfClient);
 *   const job  = await bulk.createJob({ operation: 'insert', object: 'Account' });
 *   await bulk.upload(job.id, csvString);
 *   await bulk.close(job.id);
 *   const done = await bulk.waitForCompletion(job.id);
 *   const succeededCsv = await bulk.getSuccessfulResults(job.id);
 *
 * 使用例（Query）:
 *   const query = SalesforceBulk.bulkQuery(sfClient);
 *   const job   = await query.createJob({ operation: 'query', query: 'SELECT Id FROM Account' });
 *   const done  = await query.waitForCompletion(job.id);
 *   const page  = await query.getResults(job.id);
 *   const full  = await query.getResultsParallel(job.id); // 全ページ結合
 *
 * ⚠️ 待機時間について
 * waitForCompletion() はポーリングで完了を待つ。timeoutMs（既定 5 分）を過ぎると Error になるが、
 * ジョブ自体は Salesforce 側で続く。実行時間に上限のある環境では、待たずに getJob() で状態を確かめる。
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

import type { BaseClient } from './ApiClient.ts';
import type { CallOptions, Decoder, FetchOptions, RawResponse } from './httpTypes.ts';
// Bulk API は CSV で入出力し、引用符・改行を含む値を正しく扱うには RFC 4180 準拠のパーサーが要る
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { MAX_TIMER_MS, sleep } from './shared/sleep.ts';
import { toError } from './shared/toError.ts';

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
   * タイムアウト（ミリ秒、デフォルト: 300_000 = 5分。Infinity で無期限）。
   * ポーリング間隔だけでなく、ジョブ情報の取得 1 回分にも掛かる
   */
  timeoutMs?: number;
  /** ポーリング間隔（ミリ秒、デフォルト: 10_000） */
  intervalMs?: number;
}

export interface ValidationError {
  row?: number;
  message: string;
  /** CSV のパースに失敗した場合、パーサーが投げた例外（行番号などの詳細を持つ） */
  cause?: Error;
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

/** bulkIngest() が返すクライアントの型 */
export interface BulkIngestClient {
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

/** bulkQuery() が返すクライアントの型 */
export interface BulkQueryClient {
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
    throw new Error(`${label} がジョブ情報の形式でない応答を返しました`, { cause: body });
  }
};

// 以下2つの as は、id と state を checkJobInfo で検査したうえで、残りのフィールドを
// Bulk API 2.0 Developer Guide の Job Info の Response Body の記載に基づいて型付けするもの
// （CODING_RULES.md §4.7。事前承認の枠に無いのでレビューで是非を問う）。
// 対象はジョブ情報を返すエンドポイントすべて: ジョブの作成（POST）・状態変更（PATCH。close / abort）・
// 取得（GET）と、一覧（GET /jobs/ingest・/jobs/query）の records の各要素

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
    throw new Error(`${label} がジョブ一覧の形式でない応答を返しました`, { cause: body });
  }
  return {
    records: records.map((record: unknown) => decodeJob(record)),
    done,
    ...withNextRecordsUrl(Reflect.get(body, 'nextRecordsUrl')),
  };
};

/**
 * CSV を返すエンドポイントを GET し、ボディを Transport が受けたままの文字列で返す
 *
 * responseHandler が返すのは JSON として解釈を試みた後の値で、1 列 0 行の CSV（`"Id"`）は
 * JSON 文字列として解釈され引用符が落ちる。そのため Transport を包んで生の text を拾う。
 * 応答ヘッダー（Sforce-Locator 等）も同じ経路で返す。
 *
 * extend() で作るクライアントは use() で足したメソッドを持たないが、ここでは call しか使わない。
 */
const fetchCsv = async (
  client: BaseClient,
  endpoint: string,
  query: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
): Promise<{ csv: string; headers: RawResponse['headers'] }> => {
  let captured: RawResponse | undefined;
  const capturingClient = client.extend((transport) => ({
    fetch: async (url: string, fetchOptions?: FetchOptions) => {
      captured = await transport.fetch(url, fetchOptions);
      return captured;
    },
  }));
  await capturingClient.call({ method: 'GET', endpoint, query, signal });
  if (captured === undefined) {
    // Transport を経由せずに応答が返ることは無いが、型では追えないので明示的に落とす
    throw new Error(`CSV の応答を受け取れませんでした (endpoint: ${endpoint})`);
  }
  return { csv: captured.text, headers: captured.headers };
};

/**
 * bulk 系に渡されたクライアントを検査する（.use() を経由しない直接呼び出しの境界）
 *
 * @throws {TypeError} call を持つクライアントでない場合
 */
const assertClient = (client: unknown): void => {
  const call: unknown = isObject(client) ? Reflect.get(client, 'call') : undefined;
  if (typeof call !== 'function') {
    throw new TypeError(
      'client には ApiClient のクライアント（call を持つもの）を指定してください',
    );
  }
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
  // 末尾の改行を除去してから、先頭ページの改行コードで結合する（末尾改行による空行挿入を防ぐ）。
  // 各ページのヘッダー行は最初の改行までとみなす（Salesforce が返すヘッダーは列名だけで改行を含まない）
  const newline = /\r\n/.test(first) ? '\r\n' : '\n';
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
  return parts.join(newline);
};

/**
 * waitForCompletion の待ち時間の設定を検査する（ポーリングを始める前に fail-fast させる）
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

/**
 * 残り時間で打ち切る signal を作る。無期限（Infinity）なら作らない
 *
 * 残りが 0 以下でも 1ms の signal を作る（待機の直後は残りがちょうど尽きていることが多く、
 * signal を付けないと応答の返らない取得が期限を無視して止まる）。
 * 残りがタイマーの上限を超える場合は上限で打ち切る（取得 1 回が約 24.8 日返らない場合だけ早めに切れる）。
 */
const deadlineSignal = (deadline: number): AbortSignal | undefined => {
  if (deadline === Infinity) {
    return undefined;
  }
  const remaining = Math.ceil(deadline - Date.now());
  return AbortSignal.timeout(Math.min(Math.max(remaining, 1), MAX_TIMER_MS));
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
// bulkIngest
// ============================================================================

/**
 * Bulk API v2 Ingest クライアント
 *
 * @param client - SalesforceApiClient.create() で作成したクライアント
 * @returns Ingest ジョブ操作のオブジェクト
 *
 * 典型的な使用フロー:
 * ```
 * const bulk = SalesforceBulk.bulkIngest(sfClient);
 * const job  = await bulk.createJob({ operation: 'insert', object: 'Account' });
 * await bulk.upload(job.id, csvString);   // Content-Type: text/csv で送信
 * await bulk.close(job.id);               // UploadComplete → 処理開始
 * const done = await bulk.waitForCompletion(job.id);
 * if (done.state === 'JobComplete') {
 *   const succeededCsv = await bulk.getSuccessfulResults(job.id);
 *   const failedCsv    = await bulk.getFailedResults(job.id);
 * }
 * ```
 *
 * ⚠️ Abort はロールバックではない
 * abort() でジョブを中断しても処理済みレコードは Salesforce に反映済みとなる。
 *
 * @remarks `.use()` 非対応。`SalesforceBulk.bulkIngest(sfClient)` の形で直接呼び出す。
 *   bulkIngest と bulkQuery はメソッド名（createJob / getJob / abort 等）が衝突するため、
 *   クライアントへ合成せず独立したオブジェクトとして返す。
 *   各メソッドの末尾引数 callOptions.signal で中断できる。
 */
const bulkIngest = (client: BaseClient): BulkIngestClient => {
  assertClient(client);
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
    toIngestJob(
      await client.call({
        method: 'POST',
        endpoint: '/jobs/ingest',
        body: options,
        signal: callOptions?.signal,
      }),
    );

  /**
   * CSV データをアップロードする（Content-Type: text/csv）
   * @param jobId - アップロード対象ジョブ ID
   * @param csv - RFC4180 形式の CSV 文字列（ヘッダー行必須）
   * @param callOptions - 中断シグナル等
   */
  const upload = async (jobId: string, csv: string, callOptions?: CallOptions): Promise<void> => {
    await client.call({
      method: 'PUT',
      endpoint: `/jobs/ingest/${encodeURIComponent(jobId)}/batches`,
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
      await client.call({
        method: 'PATCH',
        endpoint: `/jobs/ingest/${encodeURIComponent(jobId)}`,
        body: { state },
        signal: callOptions?.signal,
      }),
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
    await client.call({
      method: 'DELETE',
      endpoint: `/jobs/ingest/${encodeURIComponent(jobId)}`,
      signal: callOptions?.signal,
    });
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
      await client.call({
        method: 'GET',
        endpoint: `/jobs/ingest/${encodeURIComponent(jobId)}`,
        signal: callOptions?.signal,
      }),
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
      await client.call({
        method: 'GET',
        endpoint: '/jobs/ingest',
        query: { ...options },
        signal: callOptions?.signal,
      }),
      toIngestJob,
      INGEST_LABEL,
    );

  const getCsv = async (path: string, callOptions?: CallOptions): Promise<string> =>
    (await fetchCsv(client, path, undefined, callOptions?.signal)).csv;

  /**
   * 処理成功レコードの結果 CSV を取得する
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns CSV 文字列
   */
  const getSuccessfulResults = (jobId: string, callOptions?: CallOptions): Promise<string> =>
    getCsv(`/jobs/ingest/${encodeURIComponent(jobId)}/successfulResults`, callOptions);

  /**
   * 処理失敗レコードの結果 CSV を取得する（sf__Error, sf__Id 列を含む）
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns CSV 文字列
   */
  const getFailedResults = (jobId: string, callOptions?: CallOptions): Promise<string> =>
    getCsv(`/jobs/ingest/${encodeURIComponent(jobId)}/failedResults`, callOptions);

  /**
   * 未処理レコードの CSV を取得する
   * @param jobId - 取得対象ジョブ ID
   * @param callOptions - 中断シグナル等
   * @returns CSV 文字列
   */
  const getUnprocessedRecords = (jobId: string, callOptions?: CallOptions): Promise<string> =>
    getCsv(`/jobs/ingest/${encodeURIComponent(jobId)}/unprocessedrecords`, callOptions);

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
 * Bulk API v2 Query クライアント
 *
 * @param client - SalesforceApiClient.create() で作成したクライアント
 * @returns Query ジョブ操作のオブジェクト
 *
 * 典型的な使用フロー:
 * ```
 * const query = SalesforceBulk.bulkQuery(sfClient);
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
 * @remarks `.use()` 非対応。`SalesforceBulk.bulkQuery(sfClient)` の形で直接呼び出す。
 *   bulkIngest と bulkQuery はメソッド名（createJob / getJob / abort 等）が衝突するため、
 *   クライアントへ合成せず独立したオブジェクトとして返す。
 *   各メソッドの末尾引数（callOptions / options）の signal で中断できる。
 * @throws {TypeError} client が call を持つクライアントでない場合
 */
const bulkQuery = (client: BaseClient): BulkQueryClient => {
  assertClient(client);
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
    toQueryJob(
      await client.call({
        method: 'POST',
        endpoint: '/jobs/query',
        body: options,
        signal: callOptions?.signal,
      }),
    );

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
    await client.call({
      method: 'DELETE',
      endpoint: `/jobs/query/${encodeURIComponent(jobId)}`,
      signal: callOptions?.signal,
    });
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
    await client.call({
      method: 'DELETE',
      endpoint: `/jobs/query/${encodeURIComponent(jobId)}`,
      signal: callOptions?.signal,
    });
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
      await client.call({
        method: 'GET',
        endpoint: `/jobs/query/${encodeURIComponent(jobId)}`,
        signal: callOptions?.signal,
      }),
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
      await client.call({
        method: 'GET',
        endpoint: '/jobs/query',
        query: { ...options },
        signal: callOptions?.signal,
      }),
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
   */
  const getResults = async (
    jobId: string,
    options: GetResultsOptions = {},
  ): Promise<QueryResultsPage> => {
    const query: Record<string, unknown> = {};
    if (options.maxRecords != null) {
      query['maxRecords'] = options.maxRecords;
    }
    if (options.locator != null) {
      query['locator'] = options.locator;
    }

    const { csv, headers } = await fetchCsv(
      client,
      `/jobs/query/${encodeURIComponent(jobId)}/results`,
      query,
      options.signal,
    );
    // HTTP ヘッダー名は大文字小文字を区別しない（RFC 9110）ので小文字にそろえて探す
    const locatorEntry = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === 'sforce-locator',
    );
    const rawLocator = locatorEntry?.[1];
    const nextLocator = typeof rawLocator === 'string' && rawLocator !== 'null' ? rawLocator : null;
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
   */
  const getResultsParallel = async (
    jobId: string,
    options: GetResultsParallelOptions = {},
  ): Promise<string> => {
    const pages: string[] = [];
    const visited = new Set<string>();
    let locator: string | null = null;

    do {
      if (locator !== null) {
        // 同じロケーターが返り続けると終わらない
        if (visited.has(locator)) {
          throw new Error(`Sforce-Locator が同じ値を繰り返しました (locator: ${locator})`);
        }
        visited.add(locator);
      }
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
      const error = toError(e);
      errors.push({ message: `CSV パースエラー: ${error.message}`, cause: error });
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

export const SalesforceBulk = {
  bulkIngest,
  bulkQuery,
  Utils,
} as const;
