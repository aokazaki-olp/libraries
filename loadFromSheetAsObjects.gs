'use strict';

/**
 * loadFromSheetAsObjects
 *
 * @description スプレッドシートからデータを読み込みオブジェクト配列に変換
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 *
 * 設計思想: "loader は切るだけ"
 * - 意味の推論、型変換、構造の自動補正は一切行わない
 * - 明示がすべて: fn の戻り値とキー末尾の [] のみを構造化の根拠とする
 * - 内部で loadFromRangeAsObjects に委譲する
 *
 * サポートする source 形式:
 *   resolveSheet と同じ形式をサポート（resolveSheet.gs を参照）
 *
 * 使用例:
 *   const data = loadFromSheetAsObjects(sheet);
 *   const mapped = loadFromSheetAsObjects(sheet, k => k.toLowerCase());
 *   const limited = loadFromSheetAsObjects(sheet, 100, 10);
 */

/**
 * メイン関数: スプレッドシートからオブジェクト配列を読み込む
 *
 * @param {string|Array|Object} source データソース
 * @param {Function} [fn] キーマッパー: fn(rawKey, columnIndex) → string|string[]|null|undefined
 * @param {number} [limit=Infinity] 読み込む行数の上限
 * @param {number} [offset=0] ヘッダー行の直後からスキップする行数
 * @returns {Array<Record<string, any>>} オブジェクト配列
 *
 * 引数は順序に関わらず型で自動判定される。
 * fn は 1つ目の Function 型引数、limit は 1つ目の number 型引数、offset は 2つ目の number 型引数として扱われる。
 *
 * @example
 *   // 基本的な使い方
 *   const data = loadFromSheetAsObjects(sheet);
 *
 * @example
 *   // キーをマッピング
 *   const data = loadFromSheetAsObjects(sheet, key => key.toLowerCase());
 *
 * @example
 *   // ネストした構造を作成
 *   const data = loadFromSheetAsObjects(sheet, key => {
 *     if (key === 'user.name') return ['user', 'name'];
 *     return key;
 *   });
 *
 * @example
 *   // 件数制限とオフセット
 *   const data = loadFromSheetAsObjects(sheet, 100, 10);
 *
 * @example
 *   // すべての組み合わせ
 *   const data = loadFromSheetAsObjects(sheet, k => k.toLowerCase(), 100, 10);
 */
const loadFromSheetAsObjects = (source, ...args) => {
  const sheet = resolveSheet(source);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 1 || lastColumn < 1) {
    return [];
  }

  return loadFromRangeAsObjects(sheet.getRange(1, 1, lastRow, lastColumn), ...args);
};
