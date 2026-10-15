import { describe, it, expect } from 'vitest';
import { deepFreeze } from '../src/deepFreeze.ts';

describe('deepFreeze — 型チェック', () => {
  it('非オブジェクト(文字列)を渡すと TypeError', () => {
    // @ts-expect-error -- 実行時の検査を確かめるため型に反する値を渡す
    expect(() => deepFreeze('string')).toThrow(TypeError);
  });

  it('null を渡すと TypeError', () => {
    // @ts-expect-error -- 実行時の検査を確かめるため型に反する値を渡す
    expect(() => deepFreeze(null)).toThrow(TypeError);
  });

  it('数値を渡すと TypeError', () => {
    // @ts-expect-error -- 実行時の検査を確かめるため型に反する値を渡す
    expect(() => deepFreeze(42)).toThrow(TypeError);
  });
});

describe('deepFreeze — 基本動作', () => {
  it('凍結後は同一参照を返す', () => {
    const target = { a: 1 };
    const result = deepFreeze(target);
    expect(result).toBe(target);
  });

  it('凍結後のオブジェクトは Object.isFrozen が true', () => {
    const target = { a: 1, b: 'hello' };
    deepFreeze(target);
    expect(Object.isFrozen(target)).toBe(true);
  });

  it('凍結後に strict mode でプロパティ変更しようとすると TypeError', () => {
    const target = deepFreeze({ x: 1 });
    expect(() => {
      // @ts-expect-error: 凍結したオブジェクトへの代入が実行時に TypeError になることを確かめる
      target.x = 99;
    }).toThrow(TypeError);
  });
});

describe('deepFreeze — ネスト', () => {
  it('ネストされたオブジェクトも凍結される', () => {
    const target = { a: { b: { c: 1 } } };
    deepFreeze(target);
    expect(Object.isFrozen(target.a)).toBe(true);
    expect(Object.isFrozen(target.a.b)).toBe(true);
  });

  it('配列も凍結される', () => {
    const target = { items: [1, 2, 3] };
    deepFreeze(target);
    expect(Object.isFrozen(target.items)).toBe(true);
  });

  it('配列の要素オブジェクトも凍結される', () => {
    const target = { items: [{ id: 1 }, { id: 2 }] };
    deepFreeze(target);
    expect(Object.isFrozen(target.items[0])).toBe(true);
    expect(Object.isFrozen(target.items[1])).toBe(true);
  });

  it('3階層以上のネストも全て凍結される', () => {
    const target = { a: { b: { c: { d: 42 } } } };
    deepFreeze(target);
    expect(Object.isFrozen(target.a.b.c)).toBe(true);
  });
});

describe('deepFreeze — 循環参照・既凍結', () => {
  it('既に凍結済みのオブジェクトはスキップする（無限ループにならない）', () => {
    const inner = Object.freeze({ x: 1 });
    const target = { inner };
    expect(() => deepFreeze(target)).not.toThrow();
    expect(Object.isFrozen(target)).toBe(true);
  });

  it('Symbolキーのプロパティも凍結対象に含まれる（ownKeysで走査）', () => {
    const sym = Symbol('key');
    const inner = { value: 42 };
    const target: Record<symbol, object> = {};
    target[sym] = inner;
    deepFreeze(target);
    expect(Object.isFrozen(inner)).toBe(true);
  });
});
