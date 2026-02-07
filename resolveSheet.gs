'use strict';

/**
 * resolveSheet
 *
 * @description 柔軟なソース指定からシートを解決する
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-02
 *
 * サポートする source 形式:
 *   URL:   https://docs.google.com/spreadsheets/d/{id}/...?gid={gid}
 *   シート名: {name}（アクティブスプレッドシート対象）
 *   配列:  [{urlOrId}, {index}]  ※ urlOrId は URL または ID（自動判定）
 *   配列:  [{urlOrId}, {name}]
 *   オブジェクト: { urlOrId: {urlOrId}, index: {index} }  ※ 自動判定
 *   オブジェクト: { urlOrId: {urlOrId}, name: {name} }
 *   オブジェクト: { url: {url}, index: {index} }  ※ 厳密に URL として扱う
 *   オブジェクト: { url: {url}, name: {name} }
 *   オブジェクト: { id: {id}, index: {index} }   ※ 厳密に ID として扱う
 *   オブジェクト: { id: {id}, name: {name} }
 *   Obj:   Sheet オブジェクト
 *
 * シート選択の優先順位:
 *   1. index または name が指定されていればそれで選択
 *   2. URL の場合、gid パラメータがあればそれで選択
 *   3. 上記がなければ最初のシート
 *
 * オプション:
 *   create: true  シートが見つからない場合に作成する（name 指定必須）
 *
 * 使用例:
 *   const sheet = resolveSheet('Sheet1');
 *   const sheet = resolveSheet({ urlOrId: '...', name: 'Data' });
 *   const sheet = resolveSheet({ urlOrId: '...', name: 'Data' }, { create: true });
 */

/**
 * 柔軟なソース指定からシートを解決する
 *
 * @param {string|Array|Object} source データソース
 * @param {Object} [options] オプション
 * @param {boolean} [options.create=false] シートが見つからない場合に作成する（name 指定必須）
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheetオブジェクト
 * @throws {Error} シートが見つからない、または作成できない場合
 *
 * @example
 *   // 基本的な使い方
 *   const sheet = resolveSheet('Sheet1');
 *   const sheet = resolveSheet({ urlOrId: '...', name: 'Data' });
 *
 * @example
 *   // なければ作成
 *   const sheet = resolveSheet({ urlOrId: '...', name: 'Data' }, { create: true });
 *   const sheet = resolveSheet('NewSheet', { create: true });
 */
const resolveSheet = (function () {
  /**
   * URL が Google Spreadsheet URL かどうかを判定
   *
   * @param {string} url URL文字列
   * @returns {boolean} Spreadsheet URLの場合true
   */
  const isUrl = url => /^https?:\/\/.+\/spreadsheets\/d\//.test(url);

  /**
   * URL から gid（sheet ID）を抽出
   *
   * @param {string} url SpreadsheetのURL
   * @returns {number|null} gid（見つからない場合null）
   */
  const getGid = url => {
    const match = url.match(/[?&#]gid=(\d+)/);
    return match ? Number(match[1]) : null;
  };

  /**
   * シートを取得、なければ作成（create フラグ時）
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet Spreadsheetオブジェクト
   * @param {string} name シート名
   * @param {boolean} create シートが見つからない場合に作成するか
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheetオブジェクト
   * @throws {Error} シートが見つからず、作成もできない場合
   */
  const getOrCreateSheet = (spreadsheet, name, create) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) {
      return sheet;
    }

    if (create) {
      return spreadsheet.insertSheet(name);
    }

    throw new Error(`シートが見つかりません: name=${name}`);
  };

  /**
   * create オプションが無効な場合にエラーをスロー
   *
   * @param {string} reason 理由
   * @throws {Error} 常にエラーをスロー
   */
  const throwCreateNotSupported = reason => {
    throw new Error(`create オプションは ${reason} では使用できません`);
  };

  return (source, options = {}) => {
    const { create = false } = options;

    // Sheet オブジェクトが直接渡された場合はそのまま返す
    if (typeof source?.getSheetId === 'function') {
      return source;
    }

    // URL文字列 → オブジェクト形式に変換して再帰処理
    if (typeof source === 'string' && isUrl(source)) {
      return resolveSheet({ urlOrId: source }, options);
    }

    // 配列: [urlOrId, index] または [urlOrId, name]
    if (Array.isArray(source)) {
      const [urlOrId, selector] = source;
      const useUrl = isUrl(urlOrId);
      const spreadsheet = useUrl
        ? SpreadsheetApp.openByUrl(urlOrId)
        : SpreadsheetApp.openById(urlOrId);

      if (typeof selector === 'number') {
        const sheet = spreadsheet.getSheets()[selector];
        if (sheet) {
          return sheet;
        }
        if (create) {
          throwCreateNotSupported('index 指定');
        }
        throw new Error(`シートが見つかりません: index=${selector}`);
      }

      if (typeof selector === 'string') {
        return getOrCreateSheet(spreadsheet, selector, create);
      }

      // selector 指定なし、かつ URL の場合は gid で選択
      if (useUrl) {
        const gid = getGid(urlOrId);
        if (gid != null) {
          const sheets = spreadsheet.getSheets();
          for (const sheet of sheets) {
            if (sheet.getSheetId && sheet.getSheetId() === gid) {
              return sheet;
            }
          }
          if (create) {
            throwCreateNotSupported('gid 指定');
          }
          throw new Error(`シートが見つかりません: gid=${gid}`);
        }
      }

      return spreadsheet.getSheets()[0];
    }

    // オブジェクト: { url, index/name } または { id, index/name } または { urlOrId, index/name }
    if (typeof source === 'object' && source !== null && (source.url || source.id || source.urlOrId)) {
      const { url, id, urlOrId, index, name } = source;

      // 優先順位: url > id > urlOrId
      const useUrl = url != null || (urlOrId != null && id == null && isUrl(urlOrId));

      const spreadsheet = useUrl
        ? SpreadsheetApp.openByUrl(url ?? urlOrId)
        : SpreadsheetApp.openById(id ?? urlOrId);

      if (typeof index === 'number') {
        const sheet = spreadsheet.getSheets()[index];
        if (sheet) {
          return sheet;
        }
        if (create) {
          throwCreateNotSupported('index 指定');
        }
        throw new Error(`シートが見つかりません: index=${index}`);
      }

      if (typeof name === 'string') {
        return getOrCreateSheet(spreadsheet, name, create);
      }

      // index/name 指定なし、かつ URL の場合は gid で選択
      if (useUrl) {
        const gid = getGid(url ?? urlOrId);
        if (gid != null) {
          const sheets = spreadsheet.getSheets();
          for (const sheet of sheets) {
            if (sheet.getSheetId && sheet.getSheetId() === gid) {
              return sheet;
            }
          }
          if (create) {
            throwCreateNotSupported('gid 指定');
          }
          throw new Error(`シートが見つかりません: gid=${gid}`);
        }
      }

      return spreadsheet.getSheets()[0];
    }

    // 文字列（アクティブスプレッドシートのシート名）
    if (typeof source === 'string') {
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      return getOrCreateSheet(spreadsheet, source, create);
    }

    // それ以外はサポート外の型
    throw new TypeError(`source には string, Array, Object, または Sheet を指定してください (typeof: ${typeof source})`);
  };
})();
