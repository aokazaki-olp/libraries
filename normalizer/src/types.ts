/**
 * types.ts
 * @description 正規化ライブラリの共通型定義
 */

/** 法人格の位置 */
export type LegalPosition = 'pre' | 'post' | 'both' | 'none';

/** normalize() の戻り値 */
export interface NormalizeResult {
  raw: string;
  canonical: string;
  name: string;
  legalName: string | null;
  legalPosition: LegalPosition | null;
  kind: string | null;
  matchKey: string;
  matchKeyKanji: string;
  ambiguous: boolean;
  kana?: string;
  kanaMatchKey?: string;
}

/** 読み仮名正規化オプション */
export interface KanaOptions {
  /** デフォルト: 'katakana' */
  kanaMode?: 'katakana' | 'hiragana';
  /**
   * 有効文字に追加する正規表現文字クラス文字列
   * [^ぁ-ゖァ-ヶー\s<allowCharClass>] の <allowCharClass> 部分
   * 例: '\\-=゠・'  '0-9A-Z'
   */
  allowCharClass?: string;
}

export type { WidthMode, ClassWidthConfig } from './width.js';

/** フィールド個別の幅設定 */
export interface FieldWidthConfig {
  classWidth?: import('./width.js').ClassWidthConfig;
}

/** Normalizer.create() のオプション */
export interface NormalizerOptions {
  /** character_variants.db の絶対パス。未指定時は字体正規化をスキップ */
  dbPath?: string;
  /** 文字クラス別の幅設定（グローバルデフォルト） */
  classWidth?: import('./width.js').ClassWidthConfig;
  /** フィールド個別の幅設定（グローバルより優先） */
  fields?: {
    canonical?: FieldWidthConfig;
    matchKey?: FieldWidthConfig;
  };
  /** 読み仮名正規化オプション */
  kana?: KanaOptions;
}
