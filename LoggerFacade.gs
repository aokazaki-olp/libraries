'use strict';

/**
 * LoggerFacade
 *
 * @description 各種ロガー実装を統一インターフェースに変換するファサード（SLF4J互換）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-02
 *
 * 設計思想:
 *   - SLF4J互換の5レベル（trace, debug, info, warn, error）を提供
 *   - インターフェースのみ提供、実装の責任は負わない
 *   - ログレベルの管理は利用者が実装ライブラリに対して責任を持つ
 *   - プレフィックス付与は行わない（実装に委ねる）
 *
 * 対応する実装:
 *   - console (JavaScript標準)
 *   - GAS Logger
 *   - Winston (Node.js)
 *   - BBLog (GAS)
 *   - Apache Commons Logging互換
 *   - java.util.logging互換
 *
 * 使用例:
 *   const logger = LoggerFacade.createLogger(BBLog);
 *   logger.info('message');
 */

/**
 * @typedef {Object} Logger
 * @property {function(string, ...any): void} trace - 最も詳細なデバッグ情報
 * @property {function(string, ...any): void} debug - デバッグ情報
 * @property {function(string, ...any): void} info  - 一般的な情報
 * @property {function(string, ...any): void} warn  - 警告
 * @property {function(string, ...any): void} error - エラー
 */

const LoggerFacade = (function () {
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
   * @param {Object} impl ロガー実装（console, Logger, winston, BBLog等）
   * @returns {Logger|null} 統一されたLoggerインターフェース、implがnullの場合はnull
   *
   * @example
   *   // console（ブラウザ/Node）
   *   const logger = LoggerFacade.createLogger(console);
   *
   * @example
   *   // GAS Logger
   *   const logger = LoggerFacade.createLogger(Logger);
   *
   * @example
   *   // BBLog
   *   const logger = LoggerFacade.createLogger(BBLog);
   *
   * @example
   *   // Winston
   *   const logger = LoggerFacade.createLogger(winston);
   *
   * @example
   *   // ログ無効化
   *   const logger = LoggerFacade.createLogger(null);
   */
  const createLogger = impl => {
    if (!impl) {
      return null;
    }

    /**
     * メソッド解決: 優先順位に従って利用可能なメソッドを返す
     *
     * @param {...string} candidates メソッド名候補（優先順）
     * @returns {function}
     */
    const resolve = (...candidates) => {
      for (const name of candidates) {
        if (typeof impl[name] === 'function') {
          return (...args) => impl[name](...args);
        }
      }
      return () => {};
    };

    return {
      trace: resolve('trace', 'finest', 'finer', 'debug', 'log'),
      debug: resolve('debug', 'fine', 'log'),
      info:  resolve('info', 'log'),
      warn:  resolve('warn', 'warning', 'log'),
      error: resolve('error', 'severe', 'log')
    };
  };

  return { createLogger };
})();
