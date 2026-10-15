import { describe, it, expect, vi } from 'vitest';
import { LoggerFacade } from '../src/LoggerFacade.ts';
import type { Logger } from '../src/LoggerFacade.ts';

/** null でないロガーを作る（null ならテストを失敗させる） */
const createNonNullLogger = (backend: unknown): Logger => {
  const logger = LoggerFacade.createLogger(backend);
  if (logger === null) {
    throw new Error('createLogger が null を返しました');
  }
  return logger;
};

// ============================================================================
// createLogger(null / falsy)
// ============================================================================

describe('LoggerFacade.createLogger — null / falsy', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['false', false],
    ['0', 0],
    ['空文字', ''],
  ])('%s を渡すと null を返す', (_label, value) => {
    expect(LoggerFacade.createLogger(value)).toBeNull();
  });

  it.each([
    ['true', true],
    ['数値', 1],
    ['文字列', 'console'],
  ])('偽値でないプリミティブ（%s）は TypeError（黙ってロガー無しにしない）', (_label, value) => {
    expect(() => LoggerFacade.createLogger(value)).toThrow(TypeError);
  });
});

// ============================================================================
// createLogger — Logger インターフェース
// ============================================================================

describe('LoggerFacade.createLogger — Loggerインターフェース', () => {
  it('返り値は trace/debug/info/warn/error を持つ', () => {
    const logger = LoggerFacade.createLogger(console);
    expect(logger).not.toBeNull();
    expect(typeof logger?.trace).toBe('function');
    expect(typeof logger?.debug).toBe('function');
    expect(typeof logger?.info).toBe('function');
    expect(typeof logger?.warn).toBe('function');
    expect(typeof logger?.error).toBe('function');
  });
});

// ============================================================================
// メソッド解決の優先順位
// ============================================================================

describe('LoggerFacade.createLogger — メソッド解決', () => {
  it('trace: trace を最優先で解決する', () => {
    const trace = vi.fn();
    const finest = vi.fn();
    const backend = { trace, finest, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.trace('msg');
    expect(trace).toHaveBeenCalledWith('msg');
    expect(finest).not.toHaveBeenCalled();
  });

  it('trace: trace がなければ finest にフォールバック', () => {
    const finest = vi.fn();
    const backend = { finest, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.trace('msg');
    expect(finest).toHaveBeenCalledWith('msg');
  });

  it('trace: finest もなければ finer にフォールバック', () => {
    const finer = vi.fn();
    const backend = { finer, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.trace('msg');
    expect(finer).toHaveBeenCalledWith('msg');
  });

  it('どのレベルかに対応するメソッドが無ければ TypeError（黙って noop にしない）', () => {
    expect(() => LoggerFacade.createLogger({})).toThrow(
      'logger に trace / debug / info / warn / error に対応するメソッドがありません',
    );
    expect(() => LoggerFacade.createLogger({ info: vi.fn() })).toThrow(
      'logger に trace / debug / warn / error に対応するメソッドがありません',
    );
  });

  it('作成後にメソッドが関数でなくなったら、呼び出し時に TypeError', () => {
    const backend: Record<string, unknown> = { log: vi.fn() };
    const logger = createNonNullLogger(backend);
    backend['log'] = 'gone';
    expect(() => {
      logger.info('msg');
    }).toThrow('logger.log が関数ではなくなりました');
  });

  it('debug: debug を最優先で解決する', () => {
    const debug = vi.fn();
    const backend = { debug, fine: vi.fn(), log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.debug('msg');
    expect(debug).toHaveBeenCalledWith('msg');
  });

  it('debug: debug がなければ fine にフォールバック', () => {
    const fine = vi.fn();
    const backend = { fine, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.debug('msg');
    expect(fine).toHaveBeenCalledWith('msg');
  });

  it('info: info を最優先で解決する', () => {
    const info = vi.fn();
    const backend = { info, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.info('msg');
    expect(info).toHaveBeenCalledWith('msg');
  });

  it('info: info がなければ log にフォールバック', () => {
    const log = vi.fn();
    const backend = { log };
    const logger = createNonNullLogger(backend);
    logger.info('msg');
    expect(log).toHaveBeenCalledWith('msg');
  });

  it('warn: warn を最優先で解決する', () => {
    const warn = vi.fn();
    const backend = { warn, warning: vi.fn(), log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.warn('msg');
    expect(warn).toHaveBeenCalledWith('msg');
  });

  it('warn: warn がなければ warning にフォールバック', () => {
    const warning = vi.fn();
    const backend = { warning, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.warn('msg');
    expect(warning).toHaveBeenCalledWith('msg');
  });

  it('error: error を最優先で解決する', () => {
    const error = vi.fn();
    const backend = { error, severe: vi.fn(), log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.error('msg');
    expect(error).toHaveBeenCalledWith('msg');
  });

  it('error: error がなければ severe にフォールバック', () => {
    const severe = vi.fn();
    const backend = { severe, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    logger.error('msg');
    expect(severe).toHaveBeenCalledWith('msg');
  });
});

// ============================================================================
// 引数の透過
// ============================================================================

describe('LoggerFacade.createLogger — 引数の透過', () => {
  it('複数引数をそのままロガーに渡す', () => {
    const info = vi.fn();
    const backend = { info, log: vi.fn() };
    const logger = createNonNullLogger(backend);
    const err = new Error('test');
    logger.info('message', err, { extra: 1 });
    expect(info).toHaveBeenCalledWith('message', err, { extra: 1 });
  });

  it('引数なしでも呼べる', () => {
    const info = vi.fn();
    const logger = createNonNullLogger({ info, log: vi.fn() });
    expect(() => {
      logger.info();
    }).not.toThrow();
    expect(info).toHaveBeenCalledWith();
  });
});

// ============================================================================
// console 互換
// ============================================================================

describe('LoggerFacade.createLogger — console互換', () => {
  it('console を渡してもエラーにならない', () => {
    const logger = LoggerFacade.createLogger(console);
    expect(logger).not.toBeNull();
    // console.error はテスト出力を汚さないようにスパイで差し替える
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger?.error('test error');
    expect(spy).toHaveBeenCalledWith('test error');
    spy.mockRestore();
  });
});

// ============================================================================
// winston / pino 互換（info/warn/error を持つもの）
// ============================================================================

describe('LoggerFacade.createLogger — winston/pino互換', () => {
  it('winston スタイルのロガーを解決できる', () => {
    const winstonLike = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const logger = createNonNullLogger(winstonLike);
    logger.info('hello');
    logger.warn('world');
    expect(winstonLike.info).toHaveBeenCalledWith('hello');
    expect(winstonLike.warn).toHaveBeenCalledWith('world');
  });
});
