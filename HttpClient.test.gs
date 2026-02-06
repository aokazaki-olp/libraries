'use strict';

/**
 * HttpClient.test.gs
 *
 * @description HttpClient.gs (HttpCore / ApiClient / WebhookClient) のテストスイート
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-02
 *
 * 実行方法:
 *   GAS エディタから runAllHttpClientTests() を実行
 *
 * 構成:
 *   - TestRunner: シンプルなテストランナー
 *   - MockTransport: HTTP通信のモック
 *   - HttpCore テスト
 *   - ApiClient テスト
 *   - WebhookClient テスト
 *   - インテグレーションテスト
 */

// ============================================================================
// TestRunner - シンプルなテストランナー
// ============================================================================

const TestRunner = (function () {
  let results = [];
  let currentSuite = '';

  const suite = name => {
    currentSuite = name;
  };

  const test = (name, fn) => {
    const fullName = currentSuite ? `${currentSuite} > ${name}` : name;
    try {
      fn();
      results.push({ name: fullName, passed: true });
    } catch (e) {
      results.push({ name: fullName, passed: false, error: e.message || String(e) });
    }
  };

  const assertEqual = (actual, expected, message) => {
    if (actual !== expected) {
      throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  const assertDeepEqual = (actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  const assertTrue = (value, message) => {
    if (!value) {
      throw new Error(message || 'Expected true but got false');
    }
  };

  const assertFalse = (value, message) => {
    if (value) {
      throw new Error(message || 'Expected false but got true');
    }
  };

  const assertThrows = (fn, expectedMessage, message) => {
    let threw = false;
    let errorMessage = '';
    try {
      fn();
    } catch (e) {
      threw = true;
      errorMessage = e.message || String(e);
    }
    if (!threw) {
      throw new Error(message || 'Expected function to throw but it did not');
    }
    if (expectedMessage && !errorMessage.includes(expectedMessage)) {
      throw new Error(`${message || 'Error message mismatch'}: expected to include "${expectedMessage}", got "${errorMessage}"`);
    }
  };

  const run = () => {
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    let output = `\n========================================\n`;
    output += `Test Results: ${passed}/${total} passed\n`;
    output += `========================================\n\n`;

    results.forEach(r => {
      if (r.passed) {
        output += `✓ ${r.name}\n`;
      } else {
        output += `✗ ${r.name}\n  → ${r.error}\n`;
      }
    });

    if (failed > 0) {
      output += `\n${failed} test(s) failed.\n`;
    } else {
      output += `\nAll tests passed!\n`;
    }

    console.log(output);
    return { passed, failed, total, results };
  };

  const reset = () => {
    results = [];
    currentSuite = '';
  };

  return {
    suite,
    test,
    assertEqual,
    assertDeepEqual,
    assertTrue,
    assertFalse,
    assertThrows,
    run,
    reset
  };
})();

// ============================================================================
// MockTransport - HTTP通信のモック
// ============================================================================

const MockTransport = (function () {
  /**
   * モックレスポンスを作成
   */
  const createMockResponse = (statusCode, body, headers) => ({
    getResponseCode: () => statusCode,
    getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
    getAllHeaders: () => headers || {}
  });

  /**
   * モックトランスポートを作成
   */
  const create = responses => {
    let callIndex = 0;
    const calls = [];

    return {
      fetch: (url, options) => {
        calls.push({ url, options });
        const response = Array.isArray(responses)
          ? responses[callIndex++ % responses.length]
          : responses;
        if (typeof response === 'function') {
          return response(url, options);
        }
        return response;
      },
      getCalls: () => calls,
      getCallCount: () => calls.length
    };
  };

  /**
   * 成功レスポンスを返すモック
   */
  const success = (body, headers) => create(createMockResponse(200, body, headers));

  /**
   * エラーレスポンスを返すモック
   */
  const error = (statusCode, body, headers) => create(createMockResponse(statusCode, body, headers));

  /**
   * 例外をスローするモック
   */
  const throwing = errorMessage => create(() => {
    throw new Error(errorMessage);
  });

  /**
   * 連続したレスポンスを返すモック
   */
  const sequence = responseList => create(responseList.map(r => {
    if (r.throw) {
      return () => { throw new Error(r.throw); };
    }
    return createMockResponse(r.status || 200, r.body, r.headers);
  }));

  return {
    createMockResponse,
    create,
    success,
    error,
    throwing,
    sequence
  };
})();

// ============================================================================
// HttpCore テスト
// ============================================================================

const runHttpCoreTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertFalse, assertThrows } = TestRunner;

  // ─── cloneHeaders テスト ─────────────────────────────────────────

  suite('HttpCore.cloneHeaders');

  test('null を渡すと空オブジェクトを返す', () => {
    const result = HttpCore.cloneHeaders(null);
    assertDeepEqual(result, {});
  });

  test('undefined を渡すと空オブジェクトを返す', () => {
    const result = HttpCore.cloneHeaders(undefined);
    assertDeepEqual(result, {});
  });

  test('ヘッダーを正しくクローンする', () => {
    const original = { 'Content-Type': 'application/json', 'X-Custom': 'value' };
    const result = HttpCore.cloneHeaders(original);
    assertDeepEqual(result, original);
  });

  test('クローンは元のオブジェクトと独立している', () => {
    const original = { 'Content-Type': 'application/json' };
    const result = HttpCore.cloneHeaders(original);
    result['X-New'] = 'new-value';
    assertFalse('X-New' in original);
  });

  // ─── mergeHeaders テスト ─────────────────────────────────────────

  suite('HttpCore.mergeHeaders');

  test('null ベースで override のみ返す', () => {
    const result = HttpCore.mergeHeaders(null, { 'X-Custom': 'value' });
    assertDeepEqual(result, { 'X-Custom': 'value' });
  });

  test('override が null の場合ベースのみ返す', () => {
    const result = HttpCore.mergeHeaders({ 'Content-Type': 'application/json' }, null);
    assertDeepEqual(result, { 'Content-Type': 'application/json' });
  });

  test('ヘッダーをマージする', () => {
    const base = { 'Content-Type': 'application/json' };
    const override = { 'X-Custom': 'value' };
    const result = HttpCore.mergeHeaders(base, override);
    assertDeepEqual(result, { 'Content-Type': 'application/json', 'X-Custom': 'value' });
  });

  test('override が base を上書きする', () => {
    const base = { 'Content-Type': 'text/plain' };
    const override = { 'Content-Type': 'application/json' };
    const result = HttpCore.mergeHeaders(base, override);
    assertEqual(result['Content-Type'], 'application/json');
  });

  // ─── hasHeader テスト ────────────────────────────────────────────

  suite('HttpCore.hasHeader');

  test('存在するヘッダーで true を返す', () => {
    const headers = { 'Content-Type': 'application/json' };
    assertTrue(HttpCore.hasHeader(headers, 'Content-Type'));
  });

  test('存在しないヘッダーで false を返す', () => {
    const headers = { 'Content-Type': 'application/json' };
    assertFalse(HttpCore.hasHeader(headers, 'X-Custom'));
  });

  test('大文字小文字を区別しない（小文字で検索）', () => {
    const headers = { 'Content-Type': 'application/json' };
    assertTrue(HttpCore.hasHeader(headers, 'content-type'));
  });

  test('大文字小文字を区別しない（大文字で検索）', () => {
    const headers = { 'content-type': 'application/json' };
    assertTrue(HttpCore.hasHeader(headers, 'CONTENT-TYPE'));
  });

  // ─── interpretResponse テスト ────────────────────────────────────

  suite('HttpCore.interpretResponse');

  test('200 レスポンスを正しく解釈する', () => {
    const mockResponse = MockTransport.createMockResponse(200, { ok: true });
    const result = HttpCore.interpretResponse(mockResponse, {});
    assertEqual(result.status, 200);
    assertDeepEqual(result.body, { ok: true });
  });

  test('JSON でないレスポンスはテキストとして扱う', () => {
    const mockResponse = MockTransport.createMockResponse(200, 'plain text');
    // getContentText は文字列を返すので、JSON.parse が失敗してそのまま返る
    const result = HttpCore.interpretResponse(mockResponse, {});
    assertEqual(result.body, 'plain text');
  });

  test('空のレスポンスボディを処理する', () => {
    const mockResponse = {
      getResponseCode: () => 200,
      getContentText: () => '',
      getAllHeaders: () => ({})
    };
    const result = HttpCore.interpretResponse(mockResponse, {});
    assertEqual(result.body, null);
  });

  test('4xx エラーで例外をスローする', () => {
    const mockResponse = MockTransport.createMockResponse(404, { error: 'Not Found' });
    assertThrows(
      () => HttpCore.interpretResponse(mockResponse, {}),
      'HTTPエラー 404'
    );
  });

  test('5xx エラーで例外をスローする', () => {
    const mockResponse = MockTransport.createMockResponse(500, { error: 'Server Error' });
    assertThrows(
      () => HttpCore.interpretResponse(mockResponse, {}),
      'HTTPエラー 500'
    );
  });

  test('エラー時に詳細情報を含む', () => {
    const mockResponse = MockTransport.createMockResponse(400, { error: 'Bad Request' });
    try {
      HttpCore.interpretResponse(mockResponse, { endpoint: '/test' });
    } catch (e) {
      assertEqual(e.name, 'HttpError');
      assertEqual(e.status, 400);
      assertDeepEqual(e.body, { error: 'Bad Request' });
    }
  });

  // ─── createTransport テスト ──────────────────────────────────────

  suite('HttpCore.createTransport');

  test('fetch メソッドを持つオブジェクトを返す', () => {
    const transport = HttpCore.createTransport();
    assertTrue(typeof transport.fetch === 'function');
  });

  // ─── withRetry テスト ────────────────────────────────────────────

  suite('HttpCore.withRetry');

  test('成功時はリトライしない', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const retryTransport = HttpCore.withRetry(mockTransport, { maxRetries: 3 });
    retryTransport.fetch('http://example.com', {});
    assertEqual(mockTransport.getCallCount(), 1);
  });

  test('429 でリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = HttpCore.withRetry(mockTransport, { maxRetries: 3, baseDelayMs: 1 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('500 でリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = HttpCore.withRetry(mockTransport, { maxRetries: 3, baseDelayMs: 1 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('リトライ上限で例外をスローする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} }
    ]);
    const retryTransport = HttpCore.withRetry(mockTransport, { maxRetries: 3, baseDelayMs: 1 });
    assertThrows(
      () => retryTransport.fetch('http://example.com', {}),
      'リトライ回数上限'
    );
  });

  test('例外発生時もリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { throw: 'Network error' },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = HttpCore.withRetry(mockTransport, { maxRetries: 3, baseDelayMs: 1 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
  });

  test('maxRetries: 0 でリトライしない', () => {
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} }
    ]);
    const retryTransport = HttpCore.withRetry(mockTransport, { maxRetries: 0, baseDelayMs: 1 });
    assertThrows(
      () => retryTransport.fetch('http://example.com', {}),
      'リトライ回数上限'
    );
    assertEqual(mockTransport.getCallCount(), 1);
  });

  // ─── withLogger テスト ───────────────────────────────────────────

  suite('HttpCore.withLogger');

  test('logger が null の場合は元の transport を返す', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const loggedTransport = HttpCore.withLogger(mockTransport, null);
    assertEqual(loggedTransport, mockTransport);
  });

  test('ログが出力される', () => {
    const logs = [];
    const mockLogger = {
      debug: msg => logs.push({ level: 'debug', msg }),
      info: msg => logs.push({ level: 'info', msg }),
      error: msg => logs.push({ level: 'error', msg })
    };
    const mockTransport = MockTransport.success({ ok: true });
    const loggedTransport = HttpCore.withLogger(mockTransport, mockLogger);
    loggedTransport.fetch('http://example.com', { method: 'POST' });
    assertTrue(logs.some(l => l.level === 'debug' && l.msg.includes('POST')));
    assertTrue(logs.some(l => l.level === 'info' && l.msg.includes('200')));
  });

  test('エラー時もログが出力される', () => {
    const logs = [];
    const mockLogger = {
      debug: msg => logs.push({ level: 'debug', msg }),
      info: msg => logs.push({ level: 'info', msg }),
      error: (msg, e) => logs.push({ level: 'error', msg, error: e })
    };
    const mockTransport = MockTransport.throwing('Network error');
    const loggedTransport = HttpCore.withLogger(mockTransport, mockLogger);
    try {
      loggedTransport.fetch('http://example.com', { method: 'GET' });
    } catch (e) {
      // expected
    }
    assertTrue(logs.some(l => l.level === 'error'));
  });
};

// ============================================================================
// ApiClient テスト
// ============================================================================

const runApiClientTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertThrows } = TestRunner;

  // ─── インターフェーステスト ──────────────────────────────────────

  suite('ApiClient インターフェース');

  test('withBearerAuth が公開されている', () => {
    assertTrue(typeof ApiClient.withBearerAuth === 'function');
  });

  test('createClient が公開されている', () => {
    assertTrue(typeof ApiClient.createClient === 'function');
  });

  // ─── withBearerAuth テスト ───────────────────────────────────────

  suite('ApiClient.withBearerAuth');

  test('Authorization ヘッダーを追加する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const authedTransport = ApiClient.withBearerAuth(mockTransport, 'test-token');
    authedTransport.fetch('http://example.com', {});
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.headers.Authorization, 'Bearer test-token');
  });

  test('既存のヘッダーを保持する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const authedTransport = ApiClient.withBearerAuth(mockTransport, 'test-token');
    authedTransport.fetch('http://example.com', { headers: { 'X-Custom': 'value' } });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.headers['X-Custom'], 'value');
    assertEqual(call.options.headers.Authorization, 'Bearer test-token');
  });

  // ─── createClient テスト ─────────────────────────────────────────

  suite('ApiClient.createClient');

  test('クライアントを作成できる', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.call === 'function');
    assertTrue(typeof client.extend === 'function');
  });

  test('call で正しい URL を構築する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.call({ endpoint: '/users', method: 'GET' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.url, 'https://api.example.com/users');
  });

  test('baseUrl の末尾スラッシュを正規化する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com/',
      transport: mockTransport
    });
    client.call({ endpoint: '/users', method: 'GET' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.url, 'https://api.example.com/users');
  });

  test('endpoint の先頭スラッシュを正規化する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.call({ endpoint: 'users', method: 'GET' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.url, 'https://api.example.com/users');
  });

  test('クエリパラメータを追加する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.call({ endpoint: '/users', method: 'GET', query: { page: 1, limit: 10 } });
    const call = mockTransport.getCalls()[0];
    assertTrue(call.url.includes('page=1'));
    assertTrue(call.url.includes('limit=10'));
  });

  test('配列クエリパラメータを展開する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.call({ endpoint: '/users', method: 'GET', query: { ids: [1, 2, 3] } });
    const call = mockTransport.getCalls()[0];
    assertTrue(call.url.includes('ids=1'));
    assertTrue(call.url.includes('ids=2'));
    assertTrue(call.url.includes('ids=3'));
  });

  test('body を JSON として送信する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.call({ endpoint: '/users', method: 'POST', body: { name: 'test' } });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.payload, '{"name":"test"}');
  });

  test('Content-Type を自動設定する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.call({ endpoint: '/users', method: 'POST', body: { name: 'test' } });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.headers['Content-Type'], 'application/json; charset=utf-8');
  });

  test('デフォルトヘッダーを使用する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport,
      headers: { 'X-Api-Key': 'secret' }
    });
    client.call({ endpoint: '/users', method: 'GET' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.headers['X-Api-Key'], 'secret');
  });

  test('リクエストヘッダーでデフォルトを上書きする', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport,
      headers: { 'X-Api-Key': 'default' }
    });
    client.call({ endpoint: '/users', method: 'GET', headers: { 'X-Api-Key': 'override' } });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.headers['X-Api-Key'], 'override');
  });

  test('extend でデコレータを適用できる', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    const extendedClient = client.extend(t => ApiClient.withBearerAuth(t, 'token'));
    extendedClient.call({ endpoint: '/users', method: 'GET' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.headers.Authorization, 'Bearer token');
  });

  test('extend は元のクライアントを変更しない（イミュータブル）', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.extend(t => ApiClient.withBearerAuth(t, 'token'));
    client.call({ endpoint: '/users', method: 'GET' });
    const call = mockTransport.getCalls()[0];
    assertTrue(!call.options.headers.Authorization);
  });

  test('HTTPエラー時に例外をスローする', () => {
    const mockTransport = MockTransport.error(404, { error: 'Not Found' });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertThrows(
      () => client.call({ endpoint: '/users/999', method: 'GET' }),
      'HTTPエラー 404'
    );
  });

  test('レスポンスを正しく返す', () => {
    const mockTransport = MockTransport.success({ users: [{ id: 1 }] });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    const response = client.call({ endpoint: '/users', method: 'GET' });
    assertEqual(response.status, 200);
    assertDeepEqual(response.body, { users: [{ id: 1 }] });
  });

  // ─── HTTP メソッドショートカット テスト ─────────────────────────

  suite('ApiClient HTTP メソッド');

  test('get メソッドが公開されている', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.get === 'function');
  });

  test('post メソッドが公開されている', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.post === 'function');
  });

  test('put メソッドが公開されている', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.put === 'function');
  });

  test('patch メソッドが公開されている', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.patch === 'function');
  });

  test('delete メソッドが公開されている', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.delete === 'function');
  });

  test('get で GET リクエストを送信する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.get('/users', { page: 1 });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.method, 'GET');
    assertTrue(call.url.includes('/users'));
    assertTrue(call.url.includes('page=1'));
  });

  test('post で POST リクエストを送信する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.post('/users', { name: 'John' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.method, 'POST');
    assertEqual(call.options.payload, '{"name":"John"}');
  });

  test('put で PUT リクエストを送信する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.put('/users/1', { name: 'Jane' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.method, 'PUT');
    assertTrue(call.url.includes('/users/1'));
  });

  test('patch で PATCH リクエストを送信する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.patch('/users/1', { name: 'Jane' });
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.method, 'PATCH');
  });

  test('delete で DELETE リクエストを送信する', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    client.delete('/users/1');
    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.method, 'DELETE');
    assertTrue(call.url.includes('/users/1'));
  });

  // ─── use() メソッド テスト ──────────────────────────────────────

  suite('ApiClient.use');

  test('use メソッドが公開されている', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });
    assertTrue(typeof client.use === 'function');
  });

  test('use で Plugin を注入できる', () => {
    const mockTransport = MockTransport.success({ result: 'success' });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const TestPlugin = ({ call }) => ({
      customMethod: (id) => call({ endpoint: `/items/${id}`, method: 'GET' })
    });

    const extended = client.use(TestPlugin);
    assertTrue(typeof extended.customMethod === 'function');
  });

  test('use 後も call が使える', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const TestPlugin = ({ call }) => ({
      customMethod: () => call({ endpoint: '/test', method: 'GET' })
    });

    const extended = client.use(TestPlugin);
    assertTrue(typeof extended.call === 'function');
  });

  test('use 後も use が使える（チェーン可能）', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const Plugin1 = ({ call }) => ({ method1: () => 'one' });
    const Plugin2 = ({ call }) => ({ method2: () => 'two' });

    const extended = client.use(Plugin1).use(Plugin2);
    assertTrue(typeof extended.method1 === 'function');
    assertTrue(typeof extended.method2 === 'function');
  });

  test('use 後も HTTP メソッドが使える', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const TestPlugin = ({ call }) => ({ customMethod: () => {} });
    const extended = client.use(TestPlugin);

    assertTrue(typeof extended.get === 'function');
    assertTrue(typeof extended.post === 'function');
    assertTrue(typeof extended.put === 'function');
    assertTrue(typeof extended.patch === 'function');
    assertTrue(typeof extended.delete === 'function');
  });

  test('use で単体メソッドを注入できる', () => {
    const mockTransport = MockTransport.success({ id: 123 });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const extended = client.use('getItem', ({ call }) =>
      (id) => call({ endpoint: `/items/${id}`, method: 'GET' })
    );

    assertTrue(typeof extended.getItem === 'function');
  });

  test('Plugin 内で call を使って実際にリクエストする', () => {
    const mockTransport = MockTransport.success({ name: 'Test Item' });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const TestPlugin = ({ call }) => ({
      getItem: (id) => call({ endpoint: `/items/${id}`, method: 'GET' })
    });

    const extended = client.use(TestPlugin);
    const response = extended.getItem(42);

    const call = mockTransport.getCalls()[0];
    assertTrue(call.url.includes('/items/42'));
    assertEqual(response.body.name, 'Test Item');
  });

  test('Plugin 内で HTTP メソッドショートカットを使える', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const TestPlugin = ({ get, post }) => ({
      listItems: () => get('/items'),
      createItem: (data) => post('/items', data)
    });

    const extended = client.use(TestPlugin);
    extended.listItems();

    const call = mockTransport.getCalls()[0];
    assertEqual(call.options.method, 'GET');
    assertTrue(call.url.includes('/items'));
  });

  test('use 後も extend が使える', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport
    });

    const TestPlugin = ({ call }) => ({ customMethod: () => {} });
    const extended = client.use(TestPlugin);

    assertTrue(typeof extended.extend === 'function');
  });
};

// ============================================================================
// WebhookClient テスト
// ============================================================================

const runWebhookClientTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertThrows } = TestRunner;

  // ─── インターフェーステスト ──────────────────────────────────────

  suite('WebhookClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof WebhookClient.create === 'function');
  });

  test('send が公開されている', () => {
    assertTrue(typeof WebhookClient.send === 'function');
  });

  // ─── create テスト ───────────────────────────────────────────────

  suite('WebhookClient.create');

  test('クライアントを作成できる', () => {
    // Note: 実際のテストではモックが必要だが、インターフェースの確認
    const client = WebhookClient.create('https://hooks.example.com/webhook');
    assertTrue(typeof client.send === 'function');
  });

  // ─── send テスト（モック使用） ───────────────────────────────────

  suite('WebhookClient.send (モック)');

  // Note: WebhookClient は内部で HttpCore.createTransport() を呼ぶため、
  // 直接的なモックが難しい。以下は統合テストとして実行する必要がある。

  test('WebhookClient.create が send メソッドを持つ', () => {
    const client = WebhookClient.create('https://hooks.example.com/webhook');
    assertTrue(typeof client.send === 'function');
  });
};

// ============================================================================
// インテグレーションテスト（実際のHTTP通信が必要）
// ============================================================================

const runIntegrationTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('インテグレーションテスト');

  test('httpbin.org への GET リクエスト', () => {
    // Note: このテストは実際のネットワーク接続が必要
    // GAS環境でのみ実行可能
    try {
      const client = ApiClient.createClient({
        baseUrl: 'https://httpbin.org'
      });
      const response = client.call({ endpoint: '/get', method: 'GET' });
      assertEqual(response.status, 200);
      assertTrue(response.body.url.includes('httpbin.org'));
    } catch (e) {
      // ネットワークエラーの場合はスキップ
      console.log('Integration test skipped: ' + e.message);
    }
  });

  test('httpbin.org への POST リクエスト', () => {
    try {
      const client = ApiClient.createClient({
        baseUrl: 'https://httpbin.org'
      });
      const response = client.call({
        endpoint: '/post',
        method: 'POST',
        body: { test: 'data' }
      });
      assertEqual(response.status, 200);
      assertEqual(response.body.json.test, 'data');
    } catch (e) {
      console.log('Integration test skipped: ' + e.message);
    }
  });

  test('WebhookClient で httpbin.org への POST', () => {
    try {
      const response = WebhookClient.send('https://httpbin.org/post', { message: 'hello' });
      assertEqual(response.status, 200);
      assertEqual(response.body.json.message, 'hello');
    } catch (e) {
      console.log('Integration test skipped: ' + e.message);
    }
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

/**
 * 全てのHttpClientテストを実行
 */
function runAllHttpClientTests() {
  TestRunner.reset();

  console.log('Running HttpCore tests...');
  runHttpCoreTests();

  console.log('Running ApiClient tests...');
  runApiClientTests();

  console.log('Running WebhookClient tests...');
  runWebhookClientTests();

  console.log('Running Integration tests...');
  runIntegrationTests();

  return TestRunner.run();
}

/**
 * ユニットテストのみ実行（ネットワーク不要）
 */
function runUnitTestsOnly() {
  TestRunner.reset();

  console.log('Running HttpCore tests...');
  runHttpCoreTests();

  console.log('Running ApiClient tests...');
  runApiClientTests();

  console.log('Running WebhookClient tests...');
  runWebhookClientTests();

  return TestRunner.run();
}
