import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceApiClient } from '../src/SalesforceApiClient.js';
import { SalesforceApiClientPlugins } from '../src/plugins/salesforce.js';
import { makeTransport, makeRawResponse } from './helpers.js';
import type { IngestJobInfo, QueryJobInfo } from '../src/plugins/salesforce.js';

// ============================================================================
// テストユーティリティ
// ============================================================================

const BASE_URL = 'https://test.my.salesforce.com';
const TOKEN = 'test-token';

const makeIngestJob = (overrides: Partial<IngestJobInfo> = {}): IngestJobInfo => ({
  id: 'job001',
  state: 'Open',
  operation: 'insert',
  object: 'Account',
  createdById: 'user001',
  createdDate: '2026-01-01T00:00:00.000+0000',
  systemModstamp: '2026-01-01T00:00:00.000+0000',
  concurrencyMode: 'Parallel',
  contentType: 'CSV',
  apiVersion: 60,
  contentUrl: 'services/data/v60.0/jobs/ingest/job001/batches',
  jobType: 'V2Ingest',
  lineEnding: 'LF',
  columnDelimiter: 'COMMA',
  ...overrides,
});

const makeQueryJob = (overrides: Partial<QueryJobInfo> = {}): QueryJobInfo => ({
  id: 'qjob001',
  state: 'InProgress',
  operation: 'query',
  query: 'SELECT Id FROM Account',
  createdById: 'user001',
  createdDate: '2026-01-01T00:00:00.000+0000',
  systemModstamp: '2026-01-01T00:00:00.000+0000',
  concurrencyMode: 'Parallel',
  contentType: 'CSV',
  apiVersion: 60,
  jobType: 'V2Query',
  lineEnding: 'LF',
  columnDelimiter: 'COMMA',
  ...overrides,
});

const SAMPLE_CSV = 'Id,Name\n001xxx,Acme\n002xxx,Apex';

// ============================================================================
// bulkIngest
// ============================================================================

describe('SalesforceApiClientPlugins.bulkIngest — createJob', () => {
  it('POST /jobs/ingest にリクエストを送る', async () => {
    const job = makeIngestJob();
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ body: job })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const result = await bulk.createJob({ operation: 'insert', object: 'Account' });

    expect(transport.calls[0].url).toContain('/jobs/ingest');
    expect(transport.calls[0].options?.method).toBe('POST');
    expect(result.id).toBe('job001');
    expect(result.operation).toBe('insert');
  });
});

describe('SalesforceApiClientPlugins.bulkIngest — upload', () => {
  it('PUT /jobs/ingest/{id}/batches に Content-Type: text/csv で CSV を送る', async () => {
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ status: 201, body: null })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    await bulk.upload('job001', SAMPLE_CSV);

    const call = transport.calls[0];
    expect(call.url).toContain('/jobs/ingest/job001/batches');
    expect(call.options?.method).toBe('PUT');
    expect(call.options?.payload).toBe(SAMPLE_CSV);
    expect(call.options?.headers?.['Content-Type']).toBe('text/csv');
  });

  it('CSV を JSON.stringify せずに送る（生文字列）', async () => {
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ status: 201, body: null })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    await bulk.upload('job001', SAMPLE_CSV);

    // JSON.stringify されていれば先頭が " になる
    expect(transport.calls[0].options?.payload).not.toMatch(/^"/);
    expect(transport.calls[0].options?.payload).toContain('Id,Name');
  });
});

describe('SalesforceApiClientPlugins.bulkIngest — close / abort', () => {
  it('close() は PATCH で state: UploadComplete を送る', async () => {
    const job = makeIngestJob({ state: 'UploadComplete' });
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ body: job })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const result = await bulk.close('job001');

    const call = transport.calls[0];
    expect(call.options?.method).toBe('PATCH');
    expect(call.url).toContain('/jobs/ingest/job001');
    expect(JSON.parse(call.options?.payload as string)).toEqual({ state: 'UploadComplete' });
    expect(result.state).toBe('UploadComplete');
  });

  it('abort() は PATCH で state: Aborted を送る', async () => {
    const job = makeIngestJob({ state: 'Aborted' });
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ body: job })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    await bulk.abort('job001');

    expect(JSON.parse(transport.calls[0].options?.payload as string)).toEqual({ state: 'Aborted' });
  });
});

describe('SalesforceApiClientPlugins.bulkIngest — deleteJob / getJob / listJobs', () => {
  it('deleteJob() は DELETE リクエストを送る', async () => {
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ status: 204, body: null })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    await bulk.deleteJob('job001');

    expect(transport.calls[0].options?.method).toBe('DELETE');
    expect(transport.calls[0].url).toContain('/jobs/ingest/job001');
  });

  it('getJob() は GET リクエストを送る', async () => {
    const job = makeIngestJob({ state: 'JobComplete' });
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ body: job })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const result = await bulk.getJob('job001');

    expect(transport.calls[0].options?.method).toBe('GET');
    expect(result.state).toBe('JobComplete');
  });

  it('listJobs() は GET /jobs/ingest を送る', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: { records: [], done: true } })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const result = await bulk.listJobs();

    expect(transport.calls[0].url).toContain('/jobs/ingest');
    expect(result.done).toBe(true);
  });
});

describe('SalesforceApiClientPlugins.bulkIngest — 結果取得', () => {
  it('getSuccessfulResults() は CSV 文字列を返す', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: SAMPLE_CSV, text: SAMPLE_CSV })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const result = await bulk.getSuccessfulResults('job001');

    expect(transport.calls[0].url).toContain('/successfulResults');
    expect(result).toBe(SAMPLE_CSV);
  });

  it('getFailedResults() は /failedResults を呼ぶ', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: 'sf__Id,sf__Error\n001xxx,FIELD_REQUIRED' })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    await bulk.getFailedResults('job001');

    expect(transport.calls[0].url).toContain('/failedResults');
  });

  it('getUnprocessedRecords() は /unprocessedrecords を呼ぶ', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: SAMPLE_CSV })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    await bulk.getUnprocessedRecords('job001');

    expect(transport.calls[0].url).toContain('/unprocessedrecords');
  });
});

describe('SalesforceApiClientPlugins.bulkIngest — waitForCompletion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('JobComplete になるまでポーリングして返す', async () => {
    const jobs = [
      makeIngestJob({ state: 'InProgress' }),
      makeIngestJob({ state: 'InProgress' }),
      makeIngestJob({ state: 'JobComplete' }),
    ];
    let callIndex = 0;
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: jobs[Math.min(callIndex++, jobs.length - 1)] })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const promise = bulk.waitForCompletion('job001', { intervalMs: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.state).toBe('JobComplete');
    expect(transport.calls.length).toBe(3);
  });

  it('Aborted / Failed も終了状態として返す', async () => {
    for (const state of ['Aborted', 'Failed'] as const) {
      const transport = makeTransport(() =>
        Promise.resolve(makeRawResponse({ body: makeIngestJob({ state }) })),
      );
      const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
      const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

      const result = await bulk.waitForCompletion('job001');
      expect(result.state).toBe(state);
    }
  });

  it('タイムアウトしたら Error をスローする', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: makeIngestJob({ state: 'InProgress' }) })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const bulk = SalesforceApiClientPlugins.bulkIngest(sf);

    const promise = bulk.waitForCompletion('job001', { timeoutMs: 500, intervalMs: 100 });
    const assertion = expect(promise).rejects.toThrow('タイムアウト');
    await vi.runAllTimersAsync();
    await assertion;
  });
});

// ============================================================================
// bulkQuery
// ============================================================================

describe('SalesforceApiClientPlugins.bulkQuery — createJob', () => {
  it('POST /jobs/query にリクエストを送る', async () => {
    const job = makeQueryJob({ state: 'UploadComplete' });
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ body: job })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const result = await query.createJob({ operation: 'query', query: 'SELECT Id FROM Account' });

    expect(transport.calls[0].url).toContain('/jobs/query');
    expect(transport.calls[0].options?.method).toBe('POST');
    expect(result.operation).toBe('query');
  });
});

describe('SalesforceApiClientPlugins.bulkQuery — abort / deleteJob / getJob / listJobs', () => {
  it('abort() は DELETE リクエストを送る', async () => {
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ status: 204, body: null })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    await query.abort('qjob001');

    expect(transport.calls[0].options?.method).toBe('DELETE');
    expect(transport.calls[0].url).toContain('/jobs/query/qjob001');
  });

  it('getJob() は GET リクエストを送る', async () => {
    const job = makeQueryJob({ state: 'JobComplete' });
    const transport = makeTransport(() => Promise.resolve(makeRawResponse({ body: job })));
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const result = await query.getJob('qjob001');

    expect(result.state).toBe('JobComplete');
  });

  it('listJobs() は GET /jobs/query を呼ぶ', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: { records: [], done: true } })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    await query.listJobs();

    expect(transport.calls[0].url).toContain('/jobs/query');
  });
});

describe('SalesforceApiClientPlugins.bulkQuery — getResults', () => {
  it('CSV を返し nextLocator が null の場合（最終ページ）', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: SAMPLE_CSV, headers: { 'Sforce-Locator': 'null' } })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const result = await query.getResults('qjob001');

    expect(result.csv).toBe(SAMPLE_CSV);
    expect(result.nextLocator).toBeNull();
    expect(transport.calls[0].url).toContain('/jobs/query/qjob001/results');
  });

  it('Sforce-Locator ヘッダーがある場合 nextLocator を返す', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: SAMPLE_CSV, headers: { 'Sforce-Locator': 'LOCATOR_ABC' } })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const result = await query.getResults('qjob001');

    expect(result.nextLocator).toBe('LOCATOR_ABC');
  });

  it('maxRecords / locator クエリパラメータが URL に付与される', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: SAMPLE_CSV, headers: {} })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    await query.getResults('qjob001', { maxRecords: 1000, locator: 'LOC123' });

    expect(transport.calls[0].url).toContain('maxRecords=1000');
    expect(transport.calls[0].url).toContain('locator=LOC123');
  });
});

describe('SalesforceApiClientPlugins.bulkQuery — getResultsParallel', () => {
  it('1ページのみの場合はそのまま返す', async () => {
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: SAMPLE_CSV, headers: { 'Sforce-Locator': 'null' } })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const result = await query.getResultsParallel('qjob001');

    expect(result).toBe(SAMPLE_CSV);
    expect(transport.calls.length).toBe(1);
  });

  it('複数ページをヘッダー重複除去して結合する', async () => {
    const page1 = 'Id,Name\n001xxx,Acme';
    const page2 = 'Id,Name\n002xxx,Apex';
    let callCount = 0;
    const transport = makeTransport(() => {
      const locator = callCount === 0 ? 'LOC_NEXT' : 'null';
      const body = callCount === 0 ? page1 : page2;
      callCount++;
      return Promise.resolve(makeRawResponse({ body, headers: { 'Sforce-Locator': locator } }));
    });
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const result = await query.getResultsParallel('qjob001');

    // ヘッダー行は1行のみ、データ行は両ページ分
    expect(result).toBe('Id,Name\n001xxx,Acme\n002xxx,Apex');
    expect(transport.calls.length).toBe(2);
  });
});

describe('SalesforceApiClientPlugins.bulkQuery — waitForCompletion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('JobComplete になるまでポーリングして返す', async () => {
    const jobs = [
      makeQueryJob({ state: 'InProgress' }),
      makeQueryJob({ state: 'JobComplete' }),
    ];
    let idx = 0;
    const transport = makeTransport(() =>
      Promise.resolve(makeRawResponse({ body: jobs[Math.min(idx++, jobs.length - 1)] })),
    );
    const sf = SalesforceApiClient.create(BASE_URL, TOKEN, { transport });
    const query = SalesforceApiClientPlugins.bulkQuery(sf);

    const promise = query.waitForCompletion('qjob001', { intervalMs: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.state).toBe('JobComplete');
  });
});

// ============================================================================
// Utils
// ============================================================================

describe('SalesforceApiClientPlugins.Utils.csvToRecords', () => {
  it('CSV をオブジェクト配列に変換する', () => {
    const result = SalesforceApiClientPlugins.Utils.csvToRecords(SAMPLE_CSV);
    expect(result).toEqual([
      { Id: '001xxx', Name: 'Acme' },
      { Id: '002xxx', Name: 'Apex' },
    ]);
  });

  it('空文字は空配列を返す', () => {
    expect(SalesforceApiClientPlugins.Utils.csvToRecords('')).toEqual([]);
  });

  it('クォートされたフィールドを正しくパースする', () => {
    const csv = 'Id,Name\n001,"Acme, Corp"';
    const result = SalesforceApiClientPlugins.Utils.csvToRecords(csv);
    expect(result[0].Name).toBe('Acme, Corp');
  });
});

describe('SalesforceApiClientPlugins.Utils.recordsToCsv', () => {
  it('オブジェクト配列を CSV に変換する', () => {
    const records = [
      { Id: '001xxx', Name: 'Acme' },
      { Id: '002xxx', Name: 'Apex' },
    ];
    const result = SalesforceApiClientPlugins.Utils.recordsToCsv(records);
    expect(result).toContain('Id,Name');
    expect(result).toContain('001xxx,Acme');
  });

  it('カンマを含む値をクォートする', () => {
    const records = [{ Id: '001', Name: 'Acme, Corp' }];
    const result = SalesforceApiClientPlugins.Utils.recordsToCsv(records);
    expect(result).toContain('"Acme, Corp"');
  });
});

describe('SalesforceApiClientPlugins.Utils.csvRowCount', () => {
  it('ヘッダーを除くデータ行数を返す', () => {
    expect(SalesforceApiClientPlugins.Utils.csvRowCount(SAMPLE_CSV)).toBe(2);
  });

  it('ヘッダーのみ（データなし）は 0 を返す', () => {
    expect(SalesforceApiClientPlugins.Utils.csvRowCount('Id,Name')).toBe(0);
  });

  it('空文字は 0 を返す', () => {
    expect(SalesforceApiClientPlugins.Utils.csvRowCount('')).toBe(0);
  });
});

describe('SalesforceApiClientPlugins.Utils.csvHeaders', () => {
  it('ヘッダー列名の配列を返す', () => {
    expect(SalesforceApiClientPlugins.Utils.csvHeaders(SAMPLE_CSV)).toEqual(['Id', 'Name']);
  });

  it('空文字は空配列を返す', () => {
    expect(SalesforceApiClientPlugins.Utils.csvHeaders('')).toEqual([]);
  });
});

describe('SalesforceApiClientPlugins.Utils.validateCsv', () => {
  it('正常な CSV は valid: true を返す', () => {
    const result = SalesforceApiClientPlugins.Utils.validateCsv(SAMPLE_CSV);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.rowCount).toBe(2);
    expect(result.summary.headers).toEqual(['Id', 'Name']);
  });

  it('空文字は valid: false を返す', () => {
    const result = SalesforceApiClientPlugins.Utils.validateCsv('');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('空');
  });

  it('Id 列がない場合は warnings に含まれる', () => {
    const csv = 'Name,Email\nAcme,acme@example.com';
    const result = SalesforceApiClientPlugins.Utils.validateCsv(csv);
    expect(result.warnings.some(w => w.message.includes('Id'))).toBe(true);
  });

  it('列数が不一致の行は errors に含まれる', () => {
    const csv = 'Id,Name\n001xxx,Acme,Extra';
    const result = SalesforceApiClientPlugins.Utils.validateCsv(csv);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('列数'))).toBe(true);
  });

  it('データ行 0 件は warnings に含まれる', () => {
    const result = SalesforceApiClientPlugins.Utils.validateCsv('Id,Name');
    expect(result.warnings.some(w => w.message.includes('0 件'))).toBe(true);
  });

  it('summary に rowCount / columnCount / headers が含まれる', () => {
    const result = SalesforceApiClientPlugins.Utils.validateCsv(SAMPLE_CSV);
    expect(result.summary).toEqual({
      rowCount: 2,
      columnCount: 2,
      headers: ['Id', 'Name'],
    });
  });
});
