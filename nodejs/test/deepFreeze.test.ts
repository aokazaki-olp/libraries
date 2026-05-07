import { describe, it, expect } from 'vitest';
import { deepFreeze } from '../src/deepFreeze.js';

describe('deepFreeze — 型チェック', () => {
  it('非オブジェクト(文字列)を渡すと TypeError', () => {
    expect(() => deepFreeze('string' as unknown as object)).toThrow(TypeError);
  });

  it('null を渡すと TypeError', () => {
    expect(() => deepFreeze(null as unknown as object)).toThrow(TypeError);
  });

  it('数値を渡すと TypeError', () => {
    expect(() => deepFreeze(42 as unknown as object)).toThrow(TypeError);
  });
});

describe('deepFreeze — 基本動作', () => {
  it('凍結後は同一参照を返す', () => {
    const obj = { a: 1 };
    const result = deepFreeze(obj);
    expect(result).toBe(obj);
  });

  it('凍結後のオブジェクトは Object.isFrozen が true', () => {
    const obj = { a: 1, b: 'hello' };
    deepFreeze(obj);
    expect(Object.isFrozen(obj)).toBe(true);
  });

  it('凍結後に strict mode でプロパティ変更しようとすると TypeError', () => {
    const obj = deepFreeze({ x: 1 });
    expect(() => {
      (obj as { x: number }).x = 99;
    }).toThrow(TypeError);
  });
});

describe('deepFreeze — ネスト', () => {
  it('ネストされたオブジェクトも凍結される', () => {
    const obj = { a: { b: { c: 1 } } };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
  });

  it('配列も凍結される', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.items)).toBe(true);
  });

  it('配列の要素オブジェクトも凍結される', () => {
    const obj = { items: [{ id: 1 }, { id: 2 }] };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.items[0])).toBe(true);
    expect(Object.isFrozen(obj.items[1])).toBe(true);
  });

  it('3階層以上のネストも全て凍結される', () => {
    const obj = { a: { b: { c: { d: 42 } } } };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.a.b.c)).toBe(true);
  });
});

describe('deepFreeze — 循環参照・既凍結', () => {
  it('既に凍結済みのオブジェクトはスキップする（無限ループにならない）', () => {
    const inner = Object.freeze({ x: 1 });
    const obj = { inner };
    expect(() => deepFreeze(obj)).not.toThrow();
    expect(Object.isFrozen(obj)).toBe(true);
  });

  it('Symbolキーのプロパティも凍結対象に含まれる（ownKeysで走査）', () => {
    const sym = Symbol('key');
    const inner = { value: 42 };
    const obj: Record<symbol, object> = {};
    obj[sym] = inner;
    deepFreeze(obj);
    expect(Object.isFrozen(inner)).toBe(true);
  });
});
