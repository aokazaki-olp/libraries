'use strict';

const loadFromSheetAsObjects = (function () {
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

  const isRange = source =>
    typeof source?.getA1Notation === 'function'
    && typeof source?.getSheetId !== 'function';

  const getFromRange = (range, limit, offset) => {
    const sheet = range.getSheet();
    const startRow = range.getRow();
    const startColumn = range.getColumn();
    const numRows = range.getNumRows();
    const numColumns = range.getNumColumns();

    if (numRows < 1 || numColumns < 1) {
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

    const header = sheet.getRange(startRow, startColumn, 1, numColumns).getValues()[0];
    const values = sheet.getRange(startRow + 1 + offset, startColumn, rowCount, numColumns).getValues();

    return { header, values };
  };

  const getFromSheet = (sheet, limit, offset) => {
    const lastRow = sheet.getLastRow();
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
          throw resolveError;
        }
      }
      throw resolveError;
    }
  };
})();
