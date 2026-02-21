'use strict';

/**
 * loadFromRangeAsObjects / loadFromSheetAsObjects
 *
 * @description Range またはシートからデータを読み込みオブジェクト配列に変換
 *
 * 設計思想: "loader は切るだけ"
 * - 意味の推論、型変換、構造の自動補正は一切行わない
 * - 明示がすべて: fn の戻り値とキー末尾の [] のみを構造化の根拠とする
 *
 * 公開関数:
 *   loadFromRangeAsObjects(source, fn?, limit?, offset?)
 *     - source: Range オブジェクト / Range 文字列（A1表記、名前付き範囲）
 *
 *   loadFromSheetAsObjects(source, fn?, limit?, offset?)
 *     - source: resolveSheet 互換（シート名、URL、配列、オブジェクト、Sheet）
 *     - 内部で Sheet 全体の Range を取得し loadFromRangeAsObjects に委譲
 *
 * 使用例:
 *   const data = loadFromRangeAsObjects(sheet.getRange('B2:E20'));
 *   const data = loadFromRangeAsObjects('A1:D10');
 *   const data = loadFromSheetAsObjects(sheet);
 *   const data = loadFromSheetAsObjects(sheet, k => k.toLowerCase(), 100, 10);
 */

/**
 * Range からオブジェクト配列を読み込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Range|string} source Range オブジェクトまたは Range 文字列
 * @param {Function} [fn] キーマッパー: fn(rawKey, columnIndex) → string|string[]|null|undefined
 * @param {number} [limit=Infinity] 読み込む行数の上限
 * @param {number} [offset=0] ヘッダー行の直後からスキップする行数
 * @returns {Array<Record<string, any>>} オブジェクト配列
 *
 * 引数は順序に関わらず型で自動判定される。
 * fn は 1つ目の Function 型引数、limit は 1つ目の number 型引数、offset は 2つ目の number 型引数として扱われる。
 *
 * Range の先頭行をヘッダー、以降をデータ行として扱う。
 * limit/offset は Range 内のデータ行に対して適用される。
 *
 * @example
 *   // Range オブジェクト
 *   const data = loadFromRangeAsObjects(sheet.getRange('B2:E20'));
 *
 * @example
 *   // Range 文字列
 *   const data = loadFromRangeAsObjects('A1:D10');
 *   const data = loadFromRangeAsObjects('Sheet2!A1:D10');
 *
 * @example
 *   // キーをマッピング
 *   const data = loadFromRangeAsObjects(range, key => key.toLowerCase());
 *
 * @example
 *   // ネストした構造を作成
 *   const data = loadFromRangeAsObjects(range, key => {
 *     if (key === 'user.name') return ['user', 'name'];
 *     return key;
 *   });
 *
 * @example
 *   // 件数制限とオフセット
 *   const data = loadFromRangeAsObjects(range, 100, 10);
 */
const loadFromRangeAsObjects = (function () {
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
   * source を Range オブジェクトに解決
   *
   * @param {GoogleAppsScript.Spreadsheet.Range|string} source Range または Range 文字列
   * @returns {GoogleAppsScript.Spreadsheet.Range} Range オブジェクト
   * @throws {TypeError} source が Range でも文字列でもない場合
   */
  const resolveRange = source => {
    if (isRange(source)) {
      return source;
    }
    if (typeof source === 'string') {
      return SpreadsheetApp.getActiveSpreadsheet().getRange(source);
    }
    throw new TypeError('source には Range オブジェクトまたは Range 文字列を指定してください');
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
      const o = {};

      for (let i = 0; i < header.length; i++) {
        const rawKey = String(header[i]);
        const m = fn ? fn(rawKey, i) : rawKey;

        if (m == null) {
          continue;
        }

        const v = row[i];

        if (Array.isArray(m)) {
          setNested(o, m, v);
        } else {
          setFlat(o, String(m), v);
        }
      }

      return o;
    });
  };

  return (source, ...args) => {
    const fn = args.find(a => typeof a === 'function') ?? null;
    const [limit = Infinity, offset = 0] = args.filter(a => typeof a === 'number');

    const range = resolveRange(source);
    const sheet = range.getSheet();
    const startRow = range.getRow();
    const startColumn = range.getColumn();
    const numRows = range.getNumRows();
    const numColumns = range.getNumColumns();

    if (numRows < 1 || numColumns < 1) {
      return [];
    }

    const totalDataRows = numRows - 1;
    const rowCount =
      limit === Infinity
        ? Math.max(0, totalDataRows - offset)
        : Math.max(0, Math.min(limit, totalDataRows - offset));

    if (rowCount === 0) {
      return [];
    }

    const header = sheet.getRange(startRow, startColumn, 1, numColumns).getValues()[0];
    const values = sheet.getRange(startRow + 1 + offset, startColumn, rowCount, numColumns).getValues();

    return toObjects({ header, values }, fn);
  };
})();

/**
 * スプレッドシートからオブジェクト配列を読み込む
 *
 * resolveSheet で Sheet を解決し、Sheet 全体の Range を取得して
 * loadFromRangeAsObjects に委譲する。
 *
 * @param {string|Array|Object} source データソース（resolveSheet 互換）
 * @param {Function} [fn] キーマッパー: fn(rawKey, columnIndex) → string|string[]|null|undefined
 * @param {number} [limit=Infinity] 読み込む行数の上限
 * @param {number} [offset=0] ヘッダー行の直後からスキップする行数
 * @returns {Array<Record<string, any>>} オブジェクト配列
 *
 * @example
 *   const data = loadFromSheetAsObjects(sheet);
 *
 * @example
 *   const data = loadFromSheetAsObjects(sheet, key => key.toLowerCase());
 *
 * @example
 *   const data = loadFromSheetAsObjects(sheet, key => {
 *     if (key === 'user.name') return ['user', 'name'];
 *     return key;
 *   });
 *
 * @example
 *   const data = loadFromSheetAsObjects(sheet, 100, 10);
 *
 * @example
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
