'use strict';

/**
 * InvoiceApiClient.test.gs
 *
 * @description InvoiceApiClient のテストスイート(GAS モック使用)
 *
 * 実行方法:
 *   GAS エディタから runAllInvoiceTests() を実行
 */

// ============================================================================
// GAS モック (UrlFetchApp グローバル差し替え)
// ============================================================================

const MockInvoiceUrlFetchApp = (function () {
  const setup = (responses) => {
    const original = typeof UrlFetchApp !== 'undefined' ? UrlFetchApp : undefined;
    const calls = [];
    let callIndex = 0;

    const responseList = Array.isArray(responses) ? responses : [responses];

    globalThis.UrlFetchApp = {
      fetch: (url, options) => {
        calls.push({ url, options });
        const r = responseList[Math.min(callIndex, responseList.length - 1)];
        callIndex++;
        return {
          getResponseCode: () => r.status ?? 200,
          getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}),
          getAllHeaders: () => r.headers ?? {}
        };
      }
    };

    return {
      getCalls: () => calls,
      restore: () => {
        if (original === undefined) {
          delete globalThis.UrlFetchApp;
        } else {
          globalThis.UrlFetchApp = original;
        }
      }
    };
  };

  return { setup };
})();

// ============================================================================
// テスト
// ============================================================================

const VALID_APP_ID = 'app-id-xxxxxxxx';
const INVOICE_BASE_URL = 'https://web-api.invoice-kohyo.nta.go.jp/1';

const runInvoiceInterfaceTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('InvoiceApiClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof InvoiceApiClient.create === 'function');
  });
};

const runInvoiceValidationTests = () => {
  const { suite, test, assertThrows } = TestRunner;

  suite('InvoiceApiClient バリデーション');

  test('applicationId が undefined だと TypeError', () => {
    assertThrows(() => InvoiceApiClient.create(), 'アプリケーション ID');
  });

  test('applicationId が null だと TypeError', () => {
    assertThrows(() => InvoiceApiClient.create(null), 'アプリケーション ID');
  });

  test('applicationId が空文字だと TypeError', () => {
    assertThrows(() => InvoiceApiClient.create(''), 'アプリケーション ID');
  });

  test('applicationId が数値だと TypeError', () => {
    assertThrows(() => InvoiceApiClient.create(123), 'アプリケーション ID');
  });

  test('applicationId が真偽値だと TypeError', () => {
    assertThrows(() => InvoiceApiClient.create(true), 'アプリケーション ID');
    assertThrows(() => InvoiceApiClient.create(false), 'アプリケーション ID');
  });

  test('applicationId がオブジェクトだと TypeError', () => {
    assertThrows(() => InvoiceApiClient.create({}), 'アプリケーション ID');
    assertThrows(() => InvoiceApiClient.create([]), 'アプリケーション ID');
  });

  test('未対応バージョン指定で TypeError', () => {
    assertThrows(() => InvoiceApiClient.create(VALID_APP_ID, { version: '2' }), 'version');
  });
};

const runInvoiceClientStructureTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('InvoiceApiClient クライアント構造');

  test('HTTP ショートカット / call / use / extend を備える', () => {
    const client = InvoiceApiClient.create(VALID_APP_ID);
    assertTrue(typeof client.get === 'function');
    assertTrue(typeof client.post === 'function');
    assertTrue(typeof client.put === 'function');
    assertTrue(typeof client.patch === 'function');
    assertTrue(typeof client.delete === 'function');
    assertTrue(typeof client.call === 'function');
    assertTrue(typeof client.use === 'function');
    assertTrue(typeof client.extend === 'function');
  });
};

const runInvoiceUrlTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('InvoiceApiClient URL 構築 / 認証クエリ');

  test('baseUrl + endpoint で URL を組む', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      client.get('/num', { number: 'T1234567890123' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.startsWith(INVOICE_BASE_URL + '/num'));
    } finally {
      fetchMock.restore();
    }
  });

  test('認証クエリ id / 既定 type=21 / 既定 version=1 が自動付与される', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      client.get('/num', { number: 'T1234567890123' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('id=' + VALID_APP_ID));
      assertTrue(call.url.includes('type=21'));
      assertTrue(call.url.includes('version=1'));
      assertTrue(call.url.includes('number=T1234567890123'));
    } finally {
      fetchMock.restore();
    }
  });

  test('type オプションでレスポンス形式コードを変更できる', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID, { type: '01' });
      client.get('/num', { number: 'T1234567890123' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('type=01'));
    } finally {
      fetchMock.restore();
    }
  });

  test('ユーザ指定のクエリと認証クエリが両立する', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      client.get('/diff', { from: '2026-05-01', to: '2026-05-19' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('from=2026-05-01'));
      assertTrue(call.url.includes('to=2026-05-19'));
      assertTrue(call.url.includes('id=' + VALID_APP_ID));
    } finally {
      fetchMock.restore();
    }
  });

  test('クエリ未指定でも認証クエリで ? が付く', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      client.get('/num');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('?'));
      assertTrue(call.url.includes('id=' + VALID_APP_ID));
    } finally {
      fetchMock.restore();
    }
  });
};

const runInvoiceHeaderTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('InvoiceApiClient ヘッダ');

  test('Accept: application/json が付与される', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      client.get('/num');
      const call = fetchMock.getCalls()[0];
      assertEqual(call.options.headers.Accept, 'application/json');
    } finally {
      fetchMock.restore();
    }
  });

  test('Authorization ヘッダは付与されない', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      client.get('/num');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.options.headers.Authorization === undefined);
    } finally {
      fetchMock.restore();
    }
  });
};

const runInvoiceResponseTests = () => {
  const { suite, test, assertEqual, assertThrows } = TestRunner;

  suite('InvoiceApiClient レスポンス');

  test('成功時はレスポンス body を返す', () => {
    const body = { announcement: [{ registratedNumber: 'T1234567890123', name: '株式会社A' }] };
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      const result = client.get('/num', { number: 'T1234567890123' });
      assertEqual(result.announcement[0].registratedNumber, 'T1234567890123');
    } finally {
      fetchMock.restore();
    }
  });

  test('HTTP 404 では HttpError がスローされる', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 404, body: {} });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      assertThrows(
        () => client.get('/num', { number: 'T0000000000000' }),
        'HTTPエラー 404'
      );
    } finally {
      fetchMock.restore();
    }
  });
};

const runInvoiceRetryTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('InvoiceApiClient リトライ');

  test('503 が返ると再試行され、200 で成功する', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup([
      { status: 503, body: 'service unavailable' },
      { status: 200, body: { ok: true } }
    ]);
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID);
      const result = client.get('/num');
      assertEqual(result.ok, true);
      assertEqual(fetchMock.getCalls().length, 2);
    } finally {
      fetchMock.restore();
    }
  });
};

const runInvoiceExtensionTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('InvoiceApiClient 拡張口 (use)');

  test('.use() で byNumber 等のドメインメソッドを注入できる', () => {
    const fetchMock = MockInvoiceUrlFetchApp.setup({
      status: 200,
      body: { announcement: [{ name: '株式会社A' }] }
    });
    try {
      const client = InvoiceApiClient
        .create(VALID_APP_ID)
        .use('byNumber', c => number => c.get('/num', { number, history: 0 }));
      const result = client.byNumber('T1234567890123');
      assertEqual(result.announcement[0].name, '株式会社A');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('number=T1234567890123'));
      assertTrue(call.url.includes('history=0'));
      assertTrue(call.url.includes('id=' + VALID_APP_ID));
    } finally {
      fetchMock.restore();
    }
  });
};

const runInvoiceLoggerTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('InvoiceApiClient logger');

  test('logger が transport ログを記録する', () => {
    const logs = [];
    const logger = {
      log: (...args) => logs.push(['log', args]),
      info: (...args) => logs.push(['info', args]),
      warn: (...args) => logs.push(['warn', args]),
      error: (...args) => logs.push(['error', args]),
      debug: (...args) => logs.push(['debug', args])
    };
    const fetchMock = MockInvoiceUrlFetchApp.setup({ status: 200, body: { ok: true } });
    try {
      const client = InvoiceApiClient.create(VALID_APP_ID, { logger });
      client.get('/num');
      assertTrue(logs.length > 0, 'logger に何らかの記録がある');
    } finally {
      fetchMock.restore();
    }
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllInvoiceTests() {
  TestRunner.reset();

  console.log('Running Invoice Interface tests...');
  runInvoiceInterfaceTests();

  console.log('Running Invoice バリデーション tests...');
  runInvoiceValidationTests();

  console.log('Running Invoice クライアント構造 tests...');
  runInvoiceClientStructureTests();

  console.log('Running Invoice URL 構築 tests...');
  runInvoiceUrlTests();

  console.log('Running Invoice ヘッダ tests...');
  runInvoiceHeaderTests();

  console.log('Running Invoice レスポンス tests...');
  runInvoiceResponseTests();

  console.log('Running Invoice リトライ tests...');
  runInvoiceRetryTests();

  console.log('Running Invoice 拡張口 tests...');
  runInvoiceExtensionTests();

  console.log('Running Invoice logger tests...');
  runInvoiceLoggerTests();

  return TestRunner.run();
}
