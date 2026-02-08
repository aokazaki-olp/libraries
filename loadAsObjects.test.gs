'use strict';

// ============================================================================
// モック Sheet
// ============================================================================

const MockSheet = (function () {
  const create = (header, rows = []) => {
    const lastRow = rows.length > 0 ? 1 + rows.length : (header.length > 0 ? 1 : 0);
    const lastColumn = header.length;

    const sheet = {
      getLastRow: () => lastRow,
      getLastColumn: () => lastColumn,
      getRange: (row, column, numRows, numColumns) => ({
        getValues: () => {
          if (row === 1 && numRows === 1) {
            return [header.slice(column - 1, column - 1 + numColumns)];
          }
          const startIdx = row - 2;
          return rows.slice(startIdx, startIdx + numRows).map(r =>
            r.slice(column - 1, column - 1 + numColumns)
          );
        },
        // Range API（loadFromRangeAsObjects への委譲に必要）
        getA1Notation: () => `R${row}C${column}:R${row + numRows - 1}C${column + numColumns - 1}`,
        getSheet: () => sheet,
        getRow: () => row,
        getColumn: () => column,
        getNumRows: () => numRows,
        getNumColumns: () => numColumns
      }),
      getSheetId: () => 0,
      getName: () => 'MockSheet'
    };

    return sheet;
  };

  const empty = () => {
    const sheet = {
      getLastRow: () => 0,
      getLastColumn: () => 0,
      getRange: () => ({ getValues: () => [] }),
      getSheetId: () => 0,
      getName: () => 'EmptySheet'
    };
    return sheet;
  };

  const headerOnly = header => {
    const sheet = {
      getLastRow: () => 1,
      getLastColumn: () => header.length,
      getRange: (row, column, numRows, numColumns) => ({
        getValues: () => {
          if (row === 1 && numRows === 1) {
            return [header.slice(column - 1, column - 1 + numColumns)];
          }
          return [];
        },
        getA1Notation: () => `R${row}C${column}:R${row + numRows - 1}C${column + numColumns - 1}`,
        getSheet: () => sheet,
        getRow: () => row,
        getColumn: () => column,
        getNumRows: () => numRows,
        getNumColumns: () => numColumns
      }),
      getSheetId: () => 0,
      getName: () => 'HeaderOnlySheet'
    };
    return sheet;
  };

  return { create, empty, headerOnly };
})();

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
// loadFromSheetAsObjects テスト
// ============================================================================

const runSheetBasicTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue } = TestRunner;

  suite('loadFromSheetAsObjects 基本');

  test('ヘッダーとデータからオブジェクト配列を作成する', () => {
    const sheet = MockSheet.create(
      ['name', 'age', 'email'],
      [
        ['Alice', 30, 'alice@example.com'],
        ['Bob', 25, 'bob@example.com']
      ]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].age, 30);
    assertEqual(result[0].email, 'alice@example.com');
    assertEqual(result[1].name, 'Bob');
  });

  test('1行のデータ', () => {
    const sheet = MockSheet.create(
      ['key', 'value'],
      [['foo', 'bar']]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result.length, 1);
    assertEqual(result[0].key, 'foo');
    assertEqual(result[0].value, 'bar');
  });

  test('空のシートは空配列を返す', () => {
    const sheet = MockSheet.empty();
    const result = loadFromSheetAsObjects(sheet);
    assertDeepEqual(result, []);
  });

  test('ヘッダーのみのシートは空配列を返す', () => {
    const sheet = MockSheet.headerOnly(['name', 'age']);
    const result = loadFromSheetAsObjects(sheet);
    assertDeepEqual(result, []);
  });
};

const runSheetMapperTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue } = TestRunner;

  suite('loadFromSheetAsObjects キーマッパー');

  test('キーを小文字に変換する', () => {
    const sheet = MockSheet.create(
      ['Name', 'AGE'],
      [['Alice', 30]]
    );
    const result = loadFromSheetAsObjects(sheet, key => key.toLowerCase());
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].age, 30);
  });

  test('マッパーが null を返すとスキップする', () => {
    const sheet = MockSheet.create(
      ['name', 'internal_id', 'email'],
      [['Alice', 999, 'alice@example.com']]
    );
    const result = loadFromSheetAsObjects(sheet, key =>
      key === 'internal_id' ? null : key
    );
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[0].email, 'alice@example.com');
    assertTrue(!('internal_id' in result[0]));
  });

  test('マッパーが undefined を返すとスキップする', () => {
    const sheet = MockSheet.create(
      ['name', 'skip'],
      [['Alice', 'skip_value']]
    );
    const result = loadFromSheetAsObjects(sheet, key =>
      key === 'skip' ? undefined : key
    );
    assertTrue(!('skip' in result[0]));
  });

  test('マッパーが配列を返すとネスト構造を作成する', () => {
    const sheet = MockSheet.create(
      ['user.name', 'user.age'],
      [['Alice', 30]]
    );
    const result = loadFromSheetAsObjects(sheet, key => key.split('.'));
    assertEqual(result[0].user.name, 'Alice');
    assertEqual(result[0].user.age, 30);
  });

  test('マッパーに columnIndex が渡される', () => {
    const indices = [];
    const sheet = MockSheet.create(
      ['a', 'b', 'c'],
      [['1', '2', '3']]
    );
    loadFromSheetAsObjects(sheet, (key, idx) => {
      indices.push(idx);
      return key;
    });
    assertDeepEqual(indices, [0, 1, 2]);
  });
};

const runSheetLimitOffsetTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('loadFromSheetAsObjects limit/offset');

  test('limit で行数を制限する', () => {
    const sheet = MockSheet.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
    );
    const result = loadFromSheetAsObjects(sheet, 2);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Alice');
    assertEqual(result[1].name, 'Bob');
  });

  test('offset で先頭行をスキップする', () => {
    const sheet = MockSheet.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
    );
    const result = loadFromSheetAsObjects(sheet, Infinity, 1);
    assertEqual(result.length, 3);
    assertEqual(result[0].name, 'Bob');
  });

  test('limit と offset を同時に使用する', () => {
    const sheet = MockSheet.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie'], ['Dave']]
    );
    const result = loadFromSheetAsObjects(sheet, 2, 1);
    assertEqual(result.length, 2);
    assertEqual(result[0].name, 'Bob');
    assertEqual(result[1].name, 'Charlie');
  });

  test('limit が total rows より大きい場合は全行を返す', () => {
    const sheet = MockSheet.create(
      ['name'],
      [['Alice'], ['Bob']]
    );
    const result = loadFromSheetAsObjects(sheet, 100);
    assertEqual(result.length, 2);
  });

  test('offset が total rows より大きい場合は空配列', () => {
    const sheet = MockSheet.create(
      ['name'],
      [['Alice'], ['Bob']]
    );
    const result = loadFromSheetAsObjects(sheet, Infinity, 100);
    assertEqual(result.length, 0);
  });

  test('fn + limit + offset を同時に使用する', () => {
    const sheet = MockSheet.create(
      ['Name'],
      [['Alice'], ['Bob'], ['Charlie']]
    );
    const result = loadFromSheetAsObjects(sheet, key => key.toLowerCase(), 1, 1);
    assertEqual(result.length, 1);
    assertEqual(result[0].name, 'Bob');
  });
};

const runSheetArraySuffixTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue } = TestRunner;

  suite('loadFromSheetAsObjects 配列サフィックス');

  test('key[] で同名キーが配列になる', () => {
    const sheet = MockSheet.create(
      ['tags[]', 'tags[]', 'name'],
      [['a', 'b', 'Alice']]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertDeepEqual(result[0]['tags'], ['a', 'b']);
    assertEqual(result[0].name, 'Alice');
  });

  test('key\\[] はリテラルの [] として扱われる', () => {
    const sheet = MockSheet.create(
      ['tags\\[]'],
      [['value']]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result[0]['tags[]'], 'value');
  });

  test('ネストパス + 配列サフィックス', () => {
    const sheet = MockSheet.create(
      ['user.tags[]', 'user.tags[]'],
      [['a', 'b']]
    );
    const result = loadFromSheetAsObjects(sheet, key => key.split('.'));
    assertDeepEqual(result[0].user.tags, ['a', 'b']);
  });
};

const runSheetEdgeCaseTests = () => {
  const { suite, test, assertEqual, assertDeepEqual, assertTrue } = TestRunner;

  suite('loadFromSheetAsObjects エッジケース');

  test('値が空文字の場合はそのまま設定する', () => {
    const sheet = MockSheet.create(
      ['name', 'value'],
      [['key', '']]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result[0].value, '');
  });

  test('値が 0 の場合はそのまま設定する', () => {
    const sheet = MockSheet.create(
      ['name', 'count'],
      [['key', 0]]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result[0].count, 0);
  });

  test('値が null の場合はそのまま設定する', () => {
    const sheet = MockSheet.create(
      ['name', 'value'],
      [['key', null]]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result[0].value, null);
  });

  test('値が boolean の場合はそのまま設定する', () => {
    const sheet = MockSheet.create(
      ['name', 'active'],
      [['key', true]]
    );
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result[0].active, true);
  });

  test('大量行のパフォーマンス（100行）', () => {
    const rows = [];
    for (let i = 0; i < 100; i++) {
      rows.push([`name_${i}`, i]);
    }
    const sheet = MockSheet.create(['name', 'index'], rows);
    const result = loadFromSheetAsObjects(sheet);
    assertEqual(result.length, 100);
    assertEqual(result[99].name, 'name_99');
    assertEqual(result[99].index, 99);
  });

  test('ネストの途中で上書きが発生する場合', () => {
    const sheet = MockSheet.create(
      ['a', 'a.b'],
      [['flat', 'nested']]
    );
    const result = loadFromSheetAsObjects(sheet, key => {
      if (key === 'a.b') {
        return ['a', 'b'];
      }
      return key;
    });
    assertEqual(result[0].a.b, 'nested');
  });

  test('引数の順序に関わらず型で判定される', () => {
    const sheet = MockSheet.create(
      ['name'],
      [['Alice'], ['Bob'], ['Charlie']]
    );
    const result = loadFromSheetAsObjects(sheet, 1, 1, key => key.toUpperCase());
    assertEqual(result.length, 1);
    assertEqual(result[0].NAME, 'Bob');
  });
};

// ============================================================================
// loadFromRangeAsObjects テスト
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

function runAllLoadAsObjectsTests() {
  TestRunner.reset();

  runSheetBasicTests();
  runSheetMapperTests();
  runSheetLimitOffsetTests();
  runSheetArraySuffixTests();
  runSheetEdgeCaseTests();
  runRangeObjectTests();
  runRangeStringTests();

  return TestRunner.run();
}
