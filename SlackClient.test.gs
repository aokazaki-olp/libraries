'use strict';

/**
 * SlackClient.test.gs
 *
 * @description SlackClient.gs (SlackApiClient / SlackWebhookClient) のテストスイート
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-02
 *
 * 実行方法:
 *   GAS エディタから runAllSlackClientTests() を実行
 */

// ============================================================================
// SlackApiClient テスト
// ============================================================================

const runSlackApiClientTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

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

  return TestRunner.run();
}
