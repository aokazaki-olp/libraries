'use strict';

/**
 * SalesforceApiClientPlugins.gs
 *
 * @description Salesforce REST API / Bulk API v2 用プラグインセット。
 *              SalesforceApiClient.create() で生成したクライアントに対して
 *              SOQL / sObject CRUD / Bulk API v2 操作を追加する。
 *
 * 使用例（Bulk API v2 Ingest）:
 *   const sfClient = SalesforceApiClient.create(instanceUrl, token);
 *   const bulk = SalesforceApiClientPlugins.bulkIngest(sfClient);
 *   const job  = bulk.createJob({ operation: 'insert', object: 'Account' });
 *   bulk.upload(job.id, csvString);
 *   bulk.close(job.id);
 *   const done = bulk.waitForCompletion(job.id);
 *   const ok   = bulk.getSuccessfulResults(job.id); // CSV文字列
 *
 * 使用例（Bulk API v2 Query）:
 *   const sfClient = SalesforceApiClient.create(instanceUrl, token);
 *   const query = SalesforceApiClientPlugins.bulkQuery(sfClient);
 *   const job   = query.createJob({ operation: 'query', query: 'SELECT Id FROM Account' });
 *   const done  = query.waitForCompletion(job.id);
 *   const page  = query.getResults(job.id);            // { csv, nextLocator }
 *   const full  = query.getResultsParallel(job.id);    // 全ページ結合CSV
 *
 * ⚠️ GAS実行時間制限について
 * waitForCompletion() はポーリングにより完了を待機する。GAS の実行時間上限
 * （標準: 6分 / GWS: 30分）内に処理が完了しない場合タイムアウトエラーが発生する。
 * 大量レコード（目安: 標準GAS=1万件超、GWS=20万件超）を扱う場合は、
 * PropertiesService と時間ベーストリガーを組み合わせた分割実行を検討すること。
 *
 * ⚠️ Abort について
 * abortJob() でジョブを中断しても処理済みレコードはロールバックされない。
 * Bulk API v2 は逐次コミットであり、中断前に処理されたレコードは
 * すでに Salesforce に反映されている。
 *
 * ⚠️ Events について
 * Bulk API v2 Events（ジョブ状態変化イベント購読）は GAS 環境の制約上、未対応。
 * ポーリングによる状態監視（waitForCompletion）を使用すること。
 *
 * ⚠️ Parallel Downloads について
 * getResultsParallel() は全ページを逐次取得して結合する。
 * GAS はシングルスレッド環境のため真の並列ダウンロードは行わない。
 */

if (typeof SalesforceApiClient === 'undefined' || typeof SalesforceApiClient.create !== 'function') {
  throw new Error('[SalesforceApiClientPlugins] SalesforceApiClient が定義されていません。SalesforceApiClient.gs を先に読み込んでください。');
}

const SalesforceApiClientPlugins = (() => {

  // ============================================================================
  // 内部定数・ヘルパー
  // ============================================================================

  const TERMINAL_INGEST_STATES = Object.freeze(['JobComplete', 'Failed', 'Aborted']);
  const TERMINAL_QUERY_STATES = Object.freeze(['JobComplete', 'Failed', 'Aborted']);

  /**
   * 複数 CSV ページを結合する（先頭ページのヘッダー行を保持し、以降のヘッダー行を除去）
   *
   * @param {string[]} pages CSV ページの配列
   * @returns {string} 結合されたCSV文字列
   */
  const mergeCsvPages = pages => {
    if (pages.length === 0) {
      return '';
    }
    if (pages.length === 1) {
      return pages[0];
    }
    // 末尾の \r?\n を除去してから結合する（末尾改行による空行挿入を防ぐ）
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
  // CSV ユーティリティ（RFC4180 準拠）
  // ============================================================================

  /**
   * RFC4180 CSV パーサー
   * クォートフィールド（カンマ・改行・エスケープ引用符を含む）に対応する。
   *
   * @param {string} csv CSV文字列
   * @returns {string[][]} 行×列の2次元配列
   */
  const parseCsvRaw = csv => {
    const records = [];
    let currentRecord = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < csv.length) {
      const ch = csv[i];

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < csv.length && csv[i + 1] === '"') {
            currentField += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          currentField += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          currentRecord.push(currentField);
          currentField = '';
          i++;
        } else if (ch === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') {
          currentRecord.push(currentField);
          records.push(currentRecord);
          currentRecord = [];
          currentField = '';
          i += 2;
        } else if (ch === '\n') {
          currentRecord.push(currentField);
          records.push(currentRecord);
          currentRecord = [];
          currentField = '';
          i++;
        } else {
          currentField += ch;
          i++;
        }
      }
    }

    if (currentField !== '' || currentRecord.length > 0) {
      currentRecord.push(currentField);
      records.push(currentRecord);
    }

    return records;
  };

  /**
   * CSV フィールドを RFC4180 形式にシリアライズする
   *
   * @param {*} v 値
   * @returns {string} シリアライズされたフィールド文字列
   */
  const serializeCsvField = v => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  // ============================================================================
  // Utils
  // ============================================================================

  /**
   * Bulk API v2 CSV ユーティリティ
   * Salesforce Bulk API v2 が扱う CSV（RFC4180 準拠・ヘッダー行あり）の
   * パース・生成・検証を提供する。
   */
  const Utils = Object.freeze({

    /**
     * CSV 文字列をオブジェクト配列に変換する
     *
     * @param {string} csv ヘッダー行付き RFC4180 CSV 文字列
     * @returns {Object[]} レコードの配列
     */
    csvToRecords(csv) {
      if (!csv || csv.trim() === '') {
        return [];
      }
      const rows = parseCsvRaw(csv.trim());
      if (rows.length < 2) {
        return [];
      }
      const headers = rows[0];
      return rows.slice(1)
        .filter(row => row.some(cell => cell !== ''))
        .map(row => {
          const record = {};
          for (let j = 0; j < headers.length; j++) {
            record[headers[j]] = row[j] ?? '';
          }
          return record;
        });
    },

    /**
     * オブジェクト配列を CSV 文字列に変換する
     *
     * @param {Object[]} records レコードの配列
     * @returns {string} ヘッダー行付き RFC4180 CSV 文字列
     */
    recordsToCsv(records) {
      if (!records || records.length === 0) {
        return '';
      }
      const headers = Object.keys(records[0]);
      const headerRow = headers.map(serializeCsvField).join(',');
      const dataRows = records.map(record =>
        headers.map(h => serializeCsvField(record[h])).join(',')
      );
      return [headerRow, ...dataRows].join('\n');
    },

    /**
     * CSV のデータ行数を返す（ヘッダー行を除く）
     *
     * @param {string} csv RFC4180 CSV 文字列
     * @returns {number} データ行数
     */
    csvRowCount(csv) {
      if (!csv || csv.trim() === '') {
        return 0;
      }
      const rows = parseCsvRaw(csv.trim());
      const dataRows = rows.slice(1).filter(row => row.some(cell => cell !== ''));
      return dataRows.length;
    },

    /**
     * CSV のヘッダー列名の配列を返す
     *
     * @param {string} csv RFC4180 CSV 文字列
     * @returns {string[]} ヘッダー列名の配列
     */
    csvHeaders(csv) {
      if (!csv || csv.trim() === '') {
        return [];
      }
      const rows = parseCsvRaw(csv.trim());
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
     * @param {string} csv 検証対象の CSV 文字列
     * @returns {{ valid: boolean, errors: Object[], warnings: Object[], summary: Object }} 検証結果
     */
    validateCsv(csv) {
      const errors = [];
      const warnings = [];

      if (!csv || csv.trim() === '') {
        return {
          valid: false,
          errors: [{ message: 'CSV が空です' }],
          warnings: [],
          summary: { rowCount: 0, columnCount: 0, headers: [] }
        };
      }

      let headers = [];
      let rowCount = 0;
      let columnCount = 0;

      try {
        const rows = parseCsvRaw(csv.trim());

        if (rows.length === 0) {
          errors.push({ message: 'ヘッダー行がありません' });
          return { valid: false, errors, warnings, summary: { rowCount: 0, columnCount: 0, headers: [] } };
        }

        headers = rows[0];
        columnCount = headers.length;
        const dataRows = rows.slice(1).filter(row => row.some(cell => cell !== ''));
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
        errors.push({ message: `CSV パースエラー: ${e.message}` });
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        summary: { rowCount, columnCount, headers }
      };
    }
  });

  // ============================================================================
  // bulkIngest
  // ============================================================================

  /**
   * Bulk API v2 Ingest プラグイン
   *
   * .use() パターン非対応。SalesforceApiClientPlugins.bulkIngest(sfClient) の形で直接呼び出すこと。
   *
   * @param {Object} client SalesforceApiClient.create() で作成したクライアント
   * @returns {{ createJob, upload, close, abort, deleteJob, getJob, listJobs,
   *             getSuccessfulResults, getFailedResults, getUnprocessedRecords,
   *             waitForCompletion }}
   *
   * ⚠️ Abort はロールバックではない
   * abortJob() でジョブを中断しても処理済みレコードは Salesforce に反映済みとなる。
   */
  const bulkIngest = client => {

    /**
     * Ingest ジョブを作成する
     *
     * @param {{ operation: string, object: string, externalIdFieldName?: string,
     *           columnDelimiter?: string, lineEnding?: string }} options
     * @returns {Object} 作成されたジョブ情報
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const createJob = options => client.post('/jobs/ingest', options);

    /**
     * CSV データをアップロードする（Content-Type: text/csv）
     *
     * @param {string} jobId アップロード対象ジョブ ID
     * @param {string} csv RFC4180 形式の CSV 文字列（ヘッダー行必須）
     * @returns {void}
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const upload = (jobId, csv) => client.call({
      method: 'PUT',
      endpoint: `/jobs/ingest/${jobId}/batches`,
      rawBody: csv,
      headers: { 'Content-Type': 'text/csv' }
    });

    /**
     * ジョブをクローズしてデータ処理を開始する（state: UploadComplete）
     *
     * @param {string} jobId クローズ対象ジョブ ID
     * @returns {Object} 更新されたジョブ情報
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const close = jobId => client.patch(`/jobs/ingest/${jobId}`, { state: 'UploadComplete' });

    /**
     * ジョブを中断する（state: Aborted）
     *
     * ⚠️ 処理済みレコードはロールバックされない
     *
     * @param {string} jobId 中断対象ジョブ ID
     * @returns {Object} 更新されたジョブ情報
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const abort = jobId => client.patch(`/jobs/ingest/${jobId}`, { state: 'Aborted' });

    /**
     * ジョブを削除する（Aborted 状態のジョブのみ削除可能）
     *
     * @param {string} jobId 削除対象ジョブ ID
     * @returns {void}
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const deleteJob = jobId => client.delete(`/jobs/ingest/${jobId}`);

    /**
     * ジョブ情報を取得する
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @returns {Object} ジョブ情報
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getJob = jobId => client.get(`/jobs/ingest/${jobId}`);

    /**
     * Ingest ジョブ一覧を取得する
     *
     * @param {Object} [options] フィルター条件
     * @returns {Object} ジョブ一覧 { records, done, nextRecordsUrl }
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const listJobs = (options) => client.get('/jobs/ingest', options);

    /**
     * 処理成功レコードの結果 CSV を取得する
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @returns {string} CSV 文字列
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getSuccessfulResults = jobId => client.get(`/jobs/ingest/${jobId}/successfulResults`);

    /**
     * 処理失敗レコードの結果 CSV を取得する（sf__Error, sf__Id 列を含む）
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @returns {string} CSV 文字列
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getFailedResults = jobId => client.get(`/jobs/ingest/${jobId}/failedResults`);

    /**
     * 未処理レコードの CSV を取得する
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @returns {string} CSV 文字列
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getUnprocessedRecords = jobId => client.get(`/jobs/ingest/${jobId}/unprocessedrecords`);

    /**
     * ジョブが完了状態になるまでポーリングして待機する
     *
     * @param {string} jobId 待機対象ジョブ ID
     * @param {Object} [options]
     * @param {number} [options.timeoutMs=300000] タイムアウト（ミリ秒）
     * @param {number} [options.intervalMs=10000] ポーリング間隔（ミリ秒）
     * @returns {Object} 完了時のジョブ情報（state: JobComplete | Failed | Aborted）
     * @throws {Error} タイムアウトした場合
     */
    const waitForCompletion = (jobId, options = {}) => {
      const timeoutMs = options.timeoutMs ?? 300_000;
      const intervalMs = options.intervalMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;

      while (true) {
        const job = getJob(jobId);
        if (TERMINAL_INGEST_STATES.includes(job.state)) {
          return job;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`BulkIngest ジョブ (${jobId}) がタイムアウトしました (${timeoutMs}ms)`);
        }
        Utilities.sleep(Math.min(intervalMs, remaining));
      }
    };

    return Object.freeze({
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
      waitForCompletion
    });
  };

  // ============================================================================
  // bulkQuery
  // ============================================================================

  /**
   * Bulk API v2 Query プラグイン
   *
   * @remarks .use() パターン非対応。SalesforceApiClientPlugins.bulkQuery(sfClient) の形で直接呼び出すこと。
   * @param {Object} client SalesforceApiClient.create() で作成したクライアント
   * @returns {{ createJob, abort, deleteJob, getJob, listJobs,
   *             getResults, getResultsParallel, waitForCompletion }}
   */
  const bulkQuery = client => {

    /**
     * Query ジョブを作成して即座に処理を開始する
     *
     * @param {{ operation: string, query: string, columnDelimiter?: string, lineEnding?: string }} options
     * @returns {Object} 作成されたジョブ情報
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const createJob = options => client.post('/jobs/query', options);

    /**
     * ジョブを中断する
     *
     * SF Bulk API v2 の仕様上、Query ジョブの中断と削除は同一エンドポイント（DELETE）を使用する。
     * Ingest ジョブの abort（PATCH）とは異なる点に注意。
     *
     * @param {string} jobId 中断対象ジョブ ID
     * @returns {void}
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const abort = jobId => client.delete(`/jobs/query/${jobId}`);

    /**
     * ジョブを削除する
     *
     * SF Bulk API v2 の仕様上、Query ジョブの削除と中断は同一エンドポイント（DELETE）を使用する。
     * abort() と同じエンドポイントだが、用途に応じて使い分けること。
     *
     * @param {string} jobId 削除対象ジョブ ID
     * @returns {void}
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const deleteJob = jobId => client.delete(`/jobs/query/${jobId}`);

    /**
     * ジョブ情報を取得する
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @returns {Object} ジョブ情報
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getJob = jobId => client.get(`/jobs/query/${jobId}`);

    /**
     * Query ジョブ一覧を取得する
     *
     * @param {Object} [options] フィルター条件
     * @returns {Object} ジョブ一覧 { records, done, nextRecordsUrl }
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const listJobs = (options) => client.get('/jobs/query', options);

    /**
     * クエリ結果 CSV を 1 ページ取得する（Partial Downloads / Winter '25 対応）
     *
     * Sforce-Locator レスポンスヘッダーを自動的にキャプチャして nextLocator に格納する。
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @param {Object} [options]
     * @param {number} [options.maxRecords] 最大取得件数
     * @param {string} [options.locator] 前回レスポンスの nextLocator
     * @returns {{ csv: string, nextLocator: string|null }}
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getResults = (jobId, options = {}) => {
      let nextLocator = null;

      // Sforce-Locator ヘッダーをキャプチャするために transport をラップする。
      // GAS の transport デコレータ層では t.fetch() がまだ interpretResponse() を通していない
      // 生の UrlFetchApp.HTTPResponse を返すため getAllHeaders() が利用できる。
      // （withRetry / withLogger は pass-through のみで変換しない）
      // extend() は additionalMethods をリセットするが、capturingClient は .get() のみ使用するため問題ない。
      const capturingClient = client.extend(t => ({
        fetch: (url, fetchOptions) => {
          const rawResponse = t.fetch(url, fetchOptions);
          // HTTP ヘッダーは RFC 7230 でケースインセンシティブなため、小文字正規化して検索する
          const allHeaders = rawResponse.getAllHeaders();
          const locatorKey = Object.keys(allHeaders).find(k => k.toLowerCase() === 'sforce-locator');
          const locatorHeader = locatorKey ? allHeaders[locatorKey] : null;
          nextLocator = (locatorHeader && locatorHeader !== 'null') ? locatorHeader : null;
          return rawResponse;
        }
      }));

      const query = {};
      if (options.maxRecords != null) {
        query.maxRecords = options.maxRecords;
      }
      if (options.locator != null) {
        query.locator = options.locator;
      }

      const csv = capturingClient.get(`/jobs/query/${jobId}/results`, query);
      return { csv, nextLocator };
    };

    /**
     * クエリ結果 CSV を全ページ取得して結合した文字列を返す
     *
     * ⚠️ GAS はシングルスレッド環境のため真の並列ダウンロードは行わない。
     * 全ページを逐次取得してヘッダー行の重複を除去して結合する。
     *
     * @param {string} jobId 取得対象ジョブ ID
     * @param {Object} [options] 将来用（現在は未使用）
     * @returns {string} ヘッダー行 1 行 + 全データ行を結合した CSV 文字列
     * @throws {Error} HTTP 非2xxレスポンス時
     */
    const getResultsParallel = (jobId, options = {}) => {
      const pages = [];
      let locator = null;

      do {
        const page = getResults(jobId, locator != null ? { locator } : {});
        pages.push(page.csv);
        locator = page.nextLocator;
      } while (locator !== null);

      return mergeCsvPages(pages);
    };

    /**
     * ジョブが完了状態になるまでポーリングして待機する
     *
     * @param {string} jobId 待機対象ジョブ ID
     * @param {Object} [options]
     * @param {number} [options.timeoutMs=300000] タイムアウト（ミリ秒）
     * @param {number} [options.intervalMs=10000] ポーリング間隔（ミリ秒）
     * @returns {Object} 完了時のジョブ情報（state: JobComplete | Failed | Aborted）
     * @throws {Error} タイムアウトした場合
     */
    const waitForCompletion = (jobId, options = {}) => {
      const timeoutMs = options.timeoutMs ?? 300_000;
      const intervalMs = options.intervalMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;

      while (true) {
        const job = getJob(jobId);
        if (TERMINAL_QUERY_STATES.includes(job.state)) {
          return job;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`BulkQuery ジョブ (${jobId}) がタイムアウトしました (${timeoutMs}ms)`);
        }
        Utilities.sleep(Math.min(intervalMs, remaining));
      }
    };

    return Object.freeze({
      createJob,
      abort,
      deleteJob,
      getJob,
      listJobs,
      getResults,
      getResultsParallel,
      waitForCompletion
    });
  };

  // ============================================================================
  // soql / sobject プラグイン（.use() 経由で利用）
  // ============================================================================

  /**
   * SOQL クエリプラグイン
   *
   * @returns {Function} プラグイン関数（client.use() に渡す）
   * @example
   *   const sf = SalesforceApiClient.create(url, token)
   *     .use(SalesforceApiClientPlugins.soql());
   *   const result = sf.query('SELECT Id FROM Account');
   */
  const soql = () => client => ({
    /**
     * SOQL クエリを実行する（最大 2000 件）
     *
     * @param {string} soql SOQL クエリ文字列
     * @returns {{ totalSize: number, done: boolean, records: Object[] }}
     */
    query: q => client.get('/query', { q }),

    /**
     * SOQL クエリを全件取得する（nextRecordsUrl を自動的に辿る）
     *
     * @param {string} soql SOQL クエリ文字列
     * @returns {Object[]} 全レコードの配列
     */
    queryAll: q => {
      const records = [];
      let result = client.get('/query', { q });
      records.push(...result.records);
      while (!result.done && result.nextRecordsUrl) {
        const relPath = result.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+/, '');
        result = client.get(relPath);
        records.push(...result.records);
      }
      return records;
    }
  });

  /**
   * sObject CRUD プラグイン
   *
   * @param {string} type sObject API 名 (例: 'Account', 'Contact')
   * @returns {Function} プラグイン関数（client.use() に渡す）
   * @example
   *   const sf = SalesforceApiClient.create(url, token)
   *     .use(SalesforceApiClientPlugins.sobject('Account'));
   *   const acc = sf.findById('001...');
   */
  const sobject = type => client => ({
    /**
     * @param {string} id Salesforce レコード ID (15桁 or 18桁)
     * @returns {Object} レコード
     */
    findById: id => client.get(`/sobjects/${type}/${id}`),

    /**
     * @param {Object} data 作成するレコードのフィールド値
     * @returns {{ id: string, success: boolean }}
     */
    create: data => client.post(`/sobjects/${type}`, data),

    /**
     * @param {string} id 更新対象のレコード ID
     * @param {Object} data 更新するフィールド値
     * @returns {void}
     */
    update: (id, data) => client.patch(`/sobjects/${type}/${id}`, data),

    /**
     * @param {string} id 削除対象のレコード ID
     * @returns {void}
     */
    delete: id => client.delete(`/sobjects/${type}/${id}`)
  });

  // ============================================================================
  // エクスポート
  // ============================================================================

  return Object.freeze({
    soql,
    sobject,
    bulkIngest,
    bulkQuery,
    Utils
  });

})();
