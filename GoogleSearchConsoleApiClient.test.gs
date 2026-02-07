'use strict';

/**
 * GoogleSearchConsoleApiClient.test.gs
 *
 * @description GoogleSearchConsoleApiClient のテストスイート（GAS モック使用）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-07
 *
 * 実行方法:
 *   GAS エディタから runAllGscTests() を実行
 */

// ============================================================================
// GAS モック
// ============================================================================

const MockScriptApp = (function () {
  let mockToken = 'mock-oauth-token';

  const setup = (token = 'mock-oauth-token') => {
    mockToken = token;
    const original = typeof ScriptApp !== 'undefined' ? ScriptApp : undefined;

    globalThis.ScriptApp = {
      getOAuthToken: () => mockToken
    };

    return {
      restore: () => {
        if (original === undefined) {
          delete globalThis.ScriptApp;
        } else {
          globalThis.ScriptApp = original;
        }
      },
      setToken: t => { mockToken = t; }
    };
  };

  return { setup };
})();

// ============================================================================
// GoogleSearchConsoleApiClient テスト
// ============================================================================

const runGscInterfaceTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('GoogleSearchConsoleApiClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof GoogleSearchConsoleApiClient.create === 'function');
  });

  test('withGoogleAuth が公開されている', () => {
    assertTrue(typeof GoogleSearchConsoleApiClient.withGoogleAuth === 'function');
  });
};

const runGscWithGoogleAuthTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('GoogleSearchConsoleApiClient.withGoogleAuth');

  test('Authorization ヘッダーを追加する', () => {
    const scriptMock = MockScriptApp.setup('test-oauth-token');
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const authedTransport = GoogleSearchConsoleApiClient.withGoogleAuth(mockTransport);

      authedTransport.fetch('http://example.com', {});
      const call = mockTransport.getCalls()[0];
      assertEqual(call.options.headers.Authorization, 'Bearer test-oauth-token');
    } finally {
      scriptMock.restore();
    }
  });

  test('既存のヘッダーを保持する', () => {
    const scriptMock = MockScriptApp.setup('token');
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const authedTransport = GoogleSearchConsoleApiClient.withGoogleAuth(mockTransport);

      authedTransport.fetch('http://example.com', { headers: { 'X-Custom': 'value' } });
      const call = mockTransport.getCalls()[0];
      assertEqual(call.options.headers['X-Custom'], 'value');
      assertEqual(call.options.headers.Authorization, 'Bearer token');
    } finally {
      scriptMock.restore();
    }
  });

  test('headers が undefined でも動作する', () => {
    const scriptMock = MockScriptApp.setup('token');
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const authedTransport = GoogleSearchConsoleApiClient.withGoogleAuth(mockTransport);

      authedTransport.fetch('http://example.com', {});
      const call = mockTransport.getCalls()[0];
      assertEqual(call.options.headers.Authorization, 'Bearer token');
    } finally {
      scriptMock.restore();
    }
  });

  test('毎回 getOAuthToken() を呼ぶ（動的トークン）', () => {
    const scriptMock = MockScriptApp.setup('token-1');
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const authedTransport = GoogleSearchConsoleApiClient.withGoogleAuth(mockTransport);

      authedTransport.fetch('http://example.com', {});
      let call = mockTransport.getCalls()[0];
      assertEqual(call.options.headers.Authorization, 'Bearer token-1');

      scriptMock.setToken('token-2');
      authedTransport.fetch('http://example.com', {});
      call = mockTransport.getCalls()[1];
      assertEqual(call.options.headers.Authorization, 'Bearer token-2');
    } finally {
      scriptMock.restore();
    }
  });
};

const runGscNormalizeSiteUrlTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('GoogleSearchConsoleApiClient normalizeSiteUrl');

  test('通常の URL に末尾スラッシュを追加する', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      client.call({ endpoint: '/searchAnalytics/query', method: 'POST', body: {} });

      const call = mockTransport.getCalls()[0];
      // URL should contain encoded "https://example.com/"
      assertTrue(call.url.includes(encodeURIComponent('https://example.com/')));
    } finally {
      scriptMock.restore();
    }
  });

  test('既に末尾スラッシュがある URL はそのまま', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const client = GoogleSearchConsoleApiClient.create('https://example.com/', null);
      client.call({ endpoint: '/searchAnalytics/query', method: 'POST', body: {} });

      const call = mockTransport.getCalls()[0];
      assertTrue(call.url.includes(encodeURIComponent('https://example.com/')));
    } finally {
      scriptMock.restore();
    }
  });

  test('sc-domain: プレフィックスはそのまま使用する', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const client = GoogleSearchConsoleApiClient.create('sc-domain:example.com', null);
      client.call({ endpoint: '/searchAnalytics/query', method: 'POST', body: {} });

      const call = mockTransport.getCalls()[0];
      assertTrue(call.url.includes(encodeURIComponent('sc-domain:example.com')));
      // sc-domain にはスラッシュが追加されないこと
      assertTrue(!call.url.includes(encodeURIComponent('sc-domain:example.com/')));
    } finally {
      scriptMock.restore();
    }
  });

  test('空文字の siteUrl でもエラーにならない', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const client = GoogleSearchConsoleApiClient.create('', null);
      client.call({ endpoint: '/test', method: 'GET' });
      // エラーにならなければ成功
      assertTrue(true);
    } finally {
      scriptMock.restore();
    }
  });

  test('null の siteUrl でもエラーにならない', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.success({ ok: true });
      const client = GoogleSearchConsoleApiClient.create(null, null);
      client.call({ endpoint: '/test', method: 'GET' });
      assertTrue(true);
    } finally {
      scriptMock.restore();
    }
  });
};

const runGscResponseHandlerTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertThrows } = TestRunner;

  suite('GoogleSearchConsoleApiClient レスポンスハンドラ');

  test('レスポンスハンドラが body のみを返す', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.success({ rows: [{ keys: ['query1'], clicks: 100 }] });
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      const result = client.call({ endpoint: '/searchAnalytics/query', method: 'POST', body: {} });

      // responseHandler は response.body を返すので、body が直接返される
      assertTrue(Array.isArray(result.rows));
      assertEqual(result.rows[0].clicks, 100);
    } finally {
      scriptMock.restore();
    }
  });

  test('HTTP エラー時は HttpError がスローされる', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const mockTransport = MockTransport.error(403, { error: { message: 'Forbidden' } });
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      assertThrows(
        () => client.call({ endpoint: '/searchAnalytics/query', method: 'POST', body: {} }),
        'HTTPエラー 403'
      );
    } finally {
      scriptMock.restore();
    }
  });
};

const runGscClientStructureTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('GoogleSearchConsoleApiClient クライアント構造');

  test('create が返すクライアントに call メソッドがある', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      assertTrue(typeof client.call === 'function');
    } finally {
      scriptMock.restore();
    }
  });

  test('create が返すクライアントに HTTP ショートカットがある', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      assertTrue(typeof client.get === 'function');
      assertTrue(typeof client.post === 'function');
      assertTrue(typeof client.put === 'function');
      assertTrue(typeof client.patch === 'function');
      assertTrue(typeof client.delete === 'function');
    } finally {
      scriptMock.restore();
    }
  });

  test('create が返すクライアントに use メソッドがある', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      assertTrue(typeof client.use === 'function');
    } finally {
      scriptMock.restore();
    }
  });

  test('create が返すクライアントに extend メソッドがある', () => {
    const scriptMock = MockScriptApp.setup();
    try {
      const client = GoogleSearchConsoleApiClient.create('https://example.com', null);
      assertTrue(typeof client.extend === 'function');
    } finally {
      scriptMock.restore();
    }
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllGscTests() {
  TestRunner.reset();

  console.log('Running GSC Interface tests...');
  runGscInterfaceTests();

  console.log('Running GSC withGoogleAuth tests...');
  runGscWithGoogleAuthTests();

  console.log('Running GSC normalizeSiteUrl tests...');
  runGscNormalizeSiteUrlTests();

  console.log('Running GSC Response Handler tests...');
  runGscResponseHandlerTests();

  console.log('Running GSC Client Structure tests...');
  runGscClientStructureTests();

  return TestRunner.run();
}
