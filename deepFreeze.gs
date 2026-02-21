'use strict';

/**
 * deepFreeze.gs
 *
 * @description オブジェクトの再帰的凍結ユーティリティ。
 *              グローバル関数 deepFreeze を宣言する。
 *
 *              コピペで他プロジェクトに混入する場合は、
 *              このファイルの deepFreeze 関数をそのまま貼り付ける。
 *
 */

/**
 * ネストされたオブジェクトも含めて再帰的に凍結する。
 *
 * - Reflect.ownKeys により文字列キー・Symbol キーの両方を走査する
 * - 既に凍結済みのオブジェクトはスキップする（循環参照対策）
 * - Map/Set 等の内部スロットは Object.freeze の仕様上保護されない
 *
 * @param {Object} o 凍結するオブジェクト
 * @returns {Object} 凍結されたオブジェクト（引数と同一参照）
 * @throws {TypeError} o がオブジェクト以外の場合
 */
function deepFreeze(o) {
  if (!o || typeof o !== 'object') {
    throw new TypeError('o にはオブジェクトを指定してください');
  }

  Object.freeze(o);

  for (const k of Reflect.ownKeys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }

  return o;
}
