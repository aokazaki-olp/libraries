'use strict';

/**
 * GBizInfoApiClient.test.gs
 *
 * @description GBizInfoApiClient のテストスイート(GAS モック使用)
 *
 * 実行方法:
 *   GAS エディタから runAllGBizInfoTests() を実行
 */

// ============================================================================
// GAS モック (UrlFetchApp グローバル差し替え)
// ============================================================================
//
// HttpClient.test.gs / GoogleSearchConsoleApiClient.test.gs と同じ手法。
// GBizInfoApiClient.create() は内部で HttpCore.createTransport() を使うため、
// UrlFetchApp.fetch をグローバルに差し替えてリクエストを捕捉する。

const MockGBizUrlFetchApp = (function () {
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

const runGBizInterfaceTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('GBizInfoApiClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof GBizInfoApiClient.create === 'function');
  });
};

const runGBizCreateValidationTests = () => {
  const { suite, test, assertThrows } = TestRunner;

  suite('GBizInfoApiClient.create バリデーション');

  test('token が undefined だと TypeError', () => {
    assertThrows(() => GBizInfoApiClient.create(), 'gBizINFO API token');
  });

  test('token が null だと TypeError', () => {
    assertThrows(() => GBizInfoApiClient.create(null), 'gBizINFO API token');
  });

  test('token が空文字だと TypeError', () => {
    assertThrows(() => GBizInfoApiClient.create(''), 'gBizINFO API token');
  });

  test('token が数値だと TypeError', () => {
    assertThrows(() => GBizInfoApiClient.create(123), 'gBizINFO API token');
  });
};

const runGBizClientStructureTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('GBizInfoApiClient クライアント構造');

  test('create が返すクライアントに HTTP ショートカットがある', () => {
    const client = GBizInfoApiClient.create('dummy-token');
    assertTrue(typeof client.get === 'function');
    assertTrue(typeof client.post === 'function');
    assertTrue(typeof client.put === 'function');
    assertTrue(typeof client.patch === 'function');
    assertTrue(typeof client.delete === 'function');
    assertTrue(typeof client.call === 'function');
  });

  test('create が返すクライアントに use / extend がある', () => {
    const client = GBizInfoApiClient.create('dummy-token');
    assertTrue(typeof client.use === 'function');
    assertTrue(typeof client.extend === 'function');
  });
};

const runGBizAuthHeaderTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('GBizInfoApiClient 認証ヘッダ');

  test('X-hojinInfo-api-token ヘッダにトークンを乗せる', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: { 'hojin-infos': [] } });
    try {
      const client = GBizInfoApiClient.create('my-token-12345');
      client.get('/hojin/1234567890123');
      const call = fetchMock.getCalls()[0];
      assertEqual(call.options.headers['X-hojinInfo-api-token'], 'my-token-12345');
    } finally {
      fetchMock.restore();
    }
  });

  test('Authorization ヘッダは付与されない (Bearer ではない)', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = GBizInfoApiClient.create('t');
      client.get('/hojin/1');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.options.headers.Authorization === undefined);
    } finally {
      fetchMock.restore();
    }
  });

  test('Accept: application/json が付与される', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = GBizInfoApiClient.create('t');
      client.get('/hojin/1');
      const call = fetchMock.getCalls()[0];
      assertEqual(call.options.headers.Accept, 'application/json');
    } finally {
      fetchMock.restore();
    }
  });
};

const runGBizUrlBuildingTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('GBizInfoApiClient URL 構築');

  test('baseUrl + endpoint で URL を組む', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = GBizInfoApiClient.create('t');
      client.get('/hojin/1234567890123');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.startsWith('https://info.gbiz.go.jp/hojin/v1/hojin/1234567890123'));
    } finally {
      fetchMock.restore();
    }
  });

  test('クエリパラメータが付与される', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = GBizInfoApiClient.create('t');
      client.get('/hojin', { name: 'テスト株式会社', limit: 10 });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('name=' + encodeURIComponent('テスト株式会社')));
      assertTrue(call.url.includes('limit=10'));
    } finally {
      fetchMock.restore();
    }
  });
};

const runGBizResponseHandlerTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('GBizInfoApiClient レスポンスハンドラ');

  test('成功時はレスポンス body を返す', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({
      status: 200,
      body: { 'hojin-infos': [{ corporate_number: '1234567890123', name: 'A 社' }] }
    });
    try {
      const client = GBizInfoApiClient.create('t');
      const result = client.get('/hojin/1234567890123');
      assertTrue(Array.isArray(result['hojin-infos']));
      assertEqual(result['hojin-infos'][0].corporate_number, '1234567890123');
    } finally {
      fetchMock.restore();
    }
  });

  test('HTTP エラー時は HttpError がスローされる', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 404, body: { errors: [{ message: 'Not Found' }] } });
    try {
      const client = GBizInfoApiClient.create('t');
      assertThrows(
        () => client.get('/hojin/0000000000000'),
        'HTTPエラー 404'
      );
    } finally {
      fetchMock.restore();
    }
  });
};

const runGBizRetryTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('GBizInfoApiClient リトライ');

  test('503 が返ると再試行され、200 で成功する', () => {
    const fetchMock = MockGBizUrlFetchApp.setup([
      { status: 503, body: 'service unavailable' },
      { status: 200, body: { ok: true } }
    ]);
    try {
      const client = GBizInfoApiClient.create('t');
      const result = client.get('/hojin/1');
      assertEqual(result.ok, true);
      assertEqual(fetchMock.getCalls().length, 2);
    } finally {
      fetchMock.restore();
    }
  });
};

const runGBizExtensionTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('GBizInfoApiClient 拡張口 (use)');

  test('.use() で呼び出し側がメソッドを注入できる', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: { name: 'A 社' } });
    try {
      const client = GBizInfoApiClient
        .create('t')
        .use('byCorporateNumber', c => corporateNumber => c.get(`/hojin/${corporateNumber}`));
      const result = client.byCorporateNumber('1234567890123');
      assertEqual(result.name, 'A 社');
      const call = fetchMock.getCalls()[0];
      assertEqual(true, call.url.endsWith('/hojin/1234567890123'));
    } finally {
      fetchMock.restore();
    }
  });
};

const runGBizEdgeCaseTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('GBizInfoApiClient エッジケース');

  test('token が真偽値だと TypeError', () => {
    assertThrows(() => GBizInfoApiClient.create(true), 'gBizINFO API token');
    assertThrows(() => GBizInfoApiClient.create(false), 'gBizINFO API token');
  });

  test('token がオブジェクトだと TypeError', () => {
    assertThrows(() => GBizInfoApiClient.create({}), 'gBizINFO API token');
    assertThrows(() => GBizInfoApiClient.create([]), 'gBizINFO API token');
  });

  test('429 が返るとリトライされる', () => {
    const fetchMock = MockGBizUrlFetchApp.setup([
      { status: 429, body: 'Too Many Requests' },
      { status: 200, body: { ok: true } }
    ]);
    try {
      const client = GBizInfoApiClient.create('t');
      const result = client.get('/hojin/1');
      assertEqual(result.ok, true);
      assertEqual(fetchMock.getCalls().length, 2);
    } finally {
      fetchMock.restore();
    }
  });

  test('連続 503 でリトライ上限に達するとエラー', () => {
    const fetchMock = MockGBizUrlFetchApp.setup([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' }
    ]);
    try {
      const client = GBizInfoApiClient.create('t');
      assertThrows(() => client.get('/hojin/1'), 'リトライ');
      // maxRetries=3 → 初回 + 3 回 = 4 回呼び出し
      assertEqual(fetchMock.getCalls().length, 4);
    } finally {
      fetchMock.restore();
    }
  });

  test('4xx クライアントエラーは即時スローされ再試行されない', () => {
    const fetchMock = MockGBizUrlFetchApp.setup([
      { status: 401, body: { error: 'unauthorized' } },
      { status: 200, body: { ok: true } }
    ]);
    try {
      const client = GBizInfoApiClient.create('bad');
      assertThrows(() => client.get('/hojin/1'), 'HTTPエラー 401');
      assertEqual(fetchMock.getCalls().length, 1);
    } finally {
      fetchMock.restore();
    }
  });

  test('logger が transport ログを記録する', () => {
    const logs = [];
    const logger = {
      log: (...args) => logs.push(['log', args]),
      info: (...args) => logs.push(['info', args]),
      warn: (...args) => logs.push(['warn', args]),
      error: (...args) => logs.push(['error', args]),
      debug: (...args) => logs.push(['debug', args])
    };
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: { ok: true } });
    try {
      const client = GBizInfoApiClient.create('t', logger);
      client.get('/hojin/1');
      assertTrue(logs.length > 0, 'logger に何らかの記録がある');
    } finally {
      fetchMock.restore();
    }
  });

  test('複数の use() を連鎖できる', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: { ok: 1 } });
    try {
      const client = GBizInfoApiClient
        .create('t')
        .use('byNumber', c => n => c.get(`/hojin/${n}`))
        .use('search', c => name => c.get('/hojin', { name }));
      assertTrue(typeof client.byNumber === 'function');
      assertTrue(typeof client.search === 'function');
      client.byNumber('1');
      client.search('A 社');
      assertEqual(fetchMock.getCalls().length, 2);
    } finally {
      fetchMock.restore();
    }
  });

  test('クエリ未指定でもエラーにならない', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const client = GBizInfoApiClient.create('t');
      client.get('/hojin/1');
      const call = fetchMock.getCalls()[0];
      assertTrue(!call.url.includes('?'));
    } finally {
      fetchMock.restore();
    }
  });

  test('200 で空ボディが返ると空オブジェクトとして処理される', () => {
    const fetchMock = MockGBizUrlFetchApp.setup({ status: 200, body: '' });
    try {
      const client = GBizInfoApiClient.create('t');
      const result = client.get('/hojin/1');
      // 空 string は HttpCore が空オブジェクトに正規化(あるいは null)
      assertTrue(result === null || result === '' || (typeof result === 'object'));
    } finally {
      fetchMock.restore();
    }
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllGBizInfoTests() {
  TestRunner.reset();

  console.log('Running GBizInfo Interface tests...');
  runGBizInterfaceTests();

  console.log('Running GBizInfo create バリデーション tests...');
  runGBizCreateValidationTests();

  console.log('Running GBizInfo クライアント構造 tests...');
  runGBizClientStructureTests();

  console.log('Running GBizInfo 認証ヘッダ tests...');
  runGBizAuthHeaderTests();

  console.log('Running GBizInfo URL 構築 tests...');
  runGBizUrlBuildingTests();

  console.log('Running GBizInfo レスポンスハンドラ tests...');
  runGBizResponseHandlerTests();

  console.log('Running GBizInfo リトライ tests...');
  runGBizRetryTests();

  console.log('Running GBizInfo 拡張口 tests...');
  runGBizExtensionTests();

  console.log('Running GBizInfo エッジケース tests...');
  runGBizEdgeCaseTests();

  return TestRunner.run();
}
