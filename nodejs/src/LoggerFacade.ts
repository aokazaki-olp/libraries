/**
 * LoggerFacade.ts
 *
 * @description 各種ロガー実装を統一インターフェースに変換するファサード（SLF4J互換）
 *
 * 対応する実装:
 *   - console (JavaScript標準)
 *   - winston / pino / bunyan (Node.js)
 *   - GAS Logger / BBLog (GAS)
 *   - java.util.logging互換
 */

type LogMethod = (...args: unknown[]) => void;

export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * 実装オブジェクトをLogger形式に変換するファサード
 *
 * メソッド解決の優先順位:
 *   - trace: trace → finest → finer → debug → log
 *   - debug: debug → fine → log
 *   - info:  info → log
 *   - warn:  warn → warning → log
 *   - error: error → severe → log
 *
 * @param logger - ロガー実装（null の場合は null を返す）
 * @returns 統一されたLoggerインターフェース、loggerがnullish・プリミティブの場合はnull
 */
const createLogger = (logger: unknown): Logger | null => {
  if (!logger) {
    return null;
  }

  // プリミティブはメソッドを持てない（Reflect.get も TypeError になる）
  if (typeof logger !== 'object' && typeof logger !== 'function') {
    return null;
  }
  const impl = logger;

  const noop: LogMethod = () => {};

  const resolve = (...candidates: string[]): LogMethod => {
    for (const name of candidates) {
      if (typeof Reflect.get(impl, name) === 'function') {
        // メソッドは呼び出し時に引く（作成後に差し替えられた実装・spy にも追従する）
        return (...args: unknown[]) => {
          const method: unknown = Reflect.get(impl, name);
          if (typeof method === 'function') {
            method.call(impl, ...args);
          }
        };
      }
    }
    return noop;
  };

  return {
    trace: resolve('trace', 'finest', 'finer', 'debug', 'log'),
    debug: resolve('debug', 'fine', 'log'),
    info: resolve('info', 'log'),
    warn: resolve('warn', 'warning', 'log'),
    error: resolve('error', 'severe', 'log'),
  };
};

export const LoggerFacade = { createLogger };
