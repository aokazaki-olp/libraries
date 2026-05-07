import { describe, it, expect } from 'vitest';
import { LazyTemplate } from '../src/LazyTemplate.js';

// ============================================================================
// コンストラクタ
// ============================================================================

describe('LazyTemplate コンストラクタ', () => {
  it('文字列でインスタンスを作成できる', () => {
    expect(new LazyTemplate('hello')).toBeInstanceOf(LazyTemplate);
  });

  it('空文字でインスタンスを作成できる', () => {
    expect(new LazyTemplate('')).toBeInstanceOf(LazyTemplate);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数値', 42],
    ['配列', []],
  ] as [string, unknown][])(
    '%s → TypeError',
    (_label, value) => {
      expect(() => new LazyTemplate(value as string)).toThrow(TypeError);
    },
  );

  it('カスタムフィルターを渡せる', () => {
    const t = new LazyTemplate('{{{x | double}}}', { double: v => (v as number) * 2 });
    expect(t.evaluate({ x: 5 })).toBe('10');
  });
});

// ============================================================================
// evaluate — 基本
// ============================================================================

describe('LazyTemplate.evaluate — 基本', () => {
  it('プレースホルダーなしはそのまま返す', () => {
    expect(new LazyTemplate('hello world').evaluate({})).toBe('hello world');
  });

  it('単一プレースホルダーを評価する', () => {
    expect(new LazyTemplate('Hello {{{name}}}!').evaluate({ name: 'World' })).toBe('Hello World!');
  });

  it('複数プレースホルダーを評価する', () => {
    expect(new LazyTemplate('{{{first}}} {{{last}}}').evaluate({ first: 'John', last: 'Doe' })).toBe('John Doe');
  });

  it('存在しないキーは空文字になる', () => {
    expect(new LazyTemplate('Hello {{{name}}}!').evaluate({})).toBe('Hello !');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ] as [string, unknown][])(
    '%s を渡すと TypeError',
    (_label, value) => {
      expect(() => new LazyTemplate('{{{x}}}').evaluate(value as object)).toThrow(TypeError);
    },
  );
});

// ============================================================================
// evaluate — プロパティアクセス
// ============================================================================

describe('LazyTemplate.evaluate — プロパティアクセス', () => {
  it('ドット記法でネストプロパティにアクセスする', () => {
    expect(new LazyTemplate('{{{user.name}}}').evaluate({ user: { name: 'Alice' } })).toBe('Alice');
  });

  it('3階層のネストにアクセスする', () => {
    expect(new LazyTemplate('{{{a.b.c}}}').evaluate({ a: { b: { c: 'deep' } } })).toBe('deep');
  });

  it('配列インデックスでアクセスする', () => {
    expect(new LazyTemplate('{{{items[0]}}}').evaluate({ items: ['first', 'second'] })).toBe('first');
  });

  it('ブラケット文字列キーでアクセスする', () => {
    expect(new LazyTemplate('{{{data["key-with-dash"]}}}').evaluate({ data: { 'key-with-dash': 'value' } })).toBe('value');
  });

  it("シングルクォートブラケットでアクセスする", () => {
    expect(new LazyTemplate("{{{data['key']}}}").evaluate({ data: { key: 'value' } })).toBe('value');
  });

  it('ドットとブラケットの混合アクセス', () => {
    expect(new LazyTemplate('{{{users[0].name}}}').evaluate({ users: [{ name: 'Alice' }] })).toBe('Alice');
  });

  it('途中で null だと空文字になる', () => {
    expect(new LazyTemplate('{{{a.b.c}}}').evaluate({ a: null })).toBe('');
  });

  it('途中でプリミティブだと空文字になる', () => {
    expect(new LazyTemplate('{{{a.b}}}').evaluate({ a: 42 })).toBe('');
  });

  it('"." はデータ全体を参照する', () => {
    expect(new LazyTemplate('{{{.}}}').evaluate('hello' as unknown as object)).toBe('hello');
  });
});

// ============================================================================
// evaluate — フォールバック (||)
// ============================================================================

describe('LazyTemplate.evaluate — フォールバック', () => {
  it('最初の値が存在すればそれを使う', () => {
    expect(new LazyTemplate('{{{name || "default"}}}').evaluate({ name: 'Alice' })).toBe('Alice');
  });

  it('最初の値がなければフォールバック文字列リテラルを使う', () => {
    expect(new LazyTemplate('{{{name || "default"}}}').evaluate({})).toBe('default');
  });

  it('最初の値が空文字ならフォールバックを使う', () => {
    expect(new LazyTemplate('{{{name || "fallback"}}}').evaluate({ name: '' })).toBe('fallback');
  });

  it('最初の値が null ならフォールバックを使う', () => {
    expect(new LazyTemplate('{{{name || "fallback"}}}').evaluate({ name: null })).toBe('fallback');
  });

  it('複数段のフォールバック', () => {
    expect(new LazyTemplate('{{{a || b || "last"}}}').evaluate({})).toBe('last');
  });

  it('数値リテラル 0 はフォールバックとして有効', () => {
    expect(new LazyTemplate('{{{count || 0}}}').evaluate({})).toBe('0');
  });

  it('数値リテラル 42 はフォールバックとして有効', () => {
    expect(new LazyTemplate('{{{count || 42}}}').evaluate({})).toBe('42');
  });

  it("シングルクォートリテラルのフォールバック", () => {
    expect(new LazyTemplate("{{{name || 'N/A'}}}").evaluate({})).toBe('N/A');
  });

  it('0 はフォールバックを使わず "0" を返す', () => {
    expect(new LazyTemplate('{{{count || "default"}}}').evaluate({ count: 0 })).toBe('0');
  });

  it('false はフォールバックを使わず "false" を返す', () => {
    expect(new LazyTemplate('{{{flag || "N/A"}}}').evaluate({ flag: false })).toBe('false');
  });
});

// ============================================================================
// evaluate — フィルター
// ============================================================================

describe('LazyTemplate.evaluate — フィルター', () => {
  it('単一フィルターを適用する', () => {
    expect(new LazyTemplate('{{{name | upper}}}').evaluate({ name: 'hello' })).toBe('HELLO');
  });

  it('複数フィルターをチェーンする', () => {
    expect(new LazyTemplate('{{{name | trim | upper}}}').evaluate({ name: '  hello  ' })).toBe('HELLO');
  });

  it('存在しないフィルターは無視される', () => {
    expect(new LazyTemplate('{{{name | nonexistent}}}').evaluate({ name: 'hello' })).toBe('hello');
  });

  it('フォールバックとフィルターを組み合わせる', () => {
    expect(new LazyTemplate('{{{name || "default" | upper}}}').evaluate({})).toBe('DEFAULT');
  });

  it('数値リテラルにフィルターを適用する', () => {
    expect(new LazyTemplate('{{{3.7 | round}}}').evaluate({})).toBe('4');
  });

  it('文字列リテラルにフィルターを適用する', () => {
    expect(new LazyTemplate('{{{" hello " | trim}}}').evaluate({})).toBe('hello');
  });
});

// ============================================================================
// evaluate — エスケープ（バックスラッシュ）
// ============================================================================

describe('LazyTemplate.evaluate — バックスラッシュエスケープ', () => {
  it('\\{{{...}}} はリテラルとして出力する', () => {
    expect(new LazyTemplate('\\{{{name}}}').evaluate({ name: 'Alice' })).toBe('{{{name}}}');
  });

  it('\\\\{{{...}}} はバックスラッシュ + リテラルとして出力する', () => {
    expect(new LazyTemplate('\\\\{{{name}}}').evaluate({ name: 'Alice' })).toBe('\\{{{name}}}');
  });
});

// ============================================================================
// プリミティブフィルター — 文字列操作
// ============================================================================

describe('LazyTemplate プリミティブフィルター — 文字列', () => {
  const t = (tpl: string, data: object) => new LazyTemplate(tpl).evaluate(data);

  it.each([
    ['{{{v | trim}}}', '  hello  ', 'hello'],
    ['{{{v | trimStart}}}', '  hello  ', 'hello  '],
    ['{{{v | trimEnd}}}', '  hello  ', '  hello'],
    ['{{{v | upper}}}', 'hello', 'HELLO'],
    ['{{{v | lower}}}', 'HELLO', 'hello'],
  ] as [string, string, string][])(
    'テンプレート "%s" → "%s"',
    (tpl, input, expected) => {
      expect(t(tpl, { v: input })).toBe(expected);
    },
  );

  it('trim: 非文字列はそのまま返す', () => {
    expect(t('{{{v | trim}}}', { v: 42 })).toBe('42');
  });

  it('length: 文字列の長さを返す', () => {
    expect(t('{{{v | length}}}', { v: 'hello' })).toBe('5');
  });

  it('length: 配列の長さを返す', () => {
    expect(t('{{{v | length}}}', { v: [1, 2, 3] })).toBe('3');
  });

  it('length: 対象外は 0', () => {
    expect(t('{{{v | length}}}', { v: 42 })).toBe('0');
  });
});

// ============================================================================
// プリミティブフィルター — 数値操作
// ============================================================================

describe('LazyTemplate プリミティブフィルター — 数値', () => {
  const t = (tpl: string, data: object) => new LazyTemplate(tpl).evaluate(data);

  it.each([
    ['round', 3.7, '4'],
    ['round', 3.2, '3'],
    ['int', 3.9, '3'],
    ['int', -3.9, '-3'],
    ['abs', -42, '42'],
    ['ceil', 3.1, '4'],
    ['floor', 3.9, '3'],
    ['negate', 42, '-42'],
  ] as [string, number, string][])(
    '%s(%s) → "%s"',
    (filter, input, expected) => {
      expect(t(`{{{v | ${filter}}}}`, { v: input })).toBe(expected);
    },
  );

  it('round: 文字列数値を変換する', () => {
    expect(t('{{{v | round}}}', { v: '3.7' })).toBe('4');
  });

  it('round: 非数値はそのまま返す', () => {
    expect(t('{{{v | round}}}', { v: 'abc' })).toBe('abc');
  });

  it('float: 文字列を浮動小数点数に変換する', () => {
    expect(t('{{{v | float}}}', { v: '3.14' })).toBe('3.14');
  });
});

// ============================================================================
// プリミティブフィルター — 型変換・その他
// ============================================================================

describe('LazyTemplate プリミティブフィルター — 型変換', () => {
  const t = (tpl: string, data: object) => new LazyTemplate(tpl).evaluate(data);

  it('string: null → 空文字', () => {
    expect(t('{{{v | string}}}', { v: null })).toBe('');
  });

  it('string: 数値 → 文字列', () => {
    expect(t('{{{v | string}}}', { v: 42 })).toBe('42');
  });

  it('boolean: truthy → "true"', () => {
    expect(t('{{{v | boolean}}}', { v: 1 })).toBe('true');
  });

  it('boolean: 0 → "false"', () => {
    expect(t('{{{v | boolean}}}', { v: 0 })).toBe('false');
  });

  it('default: null → 空文字', () => {
    expect(t('{{{v | default}}}', { v: null })).toBe('');
  });

  it('default: undefined → 空文字', () => {
    expect(t('{{{v | default}}}', {})).toBe('');
  });

  it('default: 有効な値はそのまま', () => {
    expect(t('{{{v | default}}}', { v: 'hello' })).toBe('hello');
  });

  it('json: オブジェクトをJSON化する', () => {
    expect(t('{{{v | json}}}', { v: { a: 1 } })).toBe('{"a":1}');
  });

  it('jsonPretty: オブジェクトを整形JSONにする', () => {
    const result = t('{{{v | jsonPretty}}}', { v: { a: 1 } });
    expect(result).toContain('\n');
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });
});

// ============================================================================
// registerFilter
// ============================================================================

describe('LazyTemplate.registerFilter', () => {
  it('フィルターを登録して使える', () => {
    const t = new LazyTemplate('{{{price | jpy}}}');
    t.registerFilter('jpy', v => `¥${v}`);
    expect(t.evaluate({ price: 1000 })).toBe('¥1000');
  });

  it('名前が空文字 → TypeError', () => {
    const t = new LazyTemplate('');
    expect(() => t.registerFilter('', v => v)).toThrow(TypeError);
  });

  it('fn が関数以外 → TypeError', () => {
    const t = new LazyTemplate('');
    expect(() => t.registerFilter('fn', 'not a function' as unknown as () => void)).toThrow(TypeError);
  });

  it('カスタムフィルターはプリミティブフィルターを上書きできる', () => {
    const t = new LazyTemplate('{{{v | upper}}}');
    t.registerFilter('upper', v => `custom:${v}`);
    expect(t.evaluate({ v: 'hello' })).toBe('custom:hello');
  });

  it('evaluate 後に registerFilter で上書きしても新フィルターが適用される', () => {
    const t = new LazyTemplate('{{{value | myFilter}}}');
    t.registerFilter('myFilter', v => `v1:${v}`);
    expect(t.evaluate({ value: 'x' })).toBe('v1:x');
    // キャッシュ済みでも新フィルターが適用される
    t.registerFilter('myFilter', v => `v2:${v}`);
    expect(t.evaluate({ value: 'x' })).toBe('v2:x');
  });
});

// ============================================================================
// compile — キャッシュ
// ============================================================================

describe('LazyTemplate.compile — キャッシュ', () => {
  it('同じ式は同じ関数オブジェクトを返す', () => {
    const t = new LazyTemplate('{{{name}}}');
    const fn1 = t.compile('name');
    const fn2 = t.compile('name');
    expect(fn1).toBe(fn2);
  });

  it('空白を正規化してキャッシュキーにする', () => {
    const t = new LazyTemplate('{{{name}}}');
    const fn1 = t.compile('name  |  upper');
    const fn2 = t.compile('name | upper');
    expect(fn1).toBe(fn2);
  });
});

// ============================================================================
// static evaluate
// ============================================================================

describe('LazyTemplate.evaluate — 静的メソッド', () => {
  it('ワンショット評価ができる', () => {
    expect(LazyTemplate.evaluate('Hello {{{name}}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('カスタムフィルターを渡せる', () => {
    expect(LazyTemplate.evaluate('{{{v | dbl}}}', { v: 5 }, { dbl: v => (v as number) * 2 })).toBe('10');
  });
});

// ============================================================================
// parseStringLiteral
// ============================================================================

describe('LazyTemplate.parseStringLiteral', () => {
  it.each([
    ['"hello"', 'hello'],
    ['"with \\"quotes\\""', 'with "quotes"'],
    ["'hello'", 'hello'],
    ["'with \\' apostrophe'", "with ' apostrophe"],
  ] as [string, string][])(
    '%s → "%s"',
    (input, expected) => {
      expect(LazyTemplate.parseStringLiteral(input)).toBe(expected);
    },
  );

  it('クォートなしは undefined を返す', () => {
    expect(LazyTemplate.parseStringLiteral('hello')).toBeUndefined();
  });
});

// ============================================================================
// 統合テスト — 実用パターン
// ============================================================================

describe('LazyTemplate — 統合テスト', () => {
  it('Slack通知テンプレート', () => {
    const t = new LazyTemplate(
      '*{{{title}}}*\n件数: {{{count || 0}}} 件\n担当: {{{assignee || "未割当"}}}',
    );
    expect(t.evaluate({ title: '障害報告', count: 3 })).toBe(
      '*障害報告*\n件数: 3 件\n担当: 未割当',
    );
  });

  it('繰り返しの evaluate はキャッシュが効く', () => {
    const t = new LazyTemplate('{{{name | upper}}} - {{{count | int}}}');
    const r1 = t.evaluate({ name: 'hello', count: 3.7 });
    const r2 = t.evaluate({ name: 'world', count: 1.2 });
    expect(r1).toBe('HELLO - 3');
    expect(r2).toBe('WORLD - 1');
  });

  it('複雑なネスト + フォールバック', () => {
    // || でtermを分割: ["user.profile.nickname", "user.name", '"名無し" | trim']
    // trim は最後の term ("名無し") にのみ適用される
    const t = new LazyTemplate('{{{user.profile.nickname || user.name || "名無し" | trim}}}');
    expect(t.evaluate({ user: { name: '  Alice  ' } })).toBe('  Alice  ');
    expect(t.evaluate({ user: { profile: { nickname: 'AK' } } })).toBe('AK');
    expect(t.evaluate({ user: {} })).toBe('名無し');
  });

  it('フィルターを全termに適用する場合は最外でチェーンする', () => {
    // フォールバック全体にフィルターを適用したい場合は式全体をネストする必要がある
    // 例: {{{name | trim}}} と {{{fallback | trim}}} を別個に書くか、
    //     trim フィルターをコンストラクタ引数で渡した後 registerFilter で使う
    const t = new LazyTemplate('{{{name | trim}}}');
    expect(t.evaluate({ name: '  Alice  ' })).toBe('Alice');
  });
});
