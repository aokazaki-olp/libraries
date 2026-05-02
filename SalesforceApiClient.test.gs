'use strict';

/**
 * SalesforceApiClient.test.gs
 *
 * @description SalesforceApiClient のテストスイート
 *
 * 実行方法:
 *   GAS エディタから runAllSalesforceApiClientTests() を実行
 */

const MockSfUrlFetchApp = (function () {
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

const runSfApiInterfaceTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('SalesforceApiClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof SalesforceApiClient.create === 'function');
  });
};

const runSfApiCreateValidationTests = () => {
  const { suite, test, assertThrows } = TestRunner;

  suite('SalesforceApiClient.create バリデーション');

  test('引数なしで TypeError', () => {
    assertThrows(() => SalesforceApiClient.create(), 'instanceUrl');
  });

  test('instanceUrl が空文字で TypeError', () => {
    assertThrows(() => SalesforceApiClient.create('', 't'), 'instanceUrl');
  });

  test('instanceUrl が null で TypeError', () => {
    assertThrows(() => SalesforceApiClient.create(null, 't'), 'instanceUrl');
  });

  test('accessToken が空文字で TypeError', () => {
    assertThrows(() => SalesforceApiClient.create('https://x', ''), 'access token');
  });

  test('accessToken が null で TypeError', () => {
    assertThrows(() => SalesforceApiClient.create('https://x', null), 'access token');
  });
};

const runSfApiClientStructureTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('SalesforceApiClient クライアント構造');

  test('HTTP ショートカット / use / extend が公開されている', () => {
    const c = SalesforceApiClient.create('https://x.my.salesforce.com', 'tok');
    assertTrue(typeof c.get === 'function');
    assertTrue(typeof c.post === 'function');
    assertTrue(typeof c.put === 'function');
    assertTrue(typeof c.patch === 'function');
    assertTrue(typeof c.delete === 'function');
    assertTrue(typeof c.call === 'function');
    assertTrue(typeof c.use === 'function');
    assertTrue(typeof c.extend === 'function');
  });
};

const runSfApiBaseUrlTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('SalesforceApiClient baseUrl 構築');

  test('instanceUrl + /services/data/v60.0 で構成される (デフォルト API バージョン)', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: { records: [] } });
    try {
      const c = SalesforceApiClient.create('https://acme.my.salesforce.com', 'tok');
      c.get('/query', { q: 'SELECT Id FROM Account' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.startsWith('https://acme.my.salesforce.com/services/data/v60.0/query'));
    } finally {
      fetchMock.restore();
    }
  });

  test('instanceUrl 末尾スラッシュが正規化される', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const c = SalesforceApiClient.create('https://acme.my.salesforce.com/', 'tok');
      c.get('/query', { q: 'X' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.startsWith('https://acme.my.salesforce.com/services/data/v60.0/query'));
      // 二重スラッシュを含まないこと
      assertTrue(!call.url.includes('salesforce.com//services'));
    } finally {
      fetchMock.restore();
    }
  });

  test('apiVersion を上書きできる', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const c = SalesforceApiClient.create('https://x', 'tok', { apiVersion: 'v59.0' });
      c.get('/query', { q: 'X' });
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('/services/data/v59.0/query'));
    } finally {
      fetchMock.restore();
    }
  });
};

const runSfApiAuthHeaderTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('SalesforceApiClient 認証ヘッダ');

  test('Authorization: Bearer {token} が付与される', () => {
    const fetchMock = MockSfUrlFetchApp.setup({ status: 200, body: {} });
    try {
      const c = SalesforceApiClient.create('https://x', 'my-access-token');
      c.get('/query', { q: 'X' });
      const call = fetchMock.getCalls()[0];
      assertEqual(call.options.headers.Authorization, 'Bearer my-access-token');
    } finally {
      fetchMock.restore();
    }
  });
};

const runSfApiSoqlQueryTests = () => {
  const { suite, test, assertTrue, assertEqual } = TestRunner;

  suite('SalesforceApiClient SOQL クエリ');

  test('get(/query, { q }) でクエリ文字列が組まれる', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 200,
      body: { totalSize: 1, done: true, records: [{ Id: '001', Name: 'Acme' }] }
    });
    try {
      const c = SalesforceApiClient.create('https://x', 'tok');
      const result = c.get('/query', { q: 'SELECT Id, Name FROM Account LIMIT 1' });
      assertEqual(result.totalSize, 1);
      assertEqual(result.records[0].Name, 'Acme');
      const call = fetchMock.getCalls()[0];
      assertTrue(call.url.includes('q=' + encodeURIComponent('SELECT Id, Name FROM Account LIMIT 1')));
    } finally {
      fetchMock.restore();
    }
  });
};

const runSfApiErrorTests = () => {
  const { suite, test, assertThrows } = TestRunner;

  suite('SalesforceApiClient エラー伝播');

  test('4xx で HttpError が伝播', () => {
    const fetchMock = MockSfUrlFetchApp.setup({
      status: 400,
      body: [{ errorCode: 'MALFORMED_QUERY', message: 'Invalid SOQL' }]
    });
    try {
      const c = SalesforceApiClient.create('https://x', 'tok');
      assertThrows(
        () => c.get('/query', { q: 'BAD' }),
        'HTTPエラー 400'
      );
    } finally {
      fetchMock.restore();
    }
  });
};

function runAllSalesforceApiClientTests() {
  TestRunner.reset();

  console.log('Running SF Api Interface tests...');
  runSfApiInterfaceTests();

  console.log('Running SF Api create バリデーション tests...');
  runSfApiCreateValidationTests();

  console.log('Running SF Api クライアント構造 tests...');
  runSfApiClientStructureTests();

  console.log('Running SF Api baseUrl 構築 tests...');
  runSfApiBaseUrlTests();

  console.log('Running SF Api 認証ヘッダ tests...');
  runSfApiAuthHeaderTests();

  console.log('Running SF Api SOQL クエリ tests...');
  runSfApiSoqlQueryTests();

  console.log('Running SF Api エラー伝播 tests...');
  runSfApiErrorTests();

  return TestRunner.run();
}
