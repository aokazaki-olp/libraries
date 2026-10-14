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
 * @param logger - ロガー実装。偽値（undefined・null・false・'' 等）なら「ロガー無し」として null を返す
 * @returns 統一されたLoggerインターフェース、logger が偽値の場合は null
 * @throws {TypeError} logger がオブジェクトでない場合、またはどのレベルかに対応するメソッドが無い場合
 *   （黙って noop にすると、警告やエラーが記録されていないことに気づけない）
 */
const createLogger = (logger: unknown): Logger | null => {
  // `logger: debug && console` のような書き方を許すため、偽値はロガー無しとして扱う
  if (!logger) {
    return null;
  }
  if (typeof logger !== 'object' && typeof logger !== 'function') {
    throw new TypeError(`logger にはオブジェクトを指定してください (received: ${typeof logger})`);
  }
  const impl = logger;
  const missing: string[] = [];

  const resolve = (level: keyof Logger, ...candidates: string[]): LogMethod => {
    const name = candidates.find((candidate) => typeof Reflect.get(impl, candidate) === 'function');
    if (name === undefined) {
      missing.push(level);
      return () => {};
    }
    // メソッドは呼び出し時に引く（作成後に差し替えられた実装・spy にも追従する）
    return (...args: unknown[]) => {
      const method: unknown = Reflect.get(impl, name);
      if (typeof method !== 'function') {
        throw new TypeError(`logger.${name} が関数ではなくなりました`);
      }
      method.call(impl, ...args);
    };
  };

  const facade: Logger = {
    trace: resolve('trace', 'trace', 'finest', 'finer', 'debug', 'log'),
    debug: resolve('debug', 'debug', 'fine', 'log'),
    info: resolve('info', 'info', 'log'),
    warn: resolve('warn', 'warn', 'warning', 'log'),
    error: resolve('error', 'error', 'severe', 'log'),
  };
  if (missing.length > 0) {
    throw new TypeError(
      `logger に ${missing.join(' / ')} に対応するメソッドがありません（log メソッドがあれば全レベルを賄えます）`,
    );
  }
  return facade;
};

export const LoggerFacade = { createLogger };
