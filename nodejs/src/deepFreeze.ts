/**
 * deepFreeze.ts
 *
 * @description オブジェクトの再帰的凍結ユーティリティ。
 */

/**
 * ネストされたオブジェクトも含めて再帰的に凍結する。
 *
 * - Reflect.ownKeys により文字列キー・Symbol キーの両方を走査する
 * - 一度たどったオブジェクトは再びたどらない（循環参照対策）
 * - Map/Set 等の内部スロットは Object.freeze の仕様上保護されない
 *
 * @param target - 凍結するオブジェクト
 * @returns 凍結されたオブジェクト（引数と同一参照）
 * @throws {TypeError} target がオブジェクトでも関数でもない場合（null・プリミティブ）
 */
const deepFreeze = <T extends object>(target: T): Readonly<T> => {
  // 公開 API の境界。型が object でも JS からは何でも渡りうる
  const value: unknown = target;
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('target にはオブジェクトを指定してください');
  }

  // 訪問済みは WeakSet で持つ（isFrozen で判定すると、浅く凍結済みの子の先が凍結されない）
  const visited = new WeakSet<object>();
  const freeze = (current: object): void => {
    visited.add(current);
    Object.freeze(current);
    for (const key of Reflect.ownKeys(current)) {
      const child: unknown = Reflect.get(current, key);
      if (
        (typeof child === 'object' || typeof child === 'function') &&
        child !== null &&
        !visited.has(child)
      ) {
        freeze(child);
      }
    }
  };
  freeze(target);

  return target;
};

export { deepFreeze };
