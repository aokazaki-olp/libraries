'use strict';

/**
 * resolveSheet.test.gs
 *
 * @description resolveSheet のテストスイート（GAS モック使用）
 *
 * 実行方法:
 *   GAS エディタから runAllResolveSheetTests() を実行
 */

// ============================================================================
// GAS モック
// ============================================================================

const MockGasSheet = (function () {
  /**
   * モック Sheet を作成
   */
  const createSheet = (name, sheetId = 0) => ({
    getName: () => name,
    getSheetId: () => sheetId,
    _name: name,
    _sheetId: sheetId
  });

  /**
   * モック Spreadsheet を作成
   */
  const createSpreadsheet = (sheets, insertedSheets = []) => ({
    getSheets: () => sheets,
    getSheetByName: name => sheets.find(s => s.getName() === name) || null,
    insertSheet: name => {
      const newSheet = createSheet(name, 9999);
      insertedSheets.push(newSheet);
      sheets.push(newSheet);
      return newSheet;
    },
    _insertedSheets: insertedSheets
  });

  /**
   * SpreadsheetApp モックをセットアップ
   */
  const setup = (config = {}) => {
    const sheets = config.sheets || [createSheet('Sheet1', 0), createSheet('Sheet2', 123)];
    const spreadsheet = createSpreadsheet(sheets);

    const original = {
      SpreadsheetApp: typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : undefined
    };

    globalThis.SpreadsheetApp = {
      openByUrl: url => spreadsheet,
      openById: id => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet
    };

    return {
      spreadsheet,
      sheets,
      restore: () => {
        if (original.SpreadsheetApp === undefined) {
          delete globalThis.SpreadsheetApp;
        } else {
          globalThis.SpreadsheetApp = original.SpreadsheetApp;
        }
      }
    };
  };

  return { createSheet, createSpreadsheet, setup };
})();

// ============================================================================
// resolveSheet テスト
// ============================================================================

const runResolveSheetBasicTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('resolveSheet Sheet オブジェクト');

  test('Sheet オブジェクトをそのまま返す', () => {
    const sheet = MockGasSheet.createSheet('Test', 42);
    const result = resolveSheet(sheet);
    assertEqual(result, sheet);
  });

  test('getSheetId メソッドがないオブジェクトは Sheet として扱わない', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ name: 'not a sheet' });
      // { name: 'not a sheet' } には url/id/urlOrId もないので TypeError になるはず
      // Actually... source is object but no url/id/urlOrId → falls through to string check → not string → TypeError
      assertTrue(false); // should not reach
    } catch (e) {
      assertTrue(e instanceof TypeError);
    } finally {
      mock.restore();
    }
  });

  suite('resolveSheet 文字列（シート名）');

  test('シート名でアクティブスプレッドシートから取得', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('Sheet1');
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('存在しないシート名でエラー', () => {
    const mock = MockGasSheet.setup();
    try {
      assertThrows(() => resolveSheet('NotExist'), 'シートが見つかりません');
    } finally {
      mock.restore();
    }
  });

  test('create: true で存在しないシートを作成する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('NewSheet', { create: true });
      assertEqual(result.getName(), 'NewSheet');
      assertEqual(mock.spreadsheet._insertedSheets.length, 1);
    } finally {
      mock.restore();
    }
  });

  test('create: true で既存シートはそのまま返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('Sheet1', { create: true });
      assertEqual(result.getName(), 'Sheet1');
      assertEqual(mock.spreadsheet._insertedSheets.length, 0);
    } finally {
      mock.restore();
    }
  });
};

const runResolveSheetUrlTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('resolveSheet URL 文字列');

  test('URL 文字列を openByUrl で処理する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('https://docs.google.com/spreadsheets/d/abc123/edit');
      // gid なし → 最初のシート
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('URL に gid が含まれる場合、対応するシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('https://docs.google.com/spreadsheets/d/abc123/edit?gid=123');
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('URL の gid が存在しないシートの場合エラー', () => {
    const mock = MockGasSheet.setup();
    try {
      assertThrows(
        () => resolveSheet('https://docs.google.com/spreadsheets/d/abc123/edit?gid=999'),
        'シートが見つかりません: gid=999'
      );
    } finally {
      mock.restore();
    }
  });

  suite('resolveSheet 配列');

  test('[url, index] で指定した位置のシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['https://docs.google.com/spreadsheets/d/abc123/edit', 1]);
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('[url, name] で指定した名前のシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['https://docs.google.com/spreadsheets/d/abc123/edit', 'Sheet2']);
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('[id, index] で指定した位置のシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['abc123', 0]);
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('[id, name] で指定した名前のシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['abc123', 'Sheet2']);
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('[url] selector なし、gid なしで最初のシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['https://docs.google.com/spreadsheets/d/abc123/edit']);
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('[url] selector なし、gid ありで gid のシートを返す', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['https://docs.google.com/spreadsheets/d/abc123/edit?gid=123']);
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('配列 index が範囲外でエラー', () => {
    const mock = MockGasSheet.setup();
    try {
      assertThrows(
        () => resolveSheet(['abc123', 99]),
        'シートが見つかりません: index=99'
      );
    } finally {
      mock.restore();
    }
  });

  test('配列 create: true + index 指定でエラー', () => {
    const mock = MockGasSheet.setup();
    try {
      assertThrows(
        () => resolveSheet(['abc123', 99], { create: true }),
        'create オプションは index 指定 では使用できません'
      );
    } finally {
      mock.restore();
    }
  });

  test('配列 create: true + name で新規作成', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet(['abc123', 'NewSheet'], { create: true });
      assertEqual(result.getName(), 'NewSheet');
    } finally {
      mock.restore();
    }
  });
};

const runResolveSheetObjectTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('resolveSheet オブジェクト');

  test('{ url, name } で指定する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ url: 'https://docs.google.com/spreadsheets/d/abc123/edit', name: 'Sheet2' });
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('{ id, index } で指定する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ id: 'abc123', index: 1 });
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('{ urlOrId, name } URL形式で指定する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ urlOrId: 'https://docs.google.com/spreadsheets/d/abc123/edit', name: 'Sheet1' });
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('{ urlOrId, name } ID形式で指定する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ urlOrId: 'abc123', name: 'Sheet1' });
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('{ url } のみで gid なしは最初のシート', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ url: 'https://docs.google.com/spreadsheets/d/abc123/edit' });
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('{ url } の gid でシートを選択する', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ url: 'https://docs.google.com/spreadsheets/d/abc123/edit?gid=123' });
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('{ id, name } で create: true', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet({ id: 'abc123', name: 'NewSheet' }, { create: true });
      assertEqual(result.getName(), 'NewSheet');
    } finally {
      mock.restore();
    }
  });

  test('{ id, index } で create: true はエラー', () => {
    const mock = MockGasSheet.setup();
    try {
      assertThrows(
        () => resolveSheet({ id: 'abc123', index: 99 }, { create: true }),
        'create オプションは index 指定 では使用できません'
      );
    } finally {
      mock.restore();
    }
  });

  test('{ url } + gid で create: true はエラー', () => {
    const mock = MockGasSheet.setup();
    try {
      assertThrows(
        () => resolveSheet({ url: 'https://docs.google.com/spreadsheets/d/abc123/edit?gid=999' }, { create: true }),
        'create オプションは gid 指定 では使用できません'
      );
    } finally {
      mock.restore();
    }
  });
};

const runResolveSheetEdgeCaseTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('resolveSheet エッジケース');

  test('数値は TypeError をスローする', () => {
    assertThrows(() => resolveSheet(42), 'source には string, Array, Object, または Sheet を指定してください');
  });

  test('true は TypeError をスローする', () => {
    assertThrows(() => resolveSheet(true), 'source には string, Array, Object, または Sheet を指定してください');
  });

  test('null は TypeError をスローする', () => {
    assertThrows(() => resolveSheet(null), 'source には string, Array, Object, または Sheet を指定してください');
  });

  test('undefined は TypeError をスローする', () => {
    assertThrows(() => resolveSheet(undefined), 'source には string, Array, Object, または Sheet を指定してください');
  });

  test('url 優先順位: url > urlOrId', () => {
    const mock = MockGasSheet.setup();
    // url が指定されていれば urlOrId は無視
    try {
      const result = resolveSheet({
        url: 'https://docs.google.com/spreadsheets/d/abc123/edit',
        urlOrId: 'different-id',
        name: 'Sheet1'
      });
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });

  test('gid が # 区切りでも取得できる', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('https://docs.google.com/spreadsheets/d/abc123/edit#gid=123');
      assertEqual(result.getName(), 'Sheet2');
    } finally {
      mock.restore();
    }
  });

  test('options なしでもデフォルト値が使われる', () => {
    const mock = MockGasSheet.setup();
    try {
      const result = resolveSheet('Sheet1');
      assertEqual(result.getName(), 'Sheet1');
    } finally {
      mock.restore();
    }
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllResolveSheetTests() {
  TestRunner.reset();

  console.log('Running resolveSheet Basic tests...');
  runResolveSheetBasicTests();

  console.log('Running resolveSheet URL tests...');
  runResolveSheetUrlTests();

  console.log('Running resolveSheet Object tests...');
  runResolveSheetObjectTests();

  console.log('Running resolveSheet Edge Case tests...');
  runResolveSheetEdgeCaseTests();

  return TestRunner.run();
}
