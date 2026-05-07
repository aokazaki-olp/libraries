/**
 * deepFreeze.ts
 * @description オブジェクトの再帰的凍結ユーティリティ。
 */

/**
 * ネストされたオブジェクトも含めて再帰的に凍結する。
 *
 * - Reflect.ownKeys により文字列キー・Symbol キーの両方を走査する
 * - 既に凍結済みのオブジェクトはスキップする（循環参照対策）
 * - Map/Set 等の内部スロットは Object.freeze の仕様上保護されない
 *
 * @param o 凍結するオブジェクト
 * @returns 凍結されたオブジェクト（引数と同一参照）
 */
const deepFreeze = <T extends object>(o: T): Readonly<T> => {
  if (!o || typeof o !== 'object') {
    throw new TypeError('o にはオブジェクトを指定してください');
  }

  Object.freeze(o);

  for (const k of Reflect.ownKeys(o)) {
    const v = (o as Record<string | symbol, unknown>)[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      deepFreeze(v as object);
    }
  }

  return o as Readonly<T>;
};

export { deepFreeze };
