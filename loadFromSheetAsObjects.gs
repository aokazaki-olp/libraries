'use strict';

/**
 * loadFromSheetAsObjects
 *
 * @description スプレッドシートからデータを読み込みオブジェクト配列に変換
 * @version 1.1.0
 * @author Arihiro OKAZAKI
 * @created 2026-01-28
 *
 * 設計思想: "loader は切るだけ"
 * - 意味の推論、型変換、構造の自動補正は一切行わない
 * - 明示がすべて: fn の戻り値とキー末尾の [] のみを構造化の根拠とする
 *
 * サポートする source 形式:
 *   resolveSheet と同じ形式をサポート（resolveSheet.gs を参照）
 *   Range オブジェクト: sheet.getRange('A1:D10') 等
 *   Range 文字列: 'A1:D10', 'Sheet2!A1:D10', 名前付き範囲名
 *     ※ 文字列はシート名を優先し、resolveSheet 失敗時に Range として解決を試みる
 *
 * 使用例:
 *   const data = loadFromSheetAsObjects(sheet);
 *   const mapped = loadFromSheetAsObjects(sheet, k => k.toLowerCase());
 *   const limited = loadFromSheetAsObjects(sheet, 100, 10);
 *   const ranged = loadFromSheetAsObjects(sheet.getRange('B2:E20'));
 *   const ranged = loadFromSheetAsObjects('A1:D10');
 */

/**
 * メイン関数: スプレッドシートからオブジェクト配列を読み込む
 *
 * @param {string|Array|Object|Range} source データソース
 * @param {Function} [fn] キーマッパー: fn(rawKey, columnIndex) → string|string[]|null|undefined
 * @param {number} [limit=Infinity] 読み込む行数の上限
 * @param {number} [offset=0] ヘッダー行の直後からスキップする行数
 * @returns {Array<Record<string, any>>} オブジェクト配列
 *
 * 引数は順序に関わらず型で自動判定される。
 * fn は 1つ目の Function 型引数、limit は 1つ目の number 型引数、offset は 2つ目の number 型引数として扱われる。
 *
 * source の解決順序:
 *   1. Range オブジェクト → Range の範囲からデータ取得
 *   2. resolveSheet で解決を試みる（シート名、URL、配列、オブジェクト）
 *   3. resolveSheet 失敗 かつ 文字列の場合 → Range として解決を試みる
 *      （A1 表記、名前付き範囲。シート名が常に優先）
 *
 * Range の場合、先頭行をヘッダー、以降をデータ行として扱う。
 * limit/offset は Range 内のデータ行に対して適用される。
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
 *   // Range オブジェクト
 *   const data = loadFromSheetAsObjects(sheet.getRange('B2:E20'));
 *
 * @example
 *   // Range 文字列（シート名が同名で存在すればシート優先）
 *   const data = loadFromSheetAsObjects('A1:D10');
 *   const data = loadFromSheetAsObjects('Sheet2!A1:D10');
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

  /**
   * Range オブジェクトかどうかを判定
   *
   * @param {any} source 判定対象
   * @returns {boolean} Range オブジェクトの場合 true
   */
  const isRange = source =>
    typeof source?.getA1Notation === 'function'
    && typeof source?.getSheetId !== 'function';

  /**
   * Range の境界情報からヘッダーとデータ行を取得
   * 一括 getValues() ではなく、必要分だけ getRange する
   *
   * @param {GoogleAppsScript.Spreadsheet.Range} range Range オブジェクト
   * @param {number} limit 読み込む行数の上限
   * @param {number} offset スキップする行数
   * @returns {{header:Array, values:Array<Array>}|null} ヘッダーとデータ行、データなしなら null
   */
  const getFromRange = (range, limit, offset) => {
    const sheet    = range.getSheet();
    const startRow = range.getRow();
    const startCol = range.getColumn();
    const numRows  = range.getNumRows();
    const numCols  = range.getNumColumns();

    if (numRows < 1 || numCols < 1) {
      return null;
    }

    const totalDataRows = numRows - 1;
    const rowCount =
      limit === Infinity
        ? Math.max(0, totalDataRows - offset)
        : Math.max(0, Math.min(limit, totalDataRows - offset));

    if (rowCount === 0) {
      return null;
    }

    const header = sheet.getRange(startRow, startCol, 1, numCols).getValues()[0];
    const values = sheet.getRange(startRow + 1 + offset, startCol, rowCount, numCols).getValues();

    return { header, values };
  };

  /**
   * Sheet からヘッダーとデータ行を取得
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet Sheet オブジェクト
   * @param {number} limit 読み込む行数の上限
   * @param {number} offset スキップする行数
   * @returns {{header:Array, values:Array<Array>}|null} ヘッダーとデータ行、データなしなら null
   */
  const getFromSheet = (sheet, limit, offset) => {
    const lastRow    = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow < 1 || lastColumn < 1) {
      return null;
    }

    const rowCount =
      limit === Infinity
        ? Math.max(0, lastRow - 1 - offset)
        : Math.max(0, Math.min(limit, lastRow - 1 - offset));

    if (rowCount === 0) {
      return null;
    }

    const header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    const values = sheet.getRange(2 + offset, 1, rowCount, lastColumn).getValues();

    return { header, values };
  };

  /**
   * オブジェクト配列への変換（共通処理）
   *
   * @param {{header:Array, values:Array<Array>}|null} data ヘッダーとデータ行
   * @param {Function|null} fn キーマッパー
   * @returns {Array<Record<string, any>>} オブジェクト配列
   */
  const toObjects = (data, fn) => {
    if (!data || !data.values || data.values.length === 0) {
      return [];
    }

    const { header, values } = data;

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

  return (source, ...args) => {
    // ========================================
    // メイン処理
    // ========================================

    const fn = args.find(a => typeof a === 'function') ?? null;
    const [limit = Infinity, offset = 0] = args.filter(a => typeof a === 'number');

    // (1) Range オブジェクト
    if (isRange(source)) {
      return toObjects(getFromRange(source, limit, offset), fn);
    }

    // (2) resolveSheet 優先
    try {
      const sheet = resolveSheet(source);
      return toObjects(getFromSheet(sheet, limit, offset), fn);
    } catch (resolveError) {
      // (3) 文字列の場合のみ Range フォールバック
      if (typeof source === 'string') {
        try {
          const range = SpreadsheetApp.getActiveSpreadsheet().getRange(source);
          return toObjects(getFromRange(range, limit, offset), fn);
        } catch (rangeError) {
          // Range としても解決できない → 元のエラーをスロー
          throw resolveError;
        }
      }
      throw resolveError;
    }
  };
})();
