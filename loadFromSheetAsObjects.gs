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
 *   URL:   https://docs.google.com/spreadsheets/d/{id}/...?gid={gid}
 *   ID:    {id}
 *   配列:  [{id}, {index}]
 *   配列:  [{id}, {name}]
 *   オブジェクト: { id: {id}, index: {index} }
 *   オブジェクト: { id: {id}, name: {name} }
 *   Obj:   Sheet オブジェクト
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
  /**
   * [内部] URL が Google Spreadsheet URL かどうかを判定
   * 
   * @param {string} url URL文字列
   * @returns {boolean} Spreadsheet URLの場合true
   */
  const isUrl = url => /^https?:\/\/.+\/spreadsheets\/d\//.test(url);

  /**
   * [内部] URL から gid（sheet ID）を抽出
   * 
   * @param {string} url SpreadsheetのURL
   * @returns {number|null} gid（見つからない場合null）
   */
  const getGid = url => {
    const match = url.match(/[?&#]gid=(\d+)/);
    return match ? Number(match[1]) : null;
  };

  /**
   * [内部] source を Sheet オブジェクトに解決
   * 
   * @param {string|Array|Object} source ソース指定
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheetオブジェクト
   * @throws {Error} 指定した識別子（gid・インデックス・シート名）に該当するシートが見つからない場合
   * 
   * @example
   *   resolve('abc123')                          // => 先頭シート
   *   resolve({ id: 'abc123', index: 1 })        // => インデックス1のシート
   *   resolve({ id: 'abc123', name: 'Sheet1' })  // => シート名で検索
   *   resolve(['abc123', 1])                     // => インデックス1のシート
   *   resolve(['abc123', 'Sheet1'])              // => シート名で検索
   */
  const resolve = source => {
    // URL
    if (typeof source === 'string' && isUrl(source)) {
      const spreadsheet = SpreadsheetApp.openByUrl(source);
      const gid = getGid(source);
      const sheets = spreadsheet.getSheets();

      if (gid != null) {
        for (const sheet of sheets) {
          if (sheet.getSheetId && sheet.getSheetId() === gid) {
            return sheet;
          }
        }
        throw new Error(`シートが見つかりません: gid=${gid}`);
      }

      return sheets[0];
    }

    // 配列: [id, index] または [id, name]
    if (Array.isArray(source)) {
      const [id, selector] = source;
      const spreadsheet = SpreadsheetApp.openById(id);

      if (typeof selector === 'number') {
        const sheet = spreadsheet.getSheets()[selector];
        if (!sheet) {
          throw new Error(`シートが見つかりません: index=${selector}`);
        }
        return sheet;
      }

      if (typeof selector === 'string') {
        const sheet = spreadsheet.getSheetByName(selector);
        if (!sheet) {
          throw new Error(`シートが見つかりません: name=${selector}`);
        }
        return sheet;
      }

      return spreadsheet.getSheets()[0];
    }

    // オブジェクト: { id, index } または { id, name }
    if (typeof source === 'object' && source !== null && source.id) {
      const { id, index, name } = source;
      const spreadsheet = SpreadsheetApp.openById(id);

      if (typeof index === 'number') {
        const sheet = spreadsheet.getSheets()[index];
        if (!sheet) {
          throw new Error(`シートが見つかりません: index=${index}`);
        }
        return sheet;
      }

      if (typeof name === 'string') {
        const sheet = spreadsheet.getSheetByName(name);
        if (!sheet) {
          throw new Error(`シートが見つかりません: name=${name}`);
        }
        return sheet;
      }

      return spreadsheet.getSheets()[0];
    }

    // 文字列（IDのみ）
    if (typeof source === 'string') {
      return SpreadsheetApp.openById(source).getSheets()[0];
    }

    // それ以外は Sheet オブジェクトとして直達
    return source;
  };

  /**
   * [内部] キー末尾の [] 指定を解析（\[] はエスケープ）
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
   * [内部] フラットキーをオブジェクトに設定（末尾 [] のみ配列化）
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
   * [内部] ネストパスをオブジェクトに設定（途中は上書き）
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

  // ========================================
  // メイン処理
  // ========================================

  const fn = args.find(a => typeof a === 'function') || null;
  const [limit = Infinity, offset = 0] = args.filter(a => typeof a === 'number');

  const sheet = resolve(source);

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
