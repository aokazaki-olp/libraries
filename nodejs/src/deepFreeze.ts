/**
 * deepFreeze.ts
 *
 * @description オブジェクトの再帰的凍結ユーティリティ。
 */

/**
 * ネストされたオブジェクトも含めて再帰的に凍結する。
 *
 * - Reflect.ownKeys により文字列キー・Symbol キーの両方を走査する
 * - 既に凍結済みのオブジェクトはスキップする（循環参照対策）
 * - Map/Set 等の内部スロットは Object.freeze の仕様上保護されない
 *
 * @param target - 凍結するオブジェクト
 * @returns 凍結されたオブジェクト（引数と同一参照）
 * @throws {TypeError} target がオブジェクトでない場合（null・プリミティブを含む）
 */
const deepFreeze = <T extends object>(target: T): Readonly<T> => {
  // 公開 API の境界。型が object でも JS からは何でも渡りうる
  const value: unknown = target;
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('target にはオブジェクトを指定してください');
  }

  Object.freeze(target);

  for (const key of Reflect.ownKeys(target)) {
    const v: unknown = Reflect.get(target, key);
    if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }

  return target;
};

export { deepFreeze };
