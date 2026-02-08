'use strict';

// ============================================================================
// モック Range
// ============================================================================

const MockRange = (function () {
  const create = (header, rows = [], { startRow = 1, startColumn = 1 } = {}) => {
    const allRows = [header, ...rows];
    const numRows = allRows.length;
    const numColumns = header.length;

    const parentSheet = {
      getRange: (row, column, nRows, nColumns) => ({
        getValues: () => {
          const results = [];
          for (let r = 0; r < nRows; r++) {
            const dataRowIndex = (row - startRow) + r;
            if (dataRowIndex >= 0 && dataRowIndex < allRows.length) {
              results.push(
                allRows[dataRowIndex].slice(column - startColumn, column - startColumn + nColumns)
              );
            }
          }
          return results;
        }
      }),
      getSheetId: () => 0,
      getName: () => 'MockSheet'
    };

    return {
      getA1Notation: () => `R${startRow}C${startColumn}:R${startRow + numRows - 1}C${startColumn + numColumns - 1}`,
      getSheet: () => parentSheet,
      getRow: () => startRow,
      getColumn: () => startColumn,
      getNumRows: () => numRows,
      getNumColumns: () => numColumns
    };
  };

  return { create };
})();

// ============================================================================
// loadFromRangeAsObjects Range オブジェクト テスト
// ============================================================================

const runRangeObjectTests = () => {
  const { suite, test, assertEqual, assertDeepEqual } = TestRunner;

  suite('loadFromRangeAsObjects Range オブジェクト');

  test('Range からオブジェクト配列を作成する', () => {
    const range = MockRange.create(
      ['name', 'age'],
      [['Alice', 30], ['Bob', 25]]
    );
    const result = loadFromRangeAsObjects(range);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].age, 30);
    assertEqual(result[1].name, 'Bob');
  });

  test('Range + キーマッパー', () => {
    const range = MockRange.create(
      ['Name', 'AGE'],
      [['Alice', 30]]
    );
    const result = loadFromRangeAsObjects(range, key => key.toLowerCase());
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].age, 30);
  });

  test('Range + limit', () => {
    const range = MockRange.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
    );
    const result = loadFromRangeAsObjects(range, 2);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[1].name, 'Bob');
  });

  test('Range + offset', () => {
    const range = MockRange.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
    );
    const result = loadFromRangeAsObjects(range, Infinity, 1);
    assertEqual(result.length, 3);
    assertEqual(result[0].name, 'Bob');
  });

  test('Range + limit + offset', () => {
    const range = MockRange.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
    );
    const result = loadFromRangeAsObjects(range, 2, 1);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Bob');
    assertEqual(result[1].name, 'Charlie');
  });

  test('Range + fn + limit + offset', () => {
    const range = MockRange.create(
      ['Name'],
      [['Alice'], ['Bob'], ['Charlie']]
    );
    const result = loadFromRangeAsObjects(range, key => key.toLowerCase(), 1, 1);
    assertEqual(result.length, 1);
    assertEqual(result[0].name, 'Bob');
  });

  test('ヘッダーのみの Range は空配列を返す', () => {
    const range = MockRange.create(['name', 'age'], []);
    const result = loadFromRangeAsObjects(range);
    assertDeepEqual(result, []);
  });

  test('開始位置がずれた Range（B3 起点）', () => {
    const range = MockRange.create(
      ['name', 'score'],
      [['Alice', 100], ['Bob', 90]],
      { startRow: 3, startColumn: 2 }
    );
    const result = loadFromRangeAsObjects(range);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].score, 100);
    assertEqual(result[1].name, 'Bob');
    assertEqual(result[1].score, 90);
  });

  test('Range + 配列サフィックス', () => {
    const range = MockRange.create(
      ['tags[]', 'tags[]', 'name'],
      [['a', 'b', 'Alice']]
    );
    const result = loadFromRangeAsObjects(range);
    assertDeepEqual(result[0].tags, ['a', 'b']);
    assertEqual(result[0].name, 'Alice');
  });

  test('マッパーが null を返すとスキップする', () => {
    const range = MockRange.create(
      ['name', 'internal_id', 'email'],
      [['Alice', 999, 'alice@example.com']]
    );
    const result = loadFromRangeAsObjects(range, key =>
      key === 'internal_id' ? null : key
    );
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].email, 'alice@example.com');
    assertEqual('internal_id' in result[0], false);
  });

  test('ネストパス + 配列サフィックス', () => {
    const range = MockRange.create(
      ['user.tags[]', 'user.tags[]'],
      [['a', 'b']]
    );
    const result = loadFromRangeAsObjects(range, key => key.split('.'));
    assertDeepEqual(result[0].user.tags, ['a', 'b']);
  });
};

// ============================================================================
// loadFromRangeAsObjects Range 文字列 テスト
// ============================================================================

const runRangeStringTests = () => {
  const { suite, test, assertEqual, assertThrows } = TestRunner;

  suite('loadFromRangeAsObjects Range 文字列');

  test('Range 文字列からオブジェクト配列を作成する', () => {
    const original = typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : undefined;

    try {
      const rangeData = MockRange.create(
        ['name', 'age'],
        [['Alice', 30]]
      );

      globalThis.SpreadsheetApp = {
        getActiveSpreadsheet: () => ({
          getRange: notation => {
            if (notation === 'A1:B3') return rangeData;
            throw new Error('Invalid range: ' + notation);
          }
        })
      };

      const result = loadFromRangeAsObjects('A1:B3');
      assertEqual(result.length, 1);
      assertEqual(result[0].name, 'Alice');
      assertEqual(result[0].age, 30);
    } finally {
      if (original === undefined) {
        delete globalThis.SpreadsheetApp;
      } else {
        globalThis.SpreadsheetApp = original;
      }
    }
  });

  test('Range 文字列 + limit + offset', () => {
    const original = typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : undefined;

    try {
      const rangeData = MockRange.create(
        ['name'],
        [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
      );

      globalThis.SpreadsheetApp = {
        getActiveSpreadsheet: () => ({
          getRange: () => rangeData
        })
      };

      const result = loadFromRangeAsObjects('A1:A5', 2, 1);
      assertEqual(result.length, 2);
      assertEqual(result[0].name, 'Bob');
      assertEqual(result[1].name, 'Charlie');
    } finally {
      if (original === undefined) {
        delete globalThis.SpreadsheetApp;
      } else {
        globalThis.SpreadsheetApp = original;
      }
    }
  });

  test('無効な Range 文字列はエラーをスローする', () => {
    const original = typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : undefined;

    try {
      globalThis.SpreadsheetApp = {
        getActiveSpreadsheet: () => ({
          getRange: () => { throw new Error('Invalid range notation'); }
        })
      };

      assertThrows(
        () => loadFromRangeAsObjects('NotARange!!!'),
        'Invalid range notation'
      );
    } finally {
      if (original === undefined) {
        delete globalThis.SpreadsheetApp;
      } else {
        globalThis.SpreadsheetApp = original;
      }
    }
  });

  test('Range でも文字列でもない source はエラーをスローする', () => {
    assertThrows(
      () => loadFromRangeAsObjects(12345),
      'Range オブジェクトまたは Range 文字列を指定してください'
    );
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllLoadFromRangeAsObjectsTests() {
  TestRunner.reset();

  runRangeObjectTests();
  runRangeStringTests();

  return TestRunner.run();
}
