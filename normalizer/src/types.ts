/**
 * types.ts
 * @description 正規化ライブラリの共通型定義
 */

export type EntityType = 'corporate' | 'person' | 'organization';

/** 法人格の位置 */
export type LegalPosition = 'pre' | 'post' | 'both' | 'none';

/** normalize() の戻り値 */
export interface NormalizeResult {
  raw: string;
  normalized: string;
  name: string;
  legalName: string | null;
  legalPosition: LegalPosition | null;
  kind: string | null;
  matchKey: string;
  matchKeyKanji: string;
  ambiguous: boolean;
}

/** normalize() のオプション */
export interface NormalizeOptions {
  type?: EntityType;
}

/** Normalizer.create() のオプション */
export interface NormalizerOptions {
  /** character_variants.db の絶対パス。未指定時は字体正規化をスキップ */
  dbPath?: string;
}
