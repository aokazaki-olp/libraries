/**
 * LoggerFacade.ts
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
 * @returns 統一されたLoggerインターフェース、loggerがnullish の場合はnull
 */
const createLogger = (logger: unknown): Logger | null => {
  if (!logger) {
    return null;
  }

  // unknown の logger からメソッドを検査するため Record 型にキャスト
  const impl = logger as Record<string, unknown>;

  const noop: LogMethod = () => {};

  const resolve = (...candidates: string[]): LogMethod => {
    for (const name of candidates) {
      if (typeof impl[name] === 'function') {
        return (...args: unknown[]) => (impl[name] as LogMethod).call(impl, ...args);
      }
    }
    return noop;
  };

  return {
    trace: resolve('trace', 'finest', 'finer', 'debug', 'log'),
    debug: resolve('debug', 'fine', 'log'),
    info:  resolve('info', 'log'),
    warn:  resolve('warn', 'warning', 'log'),
    error: resolve('error', 'severe', 'log'),
  };
};

export const LoggerFacade = { createLogger };
