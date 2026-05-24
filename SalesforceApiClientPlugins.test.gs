'use strict';

/**
 * SalesforceApiClientPlugins.test.gs
 *
 * @description SalesforceApiClientPlugins のテストスイート
 *
 * 実行方法:
 *   GAS エディタから runAllSalesforceApiClientPluginsTests() を実行
 *
 * 依存:
 *   - TestRunner (HttpClient.test.gs)
 *   - MockSfUrlFetchApp (SalesforceApiClient.test.gs)
 *   - SalesforceApiClient (SalesforceApiClient.gs)
 *   - SalesforceApiClientPlugins (SalesforceApiClientPlugins.gs)
 */

// ============================================================================
// Utilities モック（waitForCompletion ポーリングテスト用）
// ============================================================================

const MockUtilities = (function () {
  const setup = () => {
    const original = typeof Utilities !== 'undefined' ? Utilities : undefined;
    const sleepCalls = [];

    globalThis.Utilities = {
      sleep: (ms) => { sleepCalls.push(ms); }
    };

    return {
      getSleepCalls: () => sleepCalls,
      restore: () => {
        if (original === undefined) {
          delete globalThis.Utilities;
        } else {
          globalThis.Utilities = original;
        }
      }
    };
  };
  return { setup };
})();

// ============================================================================
// インターフェース確認
// ============================================================================

const runSfPluginsInterfaceTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('SalesforceApiClientPlugins インターフェース');

  test('SalesforceApiClientPlugins が定義されている', () => {
    assertTrue(typeof SalesforceApiClientPlugins === 'object');
  });

  test('soql / sobject / bulkIngest / bulkQuery / Utils が公開されている', () => {
    assertTrue(typeof SalesforceApiClientPlugins.soql === 'function');
    assertTrue(typeof SalesforceApiClientPlugins.sobject === 'function');
    assertTrue(typeof SalesforceApiClientPlugins.bulkIngest === 'function');
    assertTrue(typeof SalesforceApiClientPlugins.bulkQuery === 'function');
    assertTrue(typeof SalesforceApiClientPlugins.Utils === 'object');
  });

  test('bulkIngest が返すオブジェクトに必要なメソッドがある', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      assertTrue(typeof bulk.createJob === 'function');
      assertTrue(typeof bulk.upload === 'function');
      assertTrue(typeof bulk.close === 'function');
      assertTrue(typeof bulk.abort === 'function');
      assertTrue(typeof bulk.deleteJob === 'function');
      assertTrue(typeof bulk.getJob === 'function');
      assertTrue(typeof bulk.listJobs === 'function');
      assertTrue(typeof bulk.getSuccessfulResults === 'function');
      assertTrue(typeof bulk.getFailedResults === 'function');
      assertTrue(typeof bulk.getUnprocessedRecords === 'function');
      assertTrue(typeof bulk.waitForCompletion === 'function');
    } finally {
      fetchMock.restore();
    }
  });

  test('bulkQuery が返すオブジェクトに必要なメソッドがある', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      assertTrue(typeof bulk.createJob === 'function');
      assertTrue(typeof bulk.abort === 'function');
      assertTrue(typeof bulk.deleteJob === 'function');
      assertTrue(typeof bulk.getJob === 'function');
      assertTrue(typeof bulk.listJobs === 'function');
      assertTrue(typeof bulk.getResults === 'function');
      assertTrue(typeof bulk.getResultsParallel === 'function');
      assertTrue(typeof bulk.waitForCompletion === 'function');
    } finally {
      fetchMock.restore();
    }
  });
};

// ============================================================================
// Utils テスト
// ============================================================================

const runSfPluginsUtilsTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertFalse } = TestRunner;
  const U = SalesforceApiClientPlugins.Utils;

  suite('SalesforceApiClientPlugins.Utils');

  // --- csvToRecords ---

  test('csvToRecords: ヘッダー+データ行をオブジェクト配列に変換', () => {
    const csv = 'Id,Name\n001xxx,Acme\n002xxx,Beta';
    const records = U.csvToRecords(csv);
    assertEqual(records.length, 2);
    assertEqual(records[0].Id, '001xxx');
    assertEqual(records[0].Name, 'Acme');
    assertEqual(records[1].Id, '002xxx');
    assertEqual(records[1].Name, 'Beta');
  });

  test('csvToRecords: 空文字列は空配列を返す', () => {
    assertEqual(U.csvToRecords('').length, 0);
  });

  test('csvToRecords: ヘッダーのみは空配列を返す', () => {
    assertEqual(U.csvToRecords('Id,Name').length, 0);
  });

  test('csvToRecords: カンマを含むフィールドのクォート処理', () => {
    const csv = 'Id,Name\n001xxx,"Acme, Inc."';
    const records = U.csvToRecords(csv);
    assertEqual(records[0].Name, 'Acme, Inc.');
  });

  test('csvToRecords: 二重引用符エスケープの処理', () => {
    const csv = 'Id,Name\n001xxx,"Say ""Hello"""';
    const records = U.csvToRecords(csv);
    assertEqual(records[0].Name, 'Say "Hello"');
  });

  // --- recordsToCsv ---

  test('recordsToCsv: オブジェクト配列をCSV文字列に変換', () => {
    const records = [{ Id: '001', Name: 'Acme' }, { Id: '002', Name: 'Beta' }];
    const csv = U.recordsToCsv(records);
    assertEqual(csv, 'Id,Name\n001,Acme\n002,Beta');
  });

  test('recordsToCsv: 空配列は空文字列を返す', () => {
    assertEqual(U.recordsToCsv([]), '');
  });

  test('recordsToCsv: カンマを含む値をクォートする', () => {
    const records = [{ Id: '001', Name: 'Acme, Inc.' }];
    const csv = U.recordsToCsv(records);
    assertTrue(csv.includes('"Acme, Inc."'));
  });

  test('recordsToCsv: null / undefined を空文字列に変換する', () => {
    const records = [{ Id: null, Name: undefined }];
    const csv = U.recordsToCsv(records);
    assertEqual(csv, 'Id,Name\n,');
  });

  // --- csvRowCount ---

  test('csvRowCount: データ行数を返す（ヘッダー除く）', () => {
    const csv = 'Id,Name\n001,Acme\n002,Beta';
    assertEqual(U.csvRowCount(csv), 2);
  });

  test('csvRowCount: ヘッダーのみは 0', () => {
    assertEqual(U.csvRowCount('Id,Name'), 0);
  });

  test('csvRowCount: 空文字列は 0', () => {
    assertEqual(U.csvRowCount(''), 0);
  });

  // --- csvHeaders ---

  test('csvHeaders: ヘッダー列名の配列を返す', () => {
    const csv = 'Id,Name,Email\n001,Acme,a@b.com';
    const headers = U.csvHeaders(csv);
    assertEqual(headers.length, 3);
    assertEqual(headers[0], 'Id');
    assertEqual(headers[1], 'Name');
    assertEqual(headers[2], 'Email');
  });

  test('csvHeaders: 空文字列は空配列を返す', () => {
    assertEqual(U.csvHeaders('').length, 0);
  });

  // --- validateCsv ---

  test('validateCsv: 正常なCSVはvalid=true', () => {
    const csv = 'Id,Name\n001,Acme\n002,Beta';
    const result = U.validateCsv(csv);
    assertTrue(result.valid);
    assertEqual(result.errors.length, 0);
    assertEqual(result.summary.rowCount, 2);
    assertEqual(result.summary.columnCount, 2);
  });

  test('validateCsv: 空文字列はvalid=false（エラー: CSV が空）', () => {
    const result = U.validateCsv('');
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.message.includes('空')));
  });

  test('validateCsv: 重複ヘッダーはvalid=false', () => {
    const csv = 'Id,Id\n001,001';
    const result = U.validateCsv(csv);
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.message.includes('重複')));
  });

  test('validateCsv: 列数不一致はvalid=false', () => {
    const csv = 'Id,Name\n001';
    const result = U.validateCsv(csv);
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.message.includes('列数')));
  });

  test('validateCsv: Id列なしはwarningが追加される', () => {
    const csv = 'Name,Email\nAcme,a@b.com';
    const result = U.validateCsv(csv);
    assertTrue(result.valid);
    assertTrue(result.warnings.some(w => w.message.includes('Id 列')));
  });

  test('validateCsv: データ行0件はwarningが追加される', () => {
    const csv = 'Id,Name';
    const result = U.validateCsv(csv);
    assertTrue(result.valid);
    assertTrue(result.warnings.some(w => w.message.includes('0 件')));
  });

  // --- parseCsvRaw / csvToRecords CRLF / クォート内改行 (mi-6) ---

  test('csvToRecords: CRLF 区切りのCSVを正しくパースする', () => {
    const csv = 'Id,Name\r\n001xxx,Acme\r\n002xxx,Beta';
    const records = U.csvToRecords(csv);
    assertEqual(records.length, 2);
    assertEqual(records[0].Id, '001xxx');
    assertEqual(records[1].Id, '002xxx');
  });

  test('csvToRecords: クォートフィールド内の改行を正しくパースする', () => {
    const csv = 'Id,Note\n001xxx,"Line1\nLine2"';
    const records = U.csvToRecords(csv);
    assertEqual(records.length, 1);
    assertEqual(records[0].Note, 'Line1\nLine2');
  });
};

// ============================================================================
// bulkIngest テスト
// ============================================================================

const runSfPluginsBulkIngestTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('SalesforceApiClientPlugins.bulkIngest');

  test('createJob: POST /jobs/ingest にパラメータを送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'job001', state: 'Open', operation: 'insert', object: 'Account' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const job = bulk.createJob({ operation: 'insert', object: 'Account' });
      assertEqual(job.id, 'job001');
      assertEqual(job.state, 'Open');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/ingest'));
      assertEqual(call.options.method, 'POST');
    } finally {
      fetchMock.restore();
    }
  });

  test('upload: PUT /jobs/ingest/{jobId}/batches にCSVをrawBodyで送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 201, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const csv = 'Id,Name\n001xxx,Acme';
      bulk.upload('job001', csv);
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/ingest/job001/batches'));
      assertEqual(call.options.method, 'PUT');
      // rawBody で送られるためCSVがそのまま payload に入る（JSON.stringify されない）
      assertEqual(call.options.payload, csv);
      assertEqual(call.options.headers['Content-Type'], 'text/csv');
    } finally {
      fetchMock.restore();
    }
  });

  test('upload: JSON.stringify されていないこと（ダブルクォートで囲まれない）', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 201, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const csv = 'Id,Name\n001,Acme';
      bulk.upload('job001', csv);
      const payload = fetchMock.getCalls()[0].options.payload;
      // JSON 文字列化されると先頭が " になる
      assertTrue(!payload.startsWith('"'));
      assertTrue(payload.startsWith('Id,Name'));
    } finally {
      fetchMock.restore();
    }
  });

  test('close: PATCH /jobs/ingest/{jobId} で state=UploadComplete を送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'job001', state: 'UploadComplete' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const job = bulk.close('job001');
      assertEqual(job.state, 'UploadComplete');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/ingest/job001'));
      assertEqual(call.options.method, 'PATCH');
      assertTrue(call.options.payload.includes('UploadComplete'));
    } finally {
      fetchMock.restore();
    }
  });

  test('abort: PATCH /jobs/ingest/{jobId} で state=Aborted を送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'job001', state: 'Aborted' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const job = bulk.abort('job001');
      assertEqual(job.state, 'Aborted');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.options.payload.includes('Aborted'));
    } finally {
      fetchMock.restore();
    }
  });

  test('deleteJob: DELETE /jobs/ingest/{jobId} を送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 204, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      bulk.deleteJob('job001');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/ingest/job001'));
      assertEqual(call.options.method, 'DELETE');
    } finally {
      fetchMock.restore();
    }
  });

  test('getJob: GET /jobs/ingest/{jobId} でジョブ情報を取得する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'job001', state: 'InProgress' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const job = bulk.getJob('job001');
      assertEqual(job.id, 'job001');
      assertEqual(job.state, 'InProgress');
    } finally {
      fetchMock.restore();
    }
  });

  test('listJobs: GET /jobs/ingest でジョブ一覧を取得する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { records: [{ id: 'job001' }], done: true }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const result = bulk.listJobs();
      assertEqual(result.records.length, 1);
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/ingest'));
      assertTrue(!call.url.includes('/jobs/ingest/'));
    } finally {
      fetchMock.restore();
    }
  });

  test('getSuccessfulResults: GET /jobs/ingest/{jobId}/successfulResults でCSVを返す', () => {
    const csv = 'sf__Id,sf__Created,Id,Name\n001,true,001xxx,Acme';
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: csv });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const result = bulk.getSuccessfulResults('job001');
      assertEqual(result, csv);
    } finally {
      fetchMock.restore();
    }
  });

  test('getFailedResults: GET /jobs/ingest/{jobId}/failedResults でCSVを返す', () => {
    const csv = 'sf__Id,sf__Error,Id\n,REQUIRED_FIELD_MISSING,';
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: csv });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const result = bulk.getFailedResults('job001');
      assertEqual(result, csv);
    } finally {
      fetchMock.restore();
    }
  });

  test('getUnprocessedRecords: GET /jobs/ingest/{jobId}/unprocessedrecords でCSVを返す', () => {
    const csv = 'Id,Name\n001xxx,Acme';
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: csv });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const result = bulk.getUnprocessedRecords('job001');
      assertEqual(result, csv);
    } finally {
      fetchMock.restore();
    }
  });

  test('waitForCompletion: JobComplete 状態で即座に返す', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'job001', state: 'JobComplete' }
    });
    const utilsMock = MockUtilities.setup();
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const job = bulk.waitForCompletion('job001');
      assertEqual(job.state, 'JobComplete');
      assertEqual(utilsMock.getSleepCalls().length, 0);
    } finally {
      fetchMock.restore();
      utilsMock.restore();
    }
  });

  test('waitForCompletion: InProgress→JobComplete でポーリングして返す', () => {
    const fetchMock = MockSfUrlFetchApp.setup([
      { status: 200, body: { id: 'job001', state: 'InProgress' } },
      { status: 200, body: { id: 'job001', state: 'JobComplete' } }
    ]);
    const utilsMock = MockUtilities.setup();
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      const job = bulk.waitForCompletion('job001', { intervalMs: 100 });
      assertEqual(job.state, 'JobComplete');
      assertEqual(fetchMock.getCalls().length, 2);
      assertEqual(utilsMock.getSleepCalls().length, 1);
    } finally {
      fetchMock.restore();
      utilsMock.restore();
    }
  });

  test('waitForCompletion: タイムアウトで Error をスロー', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'job001', state: 'InProgress' }
    });
    const utilsMock = MockUtilities.setup();
    const origDateNow = Date.now;
    try {
      // 毎回100秒ずつ単調増加させる（常に時間が進む）
      let now = 0;
      Date.now = () => (now += 100_001);

      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      TestRunner.assertThrows(
        () => bulk.waitForCompletion('job001', { timeoutMs: 100_000 }),
        'タイムアウト'
      );
    } finally {
      Date.now = origDateNow;
      fetchMock.restore();
      utilsMock.restore();
    }
  });

  test('waitForCompletion: remaining < intervalMs のとき remaining 時間でスリープする', () => {
    const fetchMock = MockSfUrlFetchApp.setup([
      { status: 200, body: { id: 'job001', state: 'InProgress' } },
      { status: 200, body: { id: 'job001', state: 'InProgress' } },
      { status: 200, body: { id: 'job001', state: 'InProgress' } }
    ]);
    const utilsMock = MockUtilities.setup();
    const origDateNow = Date.now;
    try {
      // deadline=100ms, intervalMs=80ms
      // iter1: remaining=100-5=95  → sleep(min(80,95)=80)
      // iter2: remaining=100-95=5  → sleep(min(80,5)=5)  ← remaining < intervalMs
      // iter3: remaining=100-200≤0 → タイムアウト
      const times = [0, 5, 95, 200];
      let idx = 0;
      Date.now = () => times[Math.min(idx++, times.length - 1)];

      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkIngest(client);
      try {
        bulk.waitForCompletion('job001', { timeoutMs: 100, intervalMs: 80 });
      } catch (_) { /* タイムアウトは想定内 */ }

      const sleepCalls = utilsMock.getSleepCalls();
      assertEqual(sleepCalls[0], 80);
      assertEqual(sleepCalls[1], 5);
    } finally {
      Date.now = origDateNow;
      fetchMock.restore();
      utilsMock.restore();
    }
  });
};

// ============================================================================
// bulkQuery テスト
// ============================================================================

const runSfPluginsBulkQueryTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('SalesforceApiClientPlugins.bulkQuery');

  test('createJob: POST /jobs/query にパラメータを送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'qjob001', state: 'UploadComplete', operation: 'query' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const job = bulk.createJob({ operation: 'query', query: 'SELECT Id FROM Account' });
      assertEqual(job.id, 'qjob001');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/query'));
      assertEqual(call.options.method, 'POST');
    } finally {
      fetchMock.restore();
    }
  });

  test('abort: DELETE /jobs/query/{jobId} を送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 204, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      bulk.abort('qjob001');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/query/qjob001'));
      assertEqual(call.options.method, 'DELETE');
    } finally {
      fetchMock.restore();
    }
  });

  test('deleteJob: DELETE /jobs/query/{jobId} を送信する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 204, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      bulk.deleteJob('qjob001');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/jobs/query/qjob001'));
      assertEqual(call.options.method, 'DELETE');
    } finally {
      fetchMock.restore();
    }
  });

  test('getJob: GET /jobs/query/{jobId} でジョブ情報を取得する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'qjob001', state: 'JobComplete' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const job = bulk.getJob('qjob001');
      assertEqual(job.id, 'qjob001');
      assertEqual(job.state, 'JobComplete');
    } finally {
      fetchMock.restore();
    }
  });

  test('listJobs: GET /jobs/query でジョブ一覧を取得する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { records: [{ id: 'qjob001' }], done: true }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const result = bulk.listJobs();
      assertEqual(result.records.length, 1);
      assertTrue(fetchMock.getCalls()[0].url.includes('/jobs/query'));
    } finally {
      fetchMock.restore();
    }
  });

  test('getResults: CSV と nextLocator=null を返す（ヘッダーなし時）', () => {
    const csv = 'Id,Name\n001xxx,Acme';
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: csv,
      headers: {}
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const page = bulk.getResults('qjob001');
      assertEqual(page.csv, csv);
      assertEqual(page.nextLocator, null);
    } finally {
      fetchMock.restore();
    }
  });

  test('getResults: Sforce-Locator ヘッダーがあれば nextLocator に格納される', () => {
    const csv = 'Id,Name\n001xxx,Acme';
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: csv,
      headers: { 'Sforce-Locator': 'MTAwMDA=' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const page = bulk.getResults('qjob001');
      assertEqual(page.nextLocator, 'MTAwMDA=');
    } finally {
      fetchMock.restore();
    }
  });

  test('getResults: Sforce-Locator が "null" の場合は nextLocator=null', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: 'Id,Name\n001xxx,Acme',
      headers: { 'Sforce-Locator': 'null' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const page = bulk.getResults('qjob001');
      assertEqual(page.nextLocator, null);
    } finally {
      fetchMock.restore();
    }
  });

  test('getResults: maxRecords / locator クエリパラメータが URL に含まれる', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: 'Id\n001',
      headers: {}
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      bulk.getResults('qjob001', { maxRecords: 1000, locator: 'abc123' });
      const url = fetchMock.getCalls()[0].url;
      assertTrue(url.includes('maxRecords=1000'));
      assertTrue(url.includes('locator=abc123'));
    } finally {
      fetchMock.restore();
    }
  });

  test('getResultsParallel: 1ページのみの場合そのまま返す', () => {
    const csv = 'Id,Name\n001xxx,Acme';
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: csv,
      headers: {}
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const result = bulk.getResultsParallel('qjob001');
      assertEqual(result, csv);
      assertEqual(fetchMock.getCalls().length, 1);
    } finally {
      fetchMock.restore();
    }
  });

  test('getResultsParallel: 複数ページをヘッダー重複除去して結合する', () => {
    const page1 = 'Id,Name\n001xxx,Acme';
    const page2 = 'Id,Name\n002xxx,Beta';
    const fetchMock = MockSfUrlFetchApp.setup([
      { status: 200, body: page1, headers: { 'Sforce-Locator': 'loc2' } },
      { status: 200, body: page2, headers: {} }
    ]);
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const result = bulk.getResultsParallel('qjob001');
      assertEqual(result, 'Id,Name\n001xxx,Acme\n002xxx,Beta');
      assertEqual(fetchMock.getCalls().length, 2);
    } finally {
      fetchMock.restore();
    }
  });

  test('waitForCompletion: JobComplete で即座に返す', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'qjob001', state: 'JobComplete' }
    });
    const utilsMock = MockUtilities.setup();
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const job = bulk.waitForCompletion('qjob001');
      assertEqual(job.state, 'JobComplete');
      assertEqual(utilsMock.getSleepCalls().length, 0);
    } finally {
      fetchMock.restore();
      utilsMock.restore();
    }
  });

  test('waitForCompletion: InProgress→JobComplete でポーリングして返す', () => {
    const fetchMock = MockSfUrlFetchApp.setup([
      { status: 200, body: { id: 'qjob001', state: 'InProgress' } },
      { status: 200, body: { id: 'qjob001', state: 'JobComplete' } }
    ]);
    const utilsMock = MockUtilities.setup();
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      const job = bulk.waitForCompletion('qjob001', { intervalMs: 100 });
      assertEqual(job.state, 'JobComplete');
      assertEqual(fetchMock.getCalls().length, 2);
      assertEqual(utilsMock.getSleepCalls().length, 1);
    } finally {
      fetchMock.restore();
      utilsMock.restore();
    }
  });

  test('waitForCompletion: タイムアウトで Error をスロー', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { id: 'qjob001', state: 'InProgress' }
    });
    const utilsMock = MockUtilities.setup();
    const origDateNow = Date.now;
    try {
      // 毎回100秒ずつ単調増加させる（常に時間が進む）
      let now = 0;
      Date.now = () => (now += 100_001);

      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      TestRunner.assertThrows(
        () => bulk.waitForCompletion('qjob001', { timeoutMs: 100_000 }),
        'タイムアウト'
      );
    } finally {
      Date.now = origDateNow;
      fetchMock.restore();
      utilsMock.restore();
    }
  });

  test('waitForCompletion: remaining < intervalMs のとき remaining 時間でスリープする', () => {
    const fetchMock = MockSfUrlFetchApp.setup([
      { status: 200, body: { id: 'qjob001', state: 'InProgress' } },
      { status: 200, body: { id: 'qjob001', state: 'InProgress' } },
      { status: 200, body: { id: 'qjob001', state: 'InProgress' } }
    ]);
    const utilsMock = MockUtilities.setup();
    const origDateNow = Date.now;
    try {
      // deadline=100ms, intervalMs=80ms
      // iter1: remaining=100-5=95  → sleep(min(80,95)=80)
      // iter2: remaining=100-95=5  → sleep(min(80,5)=5)  ← remaining < intervalMs
      // iter3: remaining=100-200≤0 → タイムアウト
      const times = [0, 5, 95, 200];
      let idx = 0;
      Date.now = () => times[Math.min(idx++, times.length - 1)];

      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
      const bulk = SalesforceApiClientPlugins.bulkQuery(client);
      try {
        bulk.waitForCompletion('qjob001', { timeoutMs: 100, intervalMs: 80 });
      } catch (_) { /* タイムアウトは想定内 */ }

      const sleepCalls = utilsMock.getSleepCalls();
      assertEqual(sleepCalls[0], 80);
      assertEqual(sleepCalls[1], 5);
    } finally {
      Date.now = origDateNow;
      fetchMock.restore();
      utilsMock.restore();
    }
  });
};

// ============================================================================
// soql / sobject プラグインテスト（.use() パターン）
// ============================================================================

const runSfPluginsSoqlSobjectTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('SalesforceApiClientPlugins.soql / sobject');

  test('soql().query: SOQL を実行して結果を返す', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { totalSize: 1, done: true, records: [{ Id: '001', Name: 'Acme' }] }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok')
        .use(SalesforceApiClientPlugins.soql());
      const result = client.query('SELECT Id, Name FROM Account LIMIT 1');
      assertEqual(result.totalSize, 1);
      assertEqual(result.records[0].Name, 'Acme');
    } finally {
      fetchMock.restore();
    }
  });

  test('soql().queryAll: 全ページを辿って全レコードを返す', () => {
    const fetchMock = MockSfUrlFetchApp.setup([
      {
        status: 200,
        body: {
          totalSize: 2, done: false,
          records: [{ Id: '001' }],
          nextRecordsUrl: '/services/data/v60.0/query/01gxxx-2000'
        }
      },
      {
        status: 200,
        body: { totalSize: 2, done: true, records: [{ Id: '002' }] }
      }
    ]);
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok')
        .use(SalesforceApiClientPlugins.soql());
      const records = client.queryAll('SELECT Id FROM Account');
      assertEqual(records.length, 2);
      assertEqual(records[0].Id, '001');
      assertEqual(records[1].Id, '002');
    } finally {
      fetchMock.restore();
    }
  });

  test('sobject().findById: GET /sobjects/{type}/{id} でレコードを取得する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { Id: '001xxx', Name: 'Acme' }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok')
        .use(SalesforceApiClientPlugins.sobject('Account'));
      const rec = client.findById('001xxx');
      assertEqual(rec.Id, '001xxx');
      assertTrue(fetchMock.getCalls()[0].url.includes('/sobjects/Account/001xxx'));
    } finally {
      fetchMock.restore();
    }
  });

  test('sobject().create: POST /sobjects/{type} でレコードを作成する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 201,
      body: { id: '001xxx', success: true }
    });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok')
        .use(SalesforceApiClientPlugins.sobject('Account'));
      const result = client.create({ Name: 'Acme' });
      assertEqual(result.id, '001xxx');
      assertTrue(result.success);
    } finally {
      fetchMock.restore();
    }
  });

  test('sobject().update: PATCH /sobjects/{type}/{id} でレコードを更新する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 204, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok')
        .use(SalesforceApiClientPlugins.sobject('Account'));
      client.update('001xxx', { Name: 'New Name' });
      const call = fetchMock.getCalls()[0];
      assertEqual(call.options.method, 'PATCH');
      assertTrue(call.url.includes('/sobjects/Account/001xxx'));
    } finally {
      fetchMock.restore();
    }
  });

  test('sobject().delete: DELETE /sobjects/{type}/{id} でレコードを削除する', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 204, body: '' });
    try {
      const client = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok')
        .use(SalesforceApiClientPlugins.sobject('Account'));
      client.delete('001xxx');
      const call = fetchMock.getCalls()[0];
      assertEqual(call.options.method, 'DELETE');
      assertTrue(call.url.includes('/sobjects/Account/001xxx'));
    } finally {
      fetchMock.restore();
    }
  });
};

// ============================================================================
// メイン実行関数
// ============================================================================

function runAllSalesforceApiClientPluginsTests() {
  TestRunner.reset();

  console.log('Running SalesforceApiClientPlugins インターフェース tests...');
  runSfPluginsInterfaceTests();

  console.log('Running SalesforceApiClientPlugins.Utils tests...');
  runSfPluginsUtilsTests();

  console.log('Running SalesforceApiClientPlugins.bulkIngest tests...');
  runSfPluginsBulkIngestTests();

  console.log('Running SalesforceApiClientPlugins.bulkQuery tests...');
  runSfPluginsBulkQueryTests();

  console.log('Running SalesforceApiClientPlugins.soql / sobject tests...');
  runSfPluginsSoqlSobjectTests();

  return TestRunner.run();
}
