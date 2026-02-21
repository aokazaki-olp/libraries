'use strict';

/**
 * deepFreeze.test.gs
 *
 * @description deepFreeze.gs のテストスイート（エッジケース含む網羅的テスト）
 */

// ============================================================================
// deepFreeze テスト
// ============================================================================

const runDeepFreezeTests = () => {
  const { suite, test, assertEqual, assertTrue, assertFalse, assertThrows, assertDeepEqual } = TestRunner;

  // ─── 基本動作 ─────────────────────────────────────────────────────

  suite('deepFreeze 基本動作');

  test('フラットオブジェクトを凍結する', () => {
    const obj = { a: 1, b: 'hello' };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
  });

  test('凍結されたオブジェクトを返す（戻り値が同一参照）', () => {
    const obj = { x: 10 };
    const result = deepFreeze(obj);
    assertTrue(result === obj, '戻り値が元のオブジェクトと同一参照であること');
    assertTrue(Object.isFrozen(result));
  });

  test('空オブジェクトを凍結する', () => {
    const obj = {};
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
  });

  test('既にfrozenなオブジェクトを渡してもエラーにならない', () => {
    const obj = Object.freeze({ x: 1 });
    const result = deepFreeze(obj);
    assertTrue(Object.isFrozen(result));
    assertTrue(result === obj);
  });

  // ─── ネスト走査 ───────────────────────────────────────────────────

  suite('deepFreeze ネスト走査');

  test('2層ネストオブジェクトを凍結する', () => {
    const obj = { a: { b: 1 } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertTrue(Object.isFrozen(obj.a));
  });

  test('3層ネストオブジェクトを凍結する', () => {
    const obj = { a: { b: { c: 1 } } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.a.b));
  });

  test('5層の深いネストを凍結する', () => {
    const obj = { l1: { l2: { l3: { l4: { l5: { val: 42 } } } } } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.l1.l2.l3.l4.l5));
  });

  test('兄弟オブジェクトプロパティを全て凍結する', () => {
    const obj = { a: { x: 1 }, b: { y: 2 }, c: { z: 3 } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.a));
    assertTrue(Object.isFrozen(obj.b));
    assertTrue(Object.isFrozen(obj.c));
  });

  test('既にfrozenなネストプロパティはスキップしてエラーにならない', () => {
    const inner = Object.freeze({ x: 1 });
    const obj = { frozen: inner, notFrozen: { y: 2 } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.frozen));
    assertTrue(Object.isFrozen(obj.notFrozen));
  });

  test('同一オブジェクト参照が複数プロパティにあってもエラーにならない', () => {
    const shared = { val: 1 };
    const obj = { a: shared, b: shared };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(shared));
    assertTrue(obj.a === obj.b, '同一参照が保持される');
  });

  test('nullプロパティを含むオブジェクトを凍結できる', () => {
    const obj = { a: null, b: 1 };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertEqual(obj.a, null);
  });

  test('undefinedプロパティを含むオブジェクトを凍結できる', () => {
    const obj = { a: undefined, b: 1 };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertEqual(obj.a, undefined);
  });

  test('プリミティブ値プロパティ（数値/文字列/boolean）は再帰対象外で正常', () => {
    const obj = { num: 42, str: 'hello', bool: true, nil: null, undef: undefined };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertEqual(obj.num, 42);
    assertEqual(obj.str, 'hello');
    assertEqual(obj.bool, true);
  });

  // ─── イミュータブル性検証 ─────────────────────────────────────────

  suite('deepFreeze イミュータブル性');

  test('凍結後トップレベルプロパティの変更が無効', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    obj.a = 999;
    assertEqual(obj.a, 1, '値が変わっていないこと');
  });

  test('凍結後ネストプロパティの変更が無効', () => {
    const obj = { nested: { val: 'original' } };
    deepFreeze(obj);
    obj.nested.val = 'changed';
    assertEqual(obj.nested.val, 'original');
  });

  test('凍結後3層目のプロパティ変更が無効', () => {
    const obj = { a: { b: { c: 'deep' } } };
    deepFreeze(obj);
    obj.a.b.c = 'modified';
    assertEqual(obj.a.b.c, 'deep');
  });

  test('凍結後に新しいプロパティを追加できない', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    obj.newProp = 'value';
    assertTrue(obj.newProp === undefined);
  });

  test('凍結後にネストオブジェクトへ新プロパティを追加できない', () => {
    const obj = { nested: { a: 1 } };
    deepFreeze(obj);
    obj.nested.b = 2;
    assertTrue(obj.nested.b === undefined);
  });

  test('凍結後にプロパティを削除できない', () => {
    const obj = { a: 1, b: 2 };
    deepFreeze(obj);
    delete obj.a;
    assertEqual(obj.a, 1);
  });

  test('凍結後にネストプロパティを削除できない', () => {
    const obj = { nested: { x: 1, y: 2 } };
    deepFreeze(obj);
    delete obj.nested.x;
    assertEqual(obj.nested.x, 1);
  });

  test('凍結後にオブジェクト自体の置き換えはトップレベルでは無効', () => {
    const obj = { nested: { val: 1 } };
    deepFreeze(obj);
    obj.nested = { val: 999 };
    assertEqual(obj.nested.val, 1);
  });

  // ─── 配列の凍結 ────────────────────────────────────────────────────

  suite('deepFreeze 配列');

  test('配列を含むオブジェクトの配列も凍結する', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.items));
  });

  test('配列内のオブジェクトも再帰的に凍結する', () => {
    const obj = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.items[0]));
    assertTrue(Object.isFrozen(obj.items[1]));
  });

  test('空配列を凍結できる', () => {
    const obj = { items: [] };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.items));
  });

  test('ネストされた配列内の配列も凍結する', () => {
    const obj = { matrix: [[1, 2], [3, 4]] };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.matrix[0]));
    assertTrue(Object.isFrozen(obj.matrix[1]));
  });

  test('凍結後に配列要素の変更が無効', () => {
    const obj = { items: [10, 20, 30] };
    deepFreeze(obj);
    obj.items[0] = 999;
    assertEqual(obj.items[0], 10);
  });

  test('凍結後に配列のpushが無効（lengthが変わらない）', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    try { obj.items.push(4); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items.length, 3);
  });

  test('凍結後に配列のpopが無効（lengthが変わらない）', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    try { obj.items.pop(); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items.length, 3);
  });

  test('凍結後に配列のspliceが無効', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    try { obj.items.splice(0, 1); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items.length, 3);
    assertEqual(obj.items[0], 1);
  });

  test('凍結後に配列のsortが無効（元の順序が保持される）', () => {
    const obj = { items: [3, 1, 2] };
    deepFreeze(obj);
    try { obj.items.sort(); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items[0], 3);
    assertEqual(obj.items[1], 1);
    assertEqual(obj.items[2], 2);
  });

  test('凍結後に配列のreverseが無効', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    try { obj.items.reverse(); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items[0], 1);
    assertEqual(obj.items[2], 3);
  });

  test('凍結後に配列のfillが無効', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    try { obj.items.fill(0); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items[0], 1);
  });

  test('凍結後に配列のunshiftが無効', () => {
    const obj = { items: [1, 2] };
    deepFreeze(obj);
    try { obj.items.unshift(0); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items.length, 2);
    assertEqual(obj.items[0], 1);
  });

  test('凍結後にcopyWithinが無効', () => {
    const obj = { items: [1, 2, 3, 4] };
    deepFreeze(obj);
    try { obj.items.copyWithin(0, 2); } catch (e) { /* strict mode ではTypeError */ }
    assertEqual(obj.items[0], 1);
    assertEqual(obj.items[1], 2);
  });

  test('配列内オブジェクトのプロパティ変更が無効', () => {
    const obj = { items: [{ name: 'Alice' }, { name: 'Bob' }] };
    deepFreeze(obj);
    obj.items[0].name = 'Charlie';
    assertEqual(obj.items[0].name, 'Alice');
  });

  test('スパース配列を含むオブジェクトを凍結できる', () => {
    const arr = [1, , 3];
    const obj = { sparse: arr };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.sparse));
    assertEqual(obj.sparse[0], 1);
    assertEqual(obj.sparse[2], 3);
  });

  // ─── 読み取り操作 ─────────────────────────────────────────────────

  suite('deepFreeze 読み取り操作');

  test('凍結後もObject.keysが正常に動作する', () => {
    const obj = { a: 1, b: 2, c: 3 };
    deepFreeze(obj);
    assertDeepEqual(Object.keys(obj).sort(), ['a', 'b', 'c']);
  });

  test('凍結後もObject.valuesが正常に動作する', () => {
    const obj = { a: 1, b: 2 };
    deepFreeze(obj);
    assertDeepEqual(Object.values(obj).sort(), [1, 2]);
  });

  test('凍結後もObject.entriesが正常に動作する', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    assertDeepEqual(Object.entries(obj), [['a', 1]]);
  });

  test('凍結後もfor...inループが正常に動作する', () => {
    const obj = { a: 1, b: 2 };
    deepFreeze(obj);
    const keys = [];
    for (const k in obj) keys.push(k);
    assertDeepEqual(keys.sort(), ['a', 'b']);
  });

  test('凍結後もJSON.stringifyが正常に動作する', () => {
    const obj = { a: 1, nested: { b: 2 } };
    deepFreeze(obj);
    const json = JSON.parse(JSON.stringify(obj));
    assertEqual(json.a, 1);
    assertEqual(json.nested.b, 2);
  });

  test('凍結後もスプレッド構文で浅いコピーが可能', () => {
    const obj = { a: 1, b: 2 };
    deepFreeze(obj);
    const copy = { ...obj, c: 3 };
    assertEqual(copy.a, 1);
    assertEqual(copy.c, 3);
    assertFalse(Object.isFrozen(copy), 'コピーは凍結されていない');
  });

  test('凍結後もin演算子で存在確認が可能', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    assertTrue('a' in obj);
    assertFalse('b' in obj);
  });

  test('凍結後もhasOwnPropertyが正常に動作する', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    assertTrue(obj.hasOwnProperty('a'));
    assertFalse(obj.hasOwnProperty('b'));
  });

  // ─── Object API との相互作用 ──────────────────────────────────────

  suite('deepFreeze Object API');

  test('Object.isFrozen が true を返す', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
  });

  test('Object.isSealed が true を返す（frozen ⊃ sealed）', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    assertTrue(Object.isSealed(obj));
  });

  test('Object.isExtensible が false を返す（frozen → not extensible）', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    assertFalse(Object.isExtensible(obj));
  });

  test('Object.getOwnPropertyDescriptor で writable: false を確認', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    const desc = Object.getOwnPropertyDescriptor(obj, 'a');
    assertFalse(desc.writable);
    assertFalse(desc.configurable);
  });

  test('Object.getOwnPropertyDescriptor でネストプロパティも writable: false', () => {
    const obj = { nested: { val: 1 } };
    deepFreeze(obj);
    const desc = Object.getOwnPropertyDescriptor(obj.nested, 'val');
    assertFalse(desc.writable);
    assertFalse(desc.configurable);
  });

  test('Object.assign で凍結オブジェクトへのコピーは失敗する', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    try { Object.assign(obj, { b: 2 }); } catch (e) { /* TypeError expected */ }
    assertTrue(obj.b === undefined, 'プロパティが追加されていないこと');
  });

  test('Object.defineProperty で凍結オブジェクトへの定義は失敗する', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    let threw = false;
    try { Object.defineProperty(obj, 'b', { value: 2 }); } catch (e) { threw = true; }
    assertTrue(threw, 'definePropertyがTypeErrorをスローすること');
  });

  test('Object.defineProperty で既存プロパティの再定義は失敗する', () => {
    const obj = { a: 1 };
    deepFreeze(obj);
    let threw = false;
    try { Object.defineProperty(obj, 'a', { value: 999 }); } catch (e) { threw = true; }
    assertTrue(threw, 'definePropertyがTypeErrorをスローすること');
    assertEqual(obj.a, 1);
  });

  // ─── non-enumerable プロパティ ────────────────────────────────────

  suite('deepFreeze non-enumerable プロパティ');

  test('non-enumerable プロパティも凍結する（Reflect.ownKeys使用のため）', () => {
    const obj = {};
    Object.defineProperty(obj, 'hidden', { value: { secret: 42 }, enumerable: false, writable: true, configurable: true });
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.hidden), 'non-enumerable のネストオブジェクトも凍結されること');
  });

  test('non-enumerable プロパティのネスト値も変更不可', () => {
    const obj = {};
    Object.defineProperty(obj, 'hidden', { value: { secret: 42 }, enumerable: false, writable: true, configurable: true });
    deepFreeze(obj);
    obj.hidden.secret = 999;
    assertEqual(obj.hidden.secret, 42);
  });

  // ─── Symbol キープロパティ ────────────────────────────────────────

  suite('deepFreeze Symbol キー');

  test('Symbolキーのネストオブジェクトも凍結する', () => {
    const sym = Symbol('key');
    const obj = { [sym]: { nested: true } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj[sym]), 'Symbolキーのネストオブジェクトも凍結されること');
  });

  test('Symbolキーのネスト値が変更不可', () => {
    const sym = Symbol('data');
    const obj = { [sym]: { val: 'original' } };
    deepFreeze(obj);
    obj[sym].val = 'changed';
    assertEqual(obj[sym].val, 'original', 'Symbolキーのネスト値も不変であること');
  });

  test('複数のSymbolキーを持つオブジェクトのネストも凍結する', () => {
    const sym1 = Symbol('first');
    const sym2 = Symbol('second');
    const obj = { [sym1]: { a: 1 }, [sym2]: { b: 2 } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj[sym1]), 'sym1のネストも凍結されること');
    assertTrue(Object.isFrozen(obj[sym2]), 'sym2のネストも凍結されること');
  });

  test('文字列キーとSymbolキーが混在するオブジェクトを凍結する', () => {
    const sym = Symbol('mixed');
    const obj = { strKey: { a: 1 }, [sym]: { b: 2 } };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.strKey));
    assertTrue(Object.isFrozen(obj[sym]));
  });

  // ─── 特殊オブジェクト ─────────────────────────────────────────────

  suite('deepFreeze 特殊オブジェクト');

  test('Dateオブジェクトを含むオブジェクトを凍結できる', () => {
    const obj = { created: new Date('2026-01-15') };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertTrue(Object.isFrozen(obj.created));
  });

  test('RegExpオブジェクトを含むオブジェクトを凍結できる', () => {
    const obj = { pattern: /test/gi };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertTrue(Object.isFrozen(obj.pattern));
  });

  test('Mapオブジェクトを含む場合Object.isFrozenはtrueだが内部状態は変更可能（freezeの限界）', () => {
    const map = new Map([['key', 'val']]);
    const obj = { m: map };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.m), 'Map自体はfrozenになる');
    // ただしMap.set()は内部スロットを操作するため、Object.freezeでは防げない
    obj.m.set('new', 'value');
    assertTrue(obj.m.has('new'), 'Mapの内部状態はfreezeで保護されない（仕様上の限界）');
  });

  test('Setオブジェクトを含む場合Object.isFrozenはtrueだが内部状態は変更可能（freezeの限界）', () => {
    const set = new Set([1, 2, 3]);
    const obj = { s: set };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj.s), 'Set自体はfrozenになる');
    obj.s.add(4);
    assertTrue(obj.s.has(4), 'Setの内部状態はfreezeで保護されない（仕様上の限界）');
  });

  // ─── 関数の扱い ───────────────────────────────────────────────────

  suite('deepFreeze 関数の扱い');

  test('関数を引数に渡すと TypeError をスローする（typeof === "function"）', () => {
    assertThrows(() => deepFreeze(() => {}), 'o にはオブジェクトを指定してください');
  });

  test('名前付き関数を引数に渡すと TypeError をスローする', () => {
    assertThrows(() => deepFreeze(function namedFn() {}), 'o にはオブジェクトを指定してください');
  });

  test('オブジェクト内の関数プロパティは凍結走査の対象外（typeof !== "object"）', () => {
    const obj = { fn: () => 'hello', val: 1 };
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    // 関数プロパティ自体は再帰的にdeepFreezeされない（typeof === 'function'）が、
    // Object.freeze(obj) によりプロパティの参照は変更不可
    assertEqual(typeof obj.fn, 'function');
    assertEqual(obj.fn(), 'hello');
  });

  // ─── 異常系 ────────────────────────────────────────────────────────

  suite('deepFreeze 異常系（プリミティブ引数）');

  test('null で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(null), 'o にはオブジェクトを指定してください');
  });

  test('undefined で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(undefined), 'o にはオブジェクトを指定してください');
  });

  test('数値 42 で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(42));
  });

  test('数値 0 で TypeError をスローする（falsyな数値）', () => {
    assertThrows(() => deepFreeze(0));
  });

  test('NaN で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(NaN));
  });

  test('Infinity で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(Infinity));
  });

  test('-Infinity で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(-Infinity));
  });

  test('文字列で TypeError をスローする', () => {
    assertThrows(() => deepFreeze('string'));
  });

  test('空文字で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(''));
  });

  test('boolean true で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(true));
  });

  test('boolean false で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(false));
  });

  test('Symbol で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(Symbol('test')));
  });

  test('BigInt で TypeError をスローする', () => {
    assertThrows(() => deepFreeze(BigInt(42)));
  });

  // ─── エラーメッセージ検証 ─────────────────────────────────────────

  suite('deepFreeze エラーメッセージ');

  test('null のエラーメッセージが正しい', () => {
    assertThrows(() => deepFreeze(null), 'o にはオブジェクトを指定してください');
  });

  test('数値のエラーメッセージが正しい', () => {
    assertThrows(() => deepFreeze(42), 'o にはオブジェクトを指定してください');
  });

  // ─── 循環参照 ──────────────────────────────────────────────────────

  suite('deepFreeze 循環参照');

  test('自己参照オブジェクトを凍結できる（無限再帰にならない）', () => {
    const obj = { a: 1 };
    obj.self = obj;
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertTrue(obj.self === obj, '自己参照が保持される');
  });

  test('相互参照オブジェクトを凍結できる', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    a.ref = b;
    b.ref = a;
    deepFreeze(a);
    assertTrue(Object.isFrozen(a));
    assertTrue(Object.isFrozen(b));
    assertTrue(a.ref === b);
    assertTrue(b.ref === a);
  });

  test('深いネストの循環参照を凍結できる', () => {
    const root = { l1: { l2: { l3: {} } } };
    root.l1.l2.l3.back = root;
    deepFreeze(root);
    assertTrue(Object.isFrozen(root));
    assertTrue(Object.isFrozen(root.l1.l2.l3));
    assertTrue(root.l1.l2.l3.back === root);
  });

  // ─── 配列直接渡し ─────────────────────────────────────────────────

  suite('deepFreeze 配列直接渡し');

  test('配列を直接渡して凍結できる', () => {
    const arr = [1, 2, 3];
    const result = deepFreeze(arr);
    assertTrue(Object.isFrozen(arr));
    assertTrue(result === arr);
  });

  test('ネストオブジェクトを含む配列を直接渡して凍結できる', () => {
    const arr = [{ a: 1 }, { b: 2 }];
    deepFreeze(arr);
    assertTrue(Object.isFrozen(arr));
    assertTrue(Object.isFrozen(arr[0]));
    assertTrue(Object.isFrozen(arr[1]));
  });

  // ─── getter/setter プロパティ ──────────────────────────────────────

  suite('deepFreeze getter/setter');

  test('getterプロパティを持つオブジェクトを凍結できる', () => {
    const obj = { _val: 42 };
    Object.defineProperty(obj, 'computed', { get: () => obj._val * 2, enumerable: true, configurable: true });
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertEqual(obj.computed, 84, 'getter は凍結後も動作する');
  });

  test('setter付きアクセサプロパティは凍結後もsetterが動作する（freezeの限界）', () => {
    let stored = 0;
    const obj = {};
    Object.defineProperty(obj, 'val', { get: () => stored, set: (v) => { stored = v; }, enumerable: true, configurable: true });
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    // Object.freeze はアクセサプロパティを configurable: false にするが、
    // setter 自体は消去しない。setter 経由の外部状態変更は防げない（仕様上の限界）。
    obj.val = 42;
    assertEqual(stored, 42, 'setter 経由の書き込みは防げない（内部スロットと同様の限界）');
  });

  // ─── Object.create(null) ──────────────────────────────────────────

  suite('deepFreeze Object.create(null)');

  test('プロトタイプなしオブジェクトを凍結できる', () => {
    const obj = Object.create(null);
    obj.x = 1;
    obj.nested = Object.create(null);
    obj.nested.y = 2;
    deepFreeze(obj);
    assertTrue(Object.isFrozen(obj));
    assertTrue(Object.isFrozen(obj.nested));
  });

  // ─── 引数なし ──────────────────────────────────────────────────────

  suite('deepFreeze 引数なし');

  test('引数なしで TypeError をスローする', () => {
    assertThrows(() => deepFreeze(), 'o にはオブジェクトを指定してください');
  });
};


// ============================================================================
// メインテストランナー
// ============================================================================

function runAllDeepFreezeTests() {
  TestRunner.reset();

  console.log('Running deepFreeze tests...');
  runDeepFreezeTests();

  return TestRunner.run();
}
