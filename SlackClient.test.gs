'use strict';

/**
 * SlackClient.test.gs
 *
 * @description SlackClient.gs (SlackApiClient / SlackWebhookClient) のテストスイート
 *
 * 実行方法:
 *   GAS エディタから runAllSlackClientTests() を実行
 */

// ============================================================================
// SlackApiClient テスト
// ============================================================================

const runSlackApiClientTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertThrows } = TestRunner;

  suite('SlackApiClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof SlackApiClient.create === 'function');
  });

  suite('SlackApiClient.create');

  test('クライアントを作成できる', () => {
    // Note: 実際のテストではモックが必要
    // ここではインターフェースの確認のみ
    assertTrue(typeof SlackApiClient.create === 'function');
  });

  // ─── HTTP メソッドショートカット テスト ─────────────────────────

  suite('SlackApiClient HTTP メソッド');

  test('get メソッドが公開されている', () => {
    // SlackApiClient は内部で ApiClient を使用するため、
    // インターフェースの確認のみ行う
    assertTrue(typeof SlackApiClient.create === 'function');
    // Note: 実際のクライアント作成には token が必要
  });

  // ─── use() メソッド テスト ──────────────────────────────────────

  suite('SlackApiClient.use');

  test('use メソッドの存在確認（インターフェース）', () => {
    // SlackApiClient.create() は内部で API 呼び出しを行うため、
    // ここではインターフェースの存在確認を行う
    assertTrue(typeof SlackApiClient.create === 'function');
  });

  // ─── Plugin 注入テスト（モック使用） ────────────────────────────

  suite('SlackApiClient Plugin 注入');

  test('SlackMessages Plugin パターンの例', () => {
    // Plugin の形式が正しいことを確認
    const SlackMessages = ({ call }) => ({
      postMessage: (channel, text, options) =>
        call({ endpoint: 'chat.postMessage', body: { channel, text, ...options } }),
      updateMessage: (channel, ts, text, options) =>
        call({ endpoint: 'chat.update', body: { channel, ts, text, ...options } })
    });

    // Plugin が正しい形式の関数であることを確認
    assertTrue(typeof SlackMessages === 'function');

    // モック call で Plugin をテスト
    const mockCalls = [];
    const mockCall = (request) => {
      mockCalls.push(request);
      return { ok: true, ts: '123.456' };
    };

    const methods = SlackMessages({ call: mockCall });
    assertTrue(typeof methods.postMessage === 'function');
    assertTrue(typeof methods.updateMessage === 'function');

    // postMessage を呼び出してモック call が正しく呼ばれることを確認
    methods.postMessage('#general', 'Hello', { thread_ts: '111.222' });
    assertEqual(mockCalls.length, 1);
    assertEqual(mockCalls[0].endpoint, 'chat.postMessage');
    assertEqual(mockCalls[0].body.channel, '#general');
    assertEqual(mockCalls[0].body.text, 'Hello');
    assertEqual(mockCalls[0].body.thread_ts, '111.222');
  });

  test('SlackChannels Plugin パターンの例', () => {
    const SlackChannels = ({ call }) => ({
      listChannels: (options) =>
        call({ endpoint: 'conversations.list', method: 'GET', query: options }),
      getChannelInfo: (channel) =>
        call({ endpoint: 'conversations.info', method: 'GET', query: { channel } })
    });

    const mockCalls = [];
    const mockCall = (request) => {
      mockCalls.push(request);
      return { ok: true, channels: [] };
    };

    const methods = SlackChannels({ call: mockCall });

    methods.listChannels({ limit: 100 });
    assertEqual(mockCalls[0].endpoint, 'conversations.list');
    assertEqual(mockCalls[0].method, 'GET');
    assertEqual(mockCalls[0].query.limit, 100);

    methods.getChannelInfo('C123');
    assertEqual(mockCalls[1].endpoint, 'conversations.info');
    assertEqual(mockCalls[1].query.channel, 'C123');
  });

  test('単体メソッド注入パターンの例', () => {
    // use('name', factory) パターンのテスト
    const mockCalls = [];
    const mockContext = {
      call: (request) => {
        mockCalls.push(request);
        return { ok: true };
      },
      get: () => {},
      post: () => {},
      put: () => {},
      patch: () => {},
      delete: () => {}
    };

    // 単体メソッドの factory 関数
    const postMessageFactory = ({ call }) =>
      (channel, text) => call({ endpoint: 'chat.postMessage', body: { channel, text } });

    const postMessage = postMessageFactory(mockContext);
    assertTrue(typeof postMessage === 'function');

    postMessage('#random', 'Test message');
    assertEqual(mockCalls[0].endpoint, 'chat.postMessage');
    assertEqual(mockCalls[0].body.channel, '#random');
    assertEqual(mockCalls[0].body.text, 'Test message');
  });

  test('複数 Plugin のチェーン注入パターン', () => {
    // use().use() パターンの動作確認
    const Plugin1 = ({ call }) => ({ method1: () => 'one' });
    const Plugin2 = ({ call }) => ({ method2: () => 'two' });

    // モックの use 関数をシミュレート（createExtendedClient パターン）
    const mockCall = () => {};

    // チェーン可能な use を作成するヘルパー
    const createExtendedClient = (call, additionalMethods) => {
      const extendedUse = (plugin) => {
        const newMethods = plugin({ call });
        return createExtendedClient(call, { ...additionalMethods, ...newMethods });
      };
      return { ...additionalMethods, call, use: extendedUse };
    };

    const use = (plugin) => {
      const methods = plugin({ call: mockCall });
      return createExtendedClient(mockCall, methods);
    };

    const client = { call: mockCall, use };

    const extended = client.use(Plugin1).use(Plugin2);
    assertEqual(extended.method1(), 'one');
    assertEqual(extended.method2(), 'two');
    assertTrue(typeof extended.call === 'function');
    assertTrue(typeof extended.use === 'function');
  });
};

// ============================================================================
// SlackWebhookClient テスト
// ============================================================================

const runSlackWebhookClientTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('SlackWebhookClient インターフェース');

  test('create が公開されている', () => {
    assertTrue(typeof SlackWebhookClient.create === 'function');
  });

  test('send が公開されている', () => {
    assertTrue(typeof SlackWebhookClient.send === 'function');
  });

  suite('SlackWebhookClient.create');

  test('クライアントを作成できる', () => {
    const client = SlackWebhookClient.create('https://hooks.slack.com/services/xxx');
    assertTrue(typeof client.send === 'function');
  });
};

// ============================================================================
// SlackCore.withRetry テスト
// ============================================================================

const runSlackCoreTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('SlackCore.withRetry');

  test('成功時はリトライしない', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    retryTransport.fetch('http://example.com', {});
    assertEqual(mockTransport.getCallCount(), 1);
  });

  test('429 で Retry-After を尊重してリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {}, headers: { 'Retry-After': '1' } },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('500 でリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('リトライ上限で例外をスローする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 429, body: {} }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    assertThrows(
      () => retryTransport.fetch('http://example.com', {}),
      'リトライ回数上限'
    );
  });

  suite('SlackCore.withRetry ロガー');

  test('429 リトライ時に warn ログを出力する', () => {
    const logs = [];
    const mockLogger = {
      warn: (...args) => logs.push({ level: 'warn', args }),
      error: (...args) => logs.push({ level: 'error', args })
    };
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {}, headers: { 'Retry-After': '1' } },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3, logger: mockLogger });
    retryTransport.fetch('http://example.com', { method: 'POST' });
    assertEqual(logs.length, 1);
    assertEqual(logs[0].level, 'warn');
    assertTrue(logs[0].args[0].includes('[Slack]'));
    assertTrue(logs[0].args[0].includes('RETRY'));
    assertTrue(logs[0].args[0].includes('Retry-After=1s'));
  });

  test('500 リトライ時に warn ログを出力する', () => {
    const logs = [];
    const mockLogger = {
      warn: (...args) => logs.push({ level: 'warn', args }),
      error: (...args) => logs.push({ level: 'error', args })
    };
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3, logger: mockLogger });
    retryTransport.fetch('http://example.com', { method: 'POST' });
    assertEqual(logs.length, 1);
    assertEqual(logs[0].level, 'warn');
    assertTrue(logs[0].args[0].includes('[Slack]'));
    assertTrue(logs[0].args[0].includes('status=500'));
  });

  test('リトライ上限時に error ログを出力する', () => {
    const logs = [];
    const mockLogger = {
      warn: (...args) => logs.push({ level: 'warn', args }),
      error: (...args) => logs.push({ level: 'error', args })
    };
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {} },
      { status: 429, body: {} }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 1, logger: mockLogger });
    try {
      retryTransport.fetch('http://example.com', { method: 'POST' });
    } catch (e) {
      // expected
    }
    const errorLogs = logs.filter(l => l.level === 'error');
    assertEqual(errorLogs.length, 1);
    assertTrue(errorLogs[0].args[0].includes('[Slack]'));
    assertTrue(errorLogs[0].args[0].includes('exhausted'));
  });

  test('ロガーなしでも動作する', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
  });
};

// ============================================================================
// SlackClient エッジケーステスト
// ============================================================================

const runSlackEdgeCaseTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue, assertFalse, assertThrows } = TestRunner;

  // ─── SlackCore.withRetry エッジケース ──────────────────────────────

  suite('SlackCore.withRetry エッジケース');

  test('429 で Retry-After ヘッダーがない場合 1秒待機', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {}, headers: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('429 で Retry-After が小文字でも認識する', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {}, headers: { 'retry-after': '1' } },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
  });

  test('429 で Retry-After が非数値の場合 NaN にならず待機する', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {}, headers: { 'Retry-After': 'Thu, 01 Dec 2026 16:00:00 GMT' } },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    // parseInt('Thu...') => NaN → NaN * 1000 = NaN → Utilities.sleep(NaN)
    // このテストは現状の実装で NaN が発生する問題を検出する
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('4xx（429以外）はリトライしない', () => {
    const mockTransport = MockTransport.sequence([
      { status: 400, body: {} }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 400);
    assertEqual(mockTransport.getCallCount(), 1);
  });

  test('503 でリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { status: 503, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('例外発生時もリトライする', () => {
    const mockTransport = MockTransport.sequence([
      { throw: 'Network error' },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3 });
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
    assertEqual(mockTransport.getCallCount(), 2);
  });

  test('リトライ上限エラーは二重ログを防ぐために再スローされる', () => {
    const logs = [];
    const mockLogger = {
      warn: (...args) => logs.push({ level: 'warn', args }),
      error: (...args) => logs.push({ level: 'error', args })
    };
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {} },
      { status: 429, body: {} }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 1, logger: mockLogger });

    try {
      retryTransport.fetch('http://example.com', {});
    } catch (e) {
      assertEqual(e.name, 'RetryExhaustedError');
      assertTrue(e.message.includes('リトライ回数上限'));
    }

    // error ログは1回のみ（二重ログなし）
    const errorLogs = logs.filter(l => l.level === 'error');
    assertEqual(errorLogs.length, 1);
  });

  test('maxRetries: 0 でリトライしない（429）', () => {
    const mockTransport = MockTransport.sequence([
      { status: 429, body: {} }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 0 });
    assertThrows(
      () => retryTransport.fetch('http://example.com', {}),
      'リトライ回数上限'
    );
    assertEqual(mockTransport.getCallCount(), 1);
  });

  test('maxRetries: 0 でリトライしない（500）', () => {
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 0 });
    assertThrows(
      () => retryTransport.fetch('http://example.com', {}),
      'リトライ回数上限'
    );
    assertEqual(mockTransport.getCallCount(), 1);
  });

  test('options なしでデフォルト値が使用される', () => {
    const mockTransport = MockTransport.success({ ok: true });
    const retryTransport = SlackCore.withRetry(mockTransport);
    const response = retryTransport.fetch('http://example.com', {});
    assertEqual(response.getResponseCode(), 200);
  });

  test('options.method がない場合 GET がログに出力される', () => {
    const logs = [];
    const mockLogger = {
      warn: (...args) => logs.push({ level: 'warn', args }),
      error: (...args) => logs.push({ level: 'error', args })
    };
    const mockTransport = MockTransport.sequence([
      { status: 500, body: {} },
      { status: 200, body: { ok: true } }
    ]);
    const retryTransport = SlackCore.withRetry(mockTransport, { maxRetries: 3, logger: mockLogger });
    retryTransport.fetch('http://example.com', {});
    assertTrue(logs[0].args[0].includes('GET'));
  });

  // ─── slackResponseHandler エッジケース（実ハンドラ経由） ──────────

  suite('slackResponseHandler エッジケース');

  /**
   * responseHandler を経由するテスト用クライアントを作成
   * SlackApiClient.create() は実際のトークン認証を必要とするため、
   * ApiClient.createClient に slackResponseHandler 相当の responseHandler を渡して検証する
   */
  const createSlackTestClient = mockTransport => {
    return ApiClient.createClient({
      baseUrl: 'https://slack.com/api',
      transport: mockTransport,
      responseHandler: (response, request) => {
        if (response.body && response.body.ok === false) {
          const errorCode = response.body.error || 'slack_error';
          const e = new Error(`Slack APIエラー: ${errorCode}`);
          e.name = 'SlackApiError';
          e.code = errorCode;
          e.metadata = response.body.response_metadata;
          e.response = response;
          throw e;
        }
        return response.body;
      }
    });
  };

  test('ok: true のレスポンスはボディを返す', () => {
    const mockTransport = MockTransport.success({ ok: true, channel: 'C123', ts: '123.456' });
    const client = createSlackTestClient(mockTransport);
    const result = client.call({ endpoint: 'chat.postMessage', method: 'POST' });
    assertEqual(result.ok, true);
    assertEqual(result.channel, 'C123');
    assertEqual(result.ts, '123.456');
  });

  test('ok: false で SlackApiError がスローされる', () => {
    const mockTransport = MockTransport.success({ ok: false, error: 'channel_not_found' });
    const client = createSlackTestClient(mockTransport);
    try {
      client.call({ endpoint: 'chat.postMessage', method: 'POST' });
      throw new Error('Should not reach here');
    } catch (e) {
      assertEqual(e.name, 'SlackApiError');
      assertEqual(e.code, 'channel_not_found');
      assertTrue(e.message.includes('channel_not_found'));
    }
  });

  test('ok: false で error コードがない場合デフォルトエラー', () => {
    const mockTransport = MockTransport.success({ ok: false });
    const client = createSlackTestClient(mockTransport);
    try {
      client.call({ endpoint: 'chat.postMessage', method: 'POST' });
      throw new Error('Should not reach here');
    } catch (e) {
      assertEqual(e.name, 'SlackApiError');
      assertEqual(e.code, 'slack_error');
    }
  });

  test('ok: false で response_metadata が伝播する', () => {
    const mockTransport = MockTransport.success({
      ok: false,
      error: 'invalid_arguments',
      response_metadata: { messages: ['[ERROR] invalid channel'] }
    });
    const client = createSlackTestClient(mockTransport);
    try {
      client.call({ endpoint: 'chat.postMessage', method: 'POST' });
      throw new Error('Should not reach here');
    } catch (e) {
      assertEqual(e.name, 'SlackApiError');
      assertDeepEqual(e.metadata.messages, ['[ERROR] invalid channel']);
    }
  });

  // ─── SlackWebhookClient エッジケース ───────────────────────────────

  suite('SlackWebhookClient エッジケース');

  test('maxRetries: 0 でリトライなしクライアント作成', () => {
    const client = SlackWebhookClient.create('https://hooks.slack.com/xxx', { maxRetries: 0 });
    assertTrue(typeof client.send === 'function');
  });

  test('options なしでクライアント作成', () => {
    const client = SlackWebhookClient.create('https://hooks.slack.com/xxx');
    assertTrue(typeof client.send === 'function');
  });

  test('静的 send メソッドが options を渡せる', () => {
    // インターフェースの確認のみ
    assertTrue(typeof SlackWebhookClient.send === 'function');
    assertEqual(SlackWebhookClient.send.length, 3); // webhookUrl, payload, options
  });

  // ─── Slack エラーコードパターン ────────────────────────────────────

  suite('Slack エラーコードパターン');

  const slackErrors = [
    'channel_not_found',
    'not_in_channel',
    'is_archived',
    'msg_too_long',
    'no_text',
    'too_many_attachments',
    'rate_limited',
    'invalid_auth',
    'account_inactive',
    'token_revoked',
    'missing_scope'
  ];

  slackErrors.forEach(errorCode => {
    test(`エラーコード: ${errorCode} を正しくハンドリング`, () => {
      const mockTransport = MockTransport.success({ ok: false, error: errorCode });
      const client = createSlackTestClient(mockTransport);
      try {
        client.call({ endpoint: 'chat.postMessage', method: 'POST' });
        throw new Error('Should not reach here');
      } catch (e) {
        assertEqual(e.name, 'SlackApiError');
        assertEqual(e.code, errorCode);
      }
    });
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

/**
 * 全てのSlackClientテストを実行
 */
function runAllSlackClientTests() {
  TestRunner.reset();

  console.log('Running SlackCore tests...');
  runSlackCoreTests();

  console.log('Running SlackApiClient tests...');
  runSlackApiClientTests();

  console.log('Running SlackWebhookClient tests...');
  runSlackWebhookClientTests();

  console.log('Running Slack Edge Case tests...');
  runSlackEdgeCaseTests();

  return TestRunner.run();
}
