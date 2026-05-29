/**
 * variantMap.ts
 * @description [2] 字体正規化: character_variants.db から variant → canonical の Map を生成する
 */

import { DatabaseSync } from 'node:sqlite';

interface VariantRow {
  variant: string;
  canonical: string;
}

/**
 * character_variants.db を読み込み、字体正規化 Map を返す
 * 起動時に1回だけ呼び出し、返却した Map をキャッシュして使う
 *
 * @param dbPath - character_variants.db の絶対パス
 * @returns variant → canonical の Map
 * @throws {Error} DB ファイルが開けない場合
 */
export const loadVariantMap = (dbPath: string): Map<string, string> => {
  if (typeof dbPath !== 'string' || dbPath === '') {
    throw new TypeError('dbPath には空でない文字列を指定してください');
  }

  const db = new DatabaseSync(dbPath);
  const rows = db
    .prepare('SELECT variant, canonical FROM character_variants')
    .all() as VariantRow[];
  db.close();

  return new Map(rows.map(r => [r.variant, r.canonical]));
};

/**
 * 文字列の各文字に variant Map を適用して通用字体に変換する
 *
 * @param text - 変換対象文字列
 * @param variantMap - loadVariantMap() が返す Map
 * @returns 通用字体に変換した文字列
 */
export const applyVariantMap = (
  text: string,
  variantMap: Map<string, string>,
): string => {
  let result = '';
  for (const char of text) {
    result += variantMap.get(char) ?? char;
  }
  return result;
};
