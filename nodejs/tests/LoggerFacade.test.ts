import { describe, it, expect, vi } from 'vitest';
import { LoggerFacade } from '../src/LoggerFacade.js';

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
});

// ============================================================================
// createLogger — Logger インターフェース
// ============================================================================

describe('LoggerFacade.createLogger — Loggerインターフェース', () => {
  it('返り値は trace/debug/info/warn/error を持つ', () => {
    const logger = LoggerFacade.createLogger(console);
    expect(logger).not.toBeNull();
    expect(typeof logger!.trace).toBe('function');
    expect(typeof logger!.debug).toBe('function');
    expect(typeof logger!.info).toBe('function');
    expect(typeof logger!.warn).toBe('function');
    expect(typeof logger!.error).toBe('function');
  });
});

// ============================================================================
// メソッド解決の優先順位
// ============================================================================

describe('LoggerFacade.createLogger — メソッド解決', () => {
  it('trace: trace を最優先で解決する', () => {
    const trace = vi.fn();
    const finest = vi.fn();
    const impl = { trace, finest, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.trace('msg');
    expect(trace).toHaveBeenCalledWith('msg');
    expect(finest).not.toHaveBeenCalled();
  });

  it('trace: trace がなければ finest にフォールバック', () => {
    const finest = vi.fn();
    const impl = { finest, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.trace('msg');
    expect(finest).toHaveBeenCalledWith('msg');
  });

  it('trace: finest もなければ finer にフォールバック', () => {
    const finer = vi.fn();
    const impl = { finer, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.trace('msg');
    expect(finer).toHaveBeenCalledWith('msg');
  });

  it('trace: 候補が全てなければ何もしない（noop）', () => {
    const impl = {};
    const logger = LoggerFacade.createLogger(impl)!;
    expect(() => logger.trace('msg')).not.toThrow();
  });

  it('debug: debug を最優先で解決する', () => {
    const debug = vi.fn();
    const impl = { debug, fine: vi.fn(), log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.debug('msg');
    expect(debug).toHaveBeenCalledWith('msg');
  });

  it('debug: debug がなければ fine にフォールバック', () => {
    const fine = vi.fn();
    const impl = { fine, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.debug('msg');
    expect(fine).toHaveBeenCalledWith('msg');
  });

  it('info: info を最優先で解決する', () => {
    const info = vi.fn();
    const impl = { info, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.info('msg');
    expect(info).toHaveBeenCalledWith('msg');
  });

  it('info: info がなければ log にフォールバック', () => {
    const log = vi.fn();
    const impl = { log };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.info('msg');
    expect(log).toHaveBeenCalledWith('msg');
  });

  it('warn: warn を最優先で解決する', () => {
    const warn = vi.fn();
    const impl = { warn, warning: vi.fn(), log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.warn('msg');
    expect(warn).toHaveBeenCalledWith('msg');
  });

  it('warn: warn がなければ warning にフォールバック', () => {
    const warning = vi.fn();
    const impl = { warning, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.warn('msg');
    expect(warning).toHaveBeenCalledWith('msg');
  });

  it('error: error を最優先で解決する', () => {
    const error = vi.fn();
    const impl = { error, severe: vi.fn(), log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
    logger.error('msg');
    expect(error).toHaveBeenCalledWith('msg');
  });

  it('error: error がなければ severe にフォールバック', () => {
    const severe = vi.fn();
    const impl = { severe, log: vi.fn() };
    const logger = LoggerFacade.createLogger(impl)!;
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
    const impl = { info };
    const logger = LoggerFacade.createLogger(impl)!;
    const err = new Error('test');
    logger.info('message', err, { extra: 1 });
    expect(info).toHaveBeenCalledWith('message', err, { extra: 1 });
  });

  it('引数なしでも呼べる', () => {
    const info = vi.fn();
    const logger = LoggerFacade.createLogger({ info })!;
    expect(() => logger.info()).not.toThrow();
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
    logger!.error('test error');
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
    const logger = LoggerFacade.createLogger(winstonLike)!;
    logger.info('hello');
    logger.warn('world');
    expect(winstonLike.info).toHaveBeenCalledWith('hello');
    expect(winstonLike.warn).toHaveBeenCalledWith('world');
  });
});
