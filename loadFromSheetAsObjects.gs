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
const loadFromSheetAsObjects = (function () {
  /**
   * キー末尾の [] 指定を解析（\[] はエスケープ）
   *
   * @param {string} keyRaw 生のキー文字列
   * @returns {{key:string, isArray:boolean}} 解析結果
   * @throws {TypeError} keyRaw が文字列でない場合
   *
   * @example
   *   parseSuffix('name')      // => { key: 'name', isArray: false }
   *   parseSuffix('items[]')   // => { key: 'items', isArray: true }
   *   parseSuffix('tags\\[]')  // => { key: 'tags[]', isArray: false }
   */
  const parseSuffix = keyRaw => {
    if (typeof keyRaw !== 'string') {
      throw new TypeError('keyRaw には文字列を指定してください');
    }

    const match = String(keyRaw).match(/^(.*?)(?:\\(\[\])|(?<!\\)(\[\]))\s*$/);

    if (!match) {
      return { key: String(keyRaw), isArray: false };
    }

    return { key: match[1] + (match[2] || ''), isArray: !!match[3] };
  };

  /**
   * フラットキーをオブジェクトに設定（末尾 [] のみ配列化）
   *
   * @param {Record<string, any>} object 設定先オブジェクト
   * @param {string} keyRaw 生のキー文字列
   * @param {any} value 設定する値
   * @throws {TypeError} object がオブジェクトでない、または keyRaw が文字列でない場合
   */
  const setFlat = (object, keyRaw, value) => {
    if (typeof object !== 'object' || object === null) {
      throw new TypeError('object にはオブジェクトを指定してください');
    }

    if (typeof keyRaw !== 'string') {
      throw new TypeError('keyRaw には文字列を指定してください');
    }

    const parsed = parseSuffix(keyRaw);

    if (parsed.isArray) {
      if (!Array.isArray(object[parsed.key])) {
        object[parsed.key] = [];
      }
      object[parsed.key].push(value);
    } else {
      object[parsed.key] = value;
    }
  };

  /**
   * ネストパスをオブジェクトに設定（途中は上書き）
   *
   * @param {Record<string, any>} object 設定先オブジェクト
   * @param {string[]} path パス配列
   * @param {any} value 設定する値
   * @throws {TypeError} object がオブジェクトでない、または path が配列でない場合
   */
  const setNested = (object, path, value) => {
    if (typeof object !== 'object' || object === null) {
      throw new TypeError('object にはオブジェクトを指定してください');
    }

    if (!Array.isArray(path)) {
      throw new TypeError('path には配列を指定してください');
    }

    if (path.length === 0) {
      return;
    }

    let current = object;

    for (let i = 0; i < path.length - 1; i++) {
      const key = String(path[i]);
      const existing = current[key];

      if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = String(path[path.length - 1]);
    const parsed = parseSuffix(lastKey);

    if (parsed.isArray) {
      if (!Array.isArray(current[parsed.key])) {
        current[parsed.key] = [];
      }
      current[parsed.key].push(value);
    } else {
      current[parsed.key] = value;
    }
  };

  return (source, ...args) => {
    // ========================================
    // メイン処理
    // ========================================

    const fn = args.find(a => typeof a === 'function') ?? null;
    const [limit = Infinity, offset = 0] = args.filter(a => typeof a === 'number');

    const sheet = resolveSheet(source);

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow < 1 || lastColumn < 1) {
      return [];
    }

    const rowCount =
      limit === Infinity
        ? Math.max(0, lastRow - 1 - offset)
        : Math.max(0, Math.min(limit, lastRow - 1 - offset));

    if (rowCount === 0) {
      return [];
    }

    const header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const values = sheet.getRange(2 + offset, 1, rowCount, lastColumn).getValues();

    if (!values || values.length === 0) {
      return [];
    }

    return values.map(row => {
      const object = {};

      for (let i = 0; i < header.length; i++) {
        const rawKey = String(header[i]);
        const mapped = fn ? fn(rawKey, i) : rawKey;

        if (mapped == null) {
          continue;
        }

        const value = row[i];

        if (Array.isArray(mapped)) {
          setNested(object, mapped, value);
        } else {
          setFlat(object, String(mapped), value);
        }
      }

      return object;
    });
  };
})();
