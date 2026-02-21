'use strict';

/**
 * LazyTemplate.test.gs
 *
 * @description LazyTemplate のテストスイート
 *
 * 実行方法:
 *   GAS エディタから runAllLazyTemplateTests() を実行
 */

// ============================================================================
// LazyTemplate テスト
// ============================================================================

const runLazyTemplateConstructorTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('LazyTemplate コンストラクタ');

  test('文字列でインスタンスを作成できる', () => {
    const t = new LazyTemplate('hello');
    assertTrue(t instanceof LazyTemplate);
  });

  test('空文字でインスタンスを作成できる', () => {
    const t = new LazyTemplate('');
    assertTrue(t instanceof LazyTemplate);
  });

  test('非文字列で TypeError をスローする', () => {
    assertThrows(() => new LazyTemplate(null), 'template には文字列を指定してください');
  });

  test('undefined で TypeError をスローする', () => {
    assertThrows(() => new LazyTemplate(undefined), 'template には文字列を指定してください');
  });

  test('数値で TypeError をスローする', () => {
    assertThrows(() => new LazyTemplate(42), 'template には文字列を指定してください');
  });

  test('カスタムフィルターを渡せる', () => {
    const t = new LazyTemplate('{{{x | double}}}', { double: v => v * 2 });
    assertEqual(t.evaluate({ x: 5 }), '10');
  });
};

const runLazyTemplateEvaluateTests = () => {
  const { suite, test, assertEqual, assertThrows } = TestRunner;

  // ─── 基本評価テスト ───────────────────────────────────────────────

  suite('LazyTemplate.evaluate 基本');

  test('プレースホルダーなしはそのまま返す', () => {
    const t = new LazyTemplate('hello world');
    assertEqual(t.evaluate({}), 'hello world');
  });

  test('単一プレースホルダーを評価する', () => {
    const t = new LazyTemplate('Hello {{{name}}}!');
    assertEqual(t.evaluate({ name: 'World' }), 'Hello World!');
  });

  test('複数プレースホルダーを評価する', () => {
    const t = new LazyTemplate('{{{first}}} {{{last}}}');
    assertEqual(t.evaluate({ first: 'John', last: 'Doe' }), 'John Doe');
  });

  test('存在しないキーは空文字になる', () => {
    const t = new LazyTemplate('Hello {{{name}}}!');
    assertEqual(t.evaluate({}), 'Hello !');
  });

  test('null data で TypeError をスローする', () => {
    const t = new LazyTemplate('{{{x}}}');
    assertThrows(() => t.evaluate(null), 'data にはオブジェクトを指定してください');
  });

  test('undefined data で TypeError をスローする', () => {
    const t = new LazyTemplate('{{{x}}}');
    assertThrows(() => t.evaluate(undefined), 'data にはオブジェクトを指定してください');
  });

  // ─── プロパティアクセステスト ─────────────────────────────────────

  suite('LazyTemplate.evaluate プロパティアクセス');

  test('ドット記法でネストプロパティにアクセスする', () => {
    const t = new LazyTemplate('{{{user.name}}}');
    assertEqual(t.evaluate({ user: { name: 'Alice' } }), 'Alice');
  });

  test('深いネストにアクセスする', () => {
    const t = new LazyTemplate('{{{a.b.c.d}}}');
    assertEqual(t.evaluate({ a: { b: { c: { d: 'deep' } } } }), 'deep');
  });

  test('配列インデックスでアクセスする', () => {
    const t = new LazyTemplate('{{{items[0]}}}');
    assertEqual(t.evaluate({ items: ['first', 'second'] }), 'first');
  });

  test('ブラケット文字列キーでアクセスする', () => {
    const t = new LazyTemplate('{{{data["key-with-dash"]}}}');
    assertEqual(t.evaluate({ data: { 'key-with-dash': 'value' } }), 'value');
  });

  test('シングルクォートブラケットでアクセスする', () => {
    const t = new LazyTemplate("{{{data['key']}}}");
    assertEqual(t.evaluate({ data: { key: 'value' } }), 'value');
  });

  test('ドットとブラケットの混合アクセス', () => {
    const t = new LazyTemplate('{{{users[0].name}}}');
    assertEqual(t.evaluate({ users: [{ name: 'Alice' }] }), 'Alice');
  });

  test('途中で null/undefined だと空文字になる', () => {
    const t = new LazyTemplate('{{{a.b.c}}}');
    assertEqual(t.evaluate({ a: null }), '');
  });

  test('途中でプリミティブだと空文字になる', () => {
    const t = new LazyTemplate('{{{a.b.c}}}');
    assertEqual(t.evaluate({ a: 42 }), '');
  });

  test('ドット (.) はデータ全体を参照する', () => {
    const t = new LazyTemplate('{{{.}}}');
    assertEqual(t.evaluate('hello'), 'hello');
  });

  // ─── フォールバックテスト ─────────────────────────────────────────

  suite('LazyTemplate.evaluate フォールバック');

  test('最初の値が存在すればそれを使う', () => {
    const t = new LazyTemplate('{{{name || "default"}}}');
    assertEqual(t.evaluate({ name: 'Alice' }), 'Alice');
  });

  test('最初の値がなければフォールバックを使う', () => {
    const t = new LazyTemplate('{{{name || "default"}}}');
    assertEqual(t.evaluate({}), 'default');
  });

  test('最初の値が空文字ならフォールバックを使う', () => {
    const t = new LazyTemplate('{{{name || "fallback"}}}');
    assertEqual(t.evaluate({ name: '' }), 'fallback');
  });

  test('最初の値が null ならフォールバックを使う', () => {
    const t = new LazyTemplate('{{{name || "fallback"}}}');
    assertEqual(t.evaluate({ name: null }), 'fallback');
  });

  test('複数段のフォールバック', () => {
    const t = new LazyTemplate('{{{a || b || "last"}}}');
    assertEqual(t.evaluate({}), 'last');
  });

  test('数値リテラルのフォールバック', () => {
    const t = new LazyTemplate('{{{count || 0}}}');
    // テンプレートエンジンは undefined/null/'' のみスキップ。0 は有効な値として返される
    assertEqual(t.evaluate({}), '0');
  });

  test('正の数値リテラルのフォールバック', () => {
    const t = new LazyTemplate('{{{count || 42}}}');
    assertEqual(t.evaluate({}), '42');
  });

  // ─── フィルターテスト ─────────────────────────────────────────────

  suite('LazyTemplate.evaluate フィルター');

  test('単一フィルターを適用する', () => {
    const t = new LazyTemplate('{{{name | upper}}}');
    assertEqual(t.evaluate({ name: 'hello' }), 'HELLO');
  });

  test('複数フィルターをチェーンする', () => {
    const t = new LazyTemplate('{{{name | trim | upper}}}');
    assertEqual(t.evaluate({ name: '  hello  ' }), 'HELLO');
  });

  test('存在しないフィルターは無視される', () => {
    const t = new LazyTemplate('{{{name | nonexistent}}}');
    assertEqual(t.evaluate({ name: 'hello' }), 'hello');
  });

  test('フォールバックとフィルターの組み合わせ', () => {
    const t = new LazyTemplate('{{{name || "default" | upper}}}');
    assertEqual(t.evaluate({}), 'DEFAULT');
  });

  // ─── エスケープテスト ─────────────────────────────────────────────

  suite('LazyTemplate.evaluate エスケープ');

  test('バックスラッシュ付きプレースホルダーはリテラルになる', () => {
    const t = new LazyTemplate('\\{{{name}}}');
    assertEqual(t.evaluate({ name: 'Alice' }), '{{{name}}}');
  });

  test('二重バックスラッシュはバックスラッシュ1個+評価', () => {
    const t = new LazyTemplate('\\\\{{{name}}}');
    assertEqual(t.evaluate({ name: 'Alice' }), '\\{{{name}}}');
  });
};

const runLazyTemplatePrimitiveFilterTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  // ─── プリミティブフィルターテスト ─────────────────────────────────

  suite('LazyTemplate プリミティブフィルター 文字列操作');

  test('trim: 前後の空白を削除する', () => {
    const t = new LazyTemplate('{{{v | trim}}}');
    assertEqual(t.evaluate({ v: '  hello  ' }), 'hello');
  });

  test('trim: 非文字列はそのまま', () => {
    const t = new LazyTemplate('{{{v | trim}}}');
    assertEqual(t.evaluate({ v: 42 }), '42');
  });

  test('trimStart: 先頭の空白のみ削除する', () => {
    const t = new LazyTemplate('{{{v | trimStart}}}');
    assertEqual(t.evaluate({ v: '  hello  ' }), 'hello  ');
  });

  test('trimEnd: 末尾の空白のみ削除する', () => {
    const t = new LazyTemplate('{{{v | trimEnd}}}');
    assertEqual(t.evaluate({ v: '  hello  ' }), '  hello');
  });

  test('upper: 大文字化する', () => {
    const t = new LazyTemplate('{{{v | upper}}}');
    assertEqual(t.evaluate({ v: 'hello' }), 'HELLO');
  });

  test('lower: 小文字化する', () => {
    const t = new LazyTemplate('{{{v | lower}}}');
    assertEqual(t.evaluate({ v: 'HELLO' }), 'hello');
  });

  suite('LazyTemplate プリミティブフィルター 数値操作');

  test('round: 四捨五入する', () => {
    const t = new LazyTemplate('{{{v | round}}}');
    assertEqual(t.evaluate({ v: 3.7 }), '4');
  });

  test('round: 文字列数値を変換する', () => {
    const t = new LazyTemplate('{{{v | round}}}');
    assertEqual(t.evaluate({ v: '3.2' }), '3');
  });

  test('round: 非数値はそのまま', () => {
    const t = new LazyTemplate('{{{v | round}}}');
    assertEqual(t.evaluate({ v: 'abc' }), 'abc');
  });

  test('int: 小数点以下を切り捨てる', () => {
    const t = new LazyTemplate('{{{v | int}}}');
    assertEqual(t.evaluate({ v: 3.9 }), '3');
  });

  test('int: 負数の小数点以下を切り捨てる', () => {
    const t = new LazyTemplate('{{{v | int}}}');
    assertEqual(t.evaluate({ v: -3.9 }), '-3');
  });

  test('float: 浮動小数点数化する', () => {
    const t = new LazyTemplate('{{{v | float}}}');
    assertEqual(t.evaluate({ v: '3.14' }), '3.14');
  });

  test('abs: 絶対値を返す', () => {
    const t = new LazyTemplate('{{{v | abs}}}');
    assertEqual(t.evaluate({ v: -42 }), '42');
  });

  test('ceil: 切り上げる', () => {
    const t = new LazyTemplate('{{{v | ceil}}}');
    assertEqual(t.evaluate({ v: 3.1 }), '4');
  });

  test('floor: 切り捨てる', () => {
    const t = new LazyTemplate('{{{v | floor}}}');
    assertEqual(t.evaluate({ v: 3.9 }), '3');
  });

  test('negate: 符号を反転する', () => {
    const t = new LazyTemplate('{{{v | negate}}}');
    assertEqual(t.evaluate({ v: 42 }), '-42');
  });

  suite('LazyTemplate プリミティブフィルター 汎用');

  test('length: 文字列の長さを返す', () => {
    const t = new LazyTemplate('{{{v | length}}}');
    assertEqual(t.evaluate({ v: 'hello' }), '5');
  });

  test('length: 配列の長さを返す', () => {
    const t = new LazyTemplate('{{{v | length}}}');
    assertEqual(t.evaluate({ v: [1, 2, 3] }), '3');
  });

  test('length: その他は 0 を返す', () => {
    const t = new LazyTemplate('{{{v | length}}}');
    assertEqual(t.evaluate({ v: 42 }), '0');
  });

  test('string: null を空文字にする', () => {
    const t = new LazyTemplate('{{{v | string}}}');
    assertEqual(t.evaluate({ v: null }), '');
  });

  test('boolean: truthy を true にする', () => {
    const t = new LazyTemplate('{{{v | boolean}}}');
    assertEqual(t.evaluate({ v: 'hello' }), 'true');
  });

  test('boolean: falsy を false にする', () => {
    const t = new LazyTemplate('{{{v | boolean}}}');
    assertEqual(t.evaluate({ v: 0 }), 'false');
  });

  test('default: null を空文字にする', () => {
    const t = new LazyTemplate('{{{v | default}}}');
    // null の場合 default は '' を返すが、'' は falsy なのでフォールバック先がなければ '' になる
    // Actually, default filter returns '' for null. But '' is considered empty, so evaluate returns ''
    assertEqual(t.evaluate({ v: null }), '');
  });

  test('default: 値がある場合はそのまま', () => {
    const t = new LazyTemplate('{{{v | default}}}');
    assertEqual(t.evaluate({ v: 'hello' }), 'hello');
  });

  suite('LazyTemplate プリミティブフィルター JSON');

  test('json: オブジェクトを JSON 文字列にする', () => {
    const t = new LazyTemplate('{{{v | json}}}');
    assertEqual(t.evaluate({ v: { a: 1 } }), '{"a":1}');
  });

  test('json: 配列を JSON 文字列にする', () => {
    const t = new LazyTemplate('{{{v | json}}}');
    assertEqual(t.evaluate({ v: [1, 2, 3] }), '[1,2,3]');
  });

  test('jsonPretty: 整形された JSON を返す', () => {
    const t = new LazyTemplate('{{{v | jsonPretty}}}');
    const result = t.evaluate({ v: { a: 1 } });
    assertTrue(result.includes('\n'));
    assertTrue(result.includes('  "a": 1'));
  });
};

const runLazyTemplateRegisterFilterTests = () => {
  const { suite, test, assertEqual, assertThrows } = TestRunner;

  suite('LazyTemplate.registerFilter');

  test('カスタムフィルターを登録して使用できる', () => {
    const t = new LazyTemplate('{{{v | reverse}}}');
    t.registerFilter('reverse', v => typeof v === 'string' ? v.split('').reverse().join('') : v);
    assertEqual(t.evaluate({ v: 'hello' }), 'olleh');
  });

  test('空文字の name で TypeError をスローする', () => {
    const t = new LazyTemplate('');
    assertThrows(() => t.registerFilter('', () => {}), 'name には空でない文字列を指定してください');
  });

  test('非文字列の name で TypeError をスローする', () => {
    const t = new LazyTemplate('');
    assertThrows(() => t.registerFilter(42, () => {}), 'name には空でない文字列を指定してください');
  });

  test('非関数の fn で TypeError をスローする', () => {
    const t = new LazyTemplate('');
    assertThrows(() => t.registerFilter('test', 'not a function'), 'fn には関数を指定してください');
  });

  test('プリミティブフィルターを上書きできる', () => {
    const t = new LazyTemplate('{{{v | upper}}}');
    t.registerFilter('upper', v => `CUSTOM_${v}`);
    assertEqual(t.evaluate({ v: 'hello' }), 'CUSTOM_hello');
  });
};

const runLazyTemplateStaticTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('LazyTemplate.evaluate 静的メソッド');

  test('ワンショット評価ができる', () => {
    assertEqual(LazyTemplate.evaluate('Hello {{{name}}}!', { name: 'World' }), 'Hello World!');
  });

  test('カスタムフィルター付きワンショット評価', () => {
    const result = LazyTemplate.evaluate('{{{v | double}}}', { v: 5 }, { double: v => v * 2 });
    assertEqual(result, '10');
  });

  test('プレースホルダーなしのワンショット評価', () => {
    assertEqual(LazyTemplate.evaluate('plain text', {}), 'plain text');
  });
};

const runLazyTemplateEdgeCaseTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('LazyTemplate エッジケース');

  test('空テンプレートは空文字を返す', () => {
    const t = new LazyTemplate('');
    assertEqual(t.evaluate({}), '');
  });

  test('空プレースホルダーは空文字を返す', () => {
    const t = new LazyTemplate('{{{  }}}');
    assertEqual(t.evaluate({ '': 'value' }), '');
  });

  test('式の前後の空白は無視される', () => {
    const t = new LazyTemplate('{{{  name  }}}');
    assertEqual(t.evaluate({ name: 'Alice' }), 'Alice');
  });

  test('値が 0 の場合 falsy なのでフォールバックされない（数値は truthy 扱い）', () => {
    // 0 is falsy in JS, but the template engine evaluates truthy as != '' and != null and != undefined
    // Actually, looking at the code: if value === undefined || value === null || value === '' → continue
    // So 0 would NOT match any of those, it would be returned as is
    const t = new LazyTemplate('{{{count || "none"}}}');
    assertEqual(t.evaluate({ count: 0 }), '0');
  });

  test('値が false の場合もフォールバックされない', () => {
    const t = new LazyTemplate('{{{flag || "default"}}}');
    assertEqual(t.evaluate({ flag: false }), 'false');
  });

  test('文字列リテラル（ダブルクォート）', () => {
    const t = new LazyTemplate('{{{ "hello world" }}}');
    assertEqual(t.evaluate({}), 'hello world');
  });

  test('文字列リテラル（シングルクォート）', () => {
    const t = new LazyTemplate("{{{ 'hello world' }}}");
    assertEqual(t.evaluate({}), 'hello world');
  });

  test('数値リテラル', () => {
    const t = new LazyTemplate('{{{ 42 }}}');
    assertEqual(t.evaluate({}), '42');
  });

  test('負の数値リテラル', () => {
    const t = new LazyTemplate('{{{ -3.14 }}}');
    assertEqual(t.evaluate({ }), '-3.14');
  });

  test('キャッシュが効いている（同じ式を2回評価）', () => {
    const t = new LazyTemplate('{{{a}}} {{{a}}}');
    assertEqual(t.evaluate({ a: 'x' }), 'x x');
  });

  test('テンプレート内に中括弧を含む文字列', () => {
    const t = new LazyTemplate('before {{{name}}} after');
    assertEqual(t.evaluate({ name: '{value}' }), 'before {value} after');
  });

  test('非常に長いキーパス', () => {
    const t = new LazyTemplate('{{{a.b.c.d.e.f.g}}}');
    assertEqual(t.evaluate({ a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } }), 'deep');
  });

  test('値が undefined のキーは空文字になる', () => {
    const t = new LazyTemplate('{{{a}}}');
    assertEqual(t.evaluate({ a: undefined }), '');
  });

  test('配列の範囲外インデックスは空文字になる', () => {
    const t = new LazyTemplate('{{{items[99]}}}');
    assertEqual(t.evaluate({ items: [1, 2, 3] }), '');
  });

  // ─── stripWhitespaceWithoutStringLiteral テスト ───────────────────

  suite('LazyTemplate 空白正規化');

  test('文字列リテラル外の空白を圧縮する', () => {
    const t = new LazyTemplate('{{{  name  |  upper  }}}');
    assertEqual(t.evaluate({ name: 'hello' }), 'HELLO');
  });

  test('文字列リテラル内の空白は保持される', () => {
    const t = new LazyTemplate('{{{ "hello  world" }}}');
    assertEqual(t.evaluate({}), 'hello  world');
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllLazyTemplateTests() {
  TestRunner.reset();

  console.log('Running LazyTemplate Constructor tests...');
  runLazyTemplateConstructorTests();

  console.log('Running LazyTemplate Evaluate tests...');
  runLazyTemplateEvaluateTests();

  console.log('Running LazyTemplate Primitive Filter tests...');
  runLazyTemplatePrimitiveFilterTests();

  console.log('Running LazyTemplate registerFilter tests...');
  runLazyTemplateRegisterFilterTests();

  console.log('Running LazyTemplate Static tests...');
  runLazyTemplateStaticTests();

  console.log('Running LazyTemplate Edge Case tests...');
  runLazyTemplateEdgeCaseTests();

  return TestRunner.run();
}
