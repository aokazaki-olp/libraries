'use strict';

/**
 * LoggerFacade.test.gs
 *
 * @description LoggerFacade のテストスイート
 *
 * 実行方法:
 *   GAS エディタから runAllLoggerFacadeTests() を実行
 */

// ============================================================================
// LoggerFacade テスト
// ============================================================================

const runLoggerFacadeTests = () => {
  const { suite, test, assertEqual, assertTrue, assertFalse } = TestRunner;

  // ─── createLogger 基本テスト ──────────────────────────────────────

  suite('LoggerFacade.createLogger 基本');

  test('null を渡すと null を返す', () => {
    const logger = LoggerFacade.createLogger(null);
    assertEqual(logger, null);
  });

  test('undefined を渡すと null を返す', () => {
    const logger = LoggerFacade.createLogger(undefined);
    assertEqual(logger, null);
  });

  test('false を渡すと null を返す', () => {
    const logger = LoggerFacade.createLogger(false);
    assertEqual(logger, null);
  });

  test('0 を渡すと null を返す', () => {
    const logger = LoggerFacade.createLogger(0);
    assertEqual(logger, null);
  });

  test('空文字を渡すと null を返す', () => {
    const logger = LoggerFacade.createLogger('');
    assertEqual(logger, null);
  });

  test('有効なオブジェクトで Logger インターフェースを返す', () => {
    const logger = LoggerFacade.createLogger({ log: () => {} });
    assertTrue(typeof logger.trace === 'function');
    assertTrue(typeof logger.debug === 'function');
    assertTrue(typeof logger.info === 'function');
    assertTrue(typeof logger.warn === 'function');
    assertTrue(typeof logger.error === 'function');
  });

  // ─── console 互換テスト ───────────────────────────────────────────

  suite('LoggerFacade console 互換');

  test('console 互換オブジェクトのメソッド解決', () => {
    const calls = [];
    const mockConsole = {
      trace: (...args) => calls.push({ method: 'trace', args }),
      debug: (...args) => calls.push({ method: 'debug', args }),
      info: (...args) => calls.push({ method: 'info', args }),
      warn: (...args) => calls.push({ method: 'warn', args }),
      error: (...args) => calls.push({ method: 'error', args }),
      log: (...args) => calls.push({ method: 'log', args })
    };
    const logger = LoggerFacade.createLogger(mockConsole);

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assertEqual(calls[0].method, 'trace');
    assertEqual(calls[1].method, 'debug');
    assertEqual(calls[2].method, 'info');
    assertEqual(calls[3].method, 'warn');
    assertEqual(calls[4].method, 'error');
  });

  test('引数が正しく伝搬される', () => {
    const calls = [];
    const mockConsole = {
      info: (...args) => calls.push(args)
    };
    const logger = LoggerFacade.createLogger(mockConsole);

    logger.info('message', { detail: 'value' });
    assertEqual(calls[0][0], 'message');
    assertEqual(calls[0][1].detail, 'value');
  });

  // ─── GAS Logger 互換テスト（log のみ）─────────────────────────────

  suite('LoggerFacade GAS Logger 互換');

  test('log のみ持つオブジェクトで全レベルが log にフォールバック', () => {
    const calls = [];
    const mockGasLogger = {
      log: (...args) => calls.push(args)
    };
    const logger = LoggerFacade.createLogger(mockGasLogger);

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assertEqual(calls.length, 5);
  });

  // ─── java.util.logging 互換テスト ────────────────────────────────

  suite('LoggerFacade java.util.logging 互換');

  test('finest/fine/warning/severe が正しく解決される', () => {
    const calls = [];
    const mockJavaLogger = {
      finest: (...args) => calls.push({ method: 'finest', args }),
      finer: (...args) => calls.push({ method: 'finer', args }),
      fine: (...args) => calls.push({ method: 'fine', args }),
      info: (...args) => calls.push({ method: 'info', args }),
      warning: (...args) => calls.push({ method: 'warning', args }),
      severe: (...args) => calls.push({ method: 'severe', args })
    };
    const logger = LoggerFacade.createLogger(mockJavaLogger);

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    // trace → finest (1st priority)
    assertEqual(calls[0].method, 'finest');
    // debug → fine (2nd priority after debug which doesn't exist... wait it checks debug first)
    // Actually resolve order for debug is: 'debug', 'fine', 'log'
    // mockJavaLogger doesn't have 'debug', so it falls to 'fine'
    assertEqual(calls[1].method, 'fine');
    // info → info
    assertEqual(calls[2].method, 'info');
    // warn → warning (2nd priority after warn which doesn't exist)
    // Actually resolve order for warn is: 'warn', 'warning', 'log'
    // mockJavaLogger doesn't have 'warn', so it falls to 'warning'
    assertEqual(calls[3].method, 'warning');
    // error → severe (2nd priority after error which doesn't exist)
    // Actually resolve order for error is: 'error', 'severe', 'log'
    // mockJavaLogger doesn't have 'error', so it falls to 'severe'
    assertEqual(calls[4].method, 'severe');
  });

  // ─── 優先順位テスト ──────────────────────────────────────────────

  suite('LoggerFacade メソッド解決優先順位');

  test('trace: trace が最優先', () => {
    const calls = [];
    const mock = {
      trace: (...args) => calls.push('trace'),
      finest: (...args) => calls.push('finest'),
      debug: (...args) => calls.push('debug')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.trace('msg');
    assertEqual(calls[0], 'trace');
  });

  test('trace: trace がなければ finest', () => {
    const calls = [];
    const mock = {
      finest: (...args) => calls.push('finest'),
      finer: (...args) => calls.push('finer'),
      debug: (...args) => calls.push('debug')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.trace('msg');
    assertEqual(calls[0], 'finest');
  });

  test('trace: finest もなければ finer', () => {
    const calls = [];
    const mock = {
      finer: (...args) => calls.push('finer'),
      debug: (...args) => calls.push('debug')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.trace('msg');
    assertEqual(calls[0], 'finer');
  });

  test('trace: finer もなければ debug', () => {
    const calls = [];
    const mock = {
      debug: (...args) => calls.push('debug'),
      log: (...args) => calls.push('log')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.trace('msg');
    assertEqual(calls[0], 'debug');
  });

  test('trace: debug もなければ log', () => {
    const calls = [];
    const mock = {
      log: (...args) => calls.push('log')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.trace('msg');
    assertEqual(calls[0], 'log');
  });

  test('warn: warn が最優先', () => {
    const calls = [];
    const mock = {
      warn: (...args) => calls.push('warn'),
      warning: (...args) => calls.push('warning')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.warn('msg');
    assertEqual(calls[0], 'warn');
  });

  test('warn: warn がなければ warning', () => {
    const calls = [];
    const mock = {
      warning: (...args) => calls.push('warning'),
      log: (...args) => calls.push('log')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.warn('msg');
    assertEqual(calls[0], 'warning');
  });

  test('error: error が最優先', () => {
    const calls = [];
    const mock = {
      error: (...args) => calls.push('error'),
      severe: (...args) => calls.push('severe')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.error('msg');
    assertEqual(calls[0], 'error');
  });

  test('error: error がなければ severe', () => {
    const calls = [];
    const mock = {
      severe: (...args) => calls.push('severe'),
      log: (...args) => calls.push('log')
    };
    const logger = LoggerFacade.createLogger(mock);
    logger.error('msg');
    assertEqual(calls[0], 'severe');
  });

  // ─── エッジケース ─────────────────────────────────────────────────

  suite('LoggerFacade エッジケース');

  test('メソッドが一切ないオブジェクトでもエラーにならない', () => {
    const logger = LoggerFacade.createLogger({});
    // 全メソッドが no-op 関数になる
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    // エラーが出なければ成功
    assertTrue(true);
  });

  test('メソッドでないプロパティは無視される', () => {
    const logger = LoggerFacade.createLogger({
      log: 'not a function',
      info: 42,
      warn: true
    });
    // 全メソッドが no-op 関数になる
    logger.info('msg');
    logger.warn('msg');
    assertTrue(true);
  });

  test('複数引数が正しく伝搬される', () => {
    const calls = [];
    const mock = {
      error: (...args) => calls.push(args)
    };
    const logger = LoggerFacade.createLogger(mock);
    const err = new Error('test error');
    logger.error('message', err, { extra: 'data' });
    assertEqual(calls[0].length, 3);
    assertEqual(calls[0][0], 'message');
    assertEqual(calls[0][1], err);
    assertEqual(calls[0][2].extra, 'data');
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllLoggerFacadeTests() {
  TestRunner.reset();

  console.log('Running LoggerFacade tests...');
  runLoggerFacadeTests();

  return TestRunner.run();
}
