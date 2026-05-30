/**
 * normalize.ts
 * @description 正規化オーケストレーション・Normalizer ファクトリ
 */

import { preNormalize } from './preNormalize.js';
import { loadVariantMap, applyVariantMap } from './variantMap.js';
import { extractLegalEntity } from './legalEntity.js';
import { resolveWidthConfig, applyWidth } from './width.js';
import {
  hiraganaToKatakana,
  katakanaToHiragana,
  applySmallToLarge,
  buildKanaInvalidCharRe,
  validateAllowCharClass,
} from './kana.js';
import type { NormalizeResult, NormalizerOptions, ClassWidthConfig, KanaOptions } from './types.js';

// 日本語システム標準: 英数半角・記号全角
const JP_DEFAULT_CLASS_WIDTH: ClassWidthConfig = {
  digit: 'half', alpha: 'half', symbol: 'full', default: 'half',
};

// ────────────────────────────────────────────────────
// Normalizer インスタンス型
// ────────────────────────────────────────────────────

export interface NormalizerInstance {
  /**
   * 文字列を正規化して NormalizeResult を返す
   *
   * @param raw - 正規化対象。name は必須、kana は任意
   * @returns 正規化結果
   * @throws {TypeError} raw が不正な場合
   */
  normalize(raw: { name: string; kana?: string }): NormalizeResult;
}

// ────────────────────────────────────────────────────
// kana 処理
// ────────────────────────────────────────────────────

const processKana = (
  rawKana: string,
  opts: KanaOptions,
  invalidRe: RegExp,
): { kana: string; kanaMatchKey: string } => {
  const { kanaMode = 'katakana' } = opts;

  // K-1: NFKC 基礎正規化
  const s = preNormalize(rawKana);

  // 法人格抽出（best-effort）
  const legal = extractLegalEntity(s);

  // kanaRaw 組み立て
  let kanaRaw: string;
  if (legal.legalName !== null && legal.kanaLegalName !== null && !legal.ambiguous) {
    const kanaName = legal.name;
    kanaRaw = legal.legalPosition === 'post'
      ? kanaName + legal.kanaLegalName
      : legal.kanaLegalName + kanaName;
  } else {
    kanaRaw = s;
  }

  // K-4: かな変換
  const convertKana = kanaMode === 'katakana' ? hiraganaToKatakana : katakanaToHiragana;
  const kanaConverted = convertKana(kanaRaw);

  // kana (canonical): 無効文字 → 空白置換、連続空白 → 1つ、trim
  // invalidRe は毎回 lastIndex がリセットされるよう再生成が必要（グローバルフラグ）
  const kana = kanaConverted
    .replace(buildKanaInvalidCharRe(opts.allowCharClass ?? ''), ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  // kanaMatchKey: K-3（小書き→通常）+ かな文字のみ残す
  const matchStr = applySmallToLarge(kanaConverted);
  const kanaMatchKey = kanaMode === 'katakana'
    ? matchStr.replace(/[^ァ-ヶー]/g, '')
    : matchStr.replace(/[^ぁ-ゖー]/g, '');

  return { kana, kanaMatchKey };
};

// ────────────────────────────────────────────────────
// ファクトリ
// ────────────────────────────────────────────────────

/**
 * Normalizer インスタンスを生成する
 *
 * @param options - dbPath・classWidth・fields・kana を指定可能
 * @returns NormalizerInstance
 * @throws {TypeError} オプションが不正な場合
 */
const create = (options: NormalizerOptions = {}): NormalizerInstance => {
  const { dbPath, classWidth = {}, fields = {}, kana: kanaOpts = {} } = options;

  if (dbPath !== undefined && (typeof dbPath !== 'string' || dbPath === '')) {
    throw new TypeError('dbPath には空でない文字列を指定してください');
  }

  validateAllowCharClass(kanaOpts.allowCharClass);

  const variantMap: Map<string, string> = dbPath !== undefined
    ? loadVariantMap(dbPath)
    : new Map();

  // JP 標準をベースにユーザー指定をマージ
  const effectiveGlobal: ClassWidthConfig = { ...JP_DEFAULT_CLASS_WIDTH, ...classWidth };
  const canonicalWidthCfg = resolveWidthConfig(effectiveGlobal, fields.canonical?.classWidth);
  const matchKeyWidthCfg  = resolveWidthConfig(effectiveGlobal, fields.matchKey?.classWidth);

  // kana 用の invalidRe（allowCharClass バリデーション済み）
  const kanaInvalidRe = buildKanaInvalidCharRe(kanaOpts.allowCharClass ?? '');

  const normalize = (raw: { name: string; kana?: string }): NormalizeResult => {
    if (typeof raw !== 'object' || raw === null) {
      throw new TypeError('raw には { name: string } オブジェクトを指定してください');
    }
    if (typeof raw.name !== 'string') {
      throw new TypeError('raw.name には文字列を指定してください');
    }

    const { name: rawName, kana: rawKana } = raw;

    // [1] 基礎正規化
    const preNormed = preNormalize(rawName);

    // [3] 法人格正規化
    const legal = extractLegalEntity(preNormed);

    const { legalName, kanaLegalName: _kanaLegalName, kind, legalPosition, name, ambiguous } = legal;

    // canonical: 略称を正式名称に展開し、前後位置は元のまま保持
    const canonicalRaw = legalName !== null
      ? legalPosition === 'post'
        ? name + legalName
        : legalName + name
      : preNormed;

    // [4] matchKey 生成（幅変換前に uppercase）
    const matchKeyRaw      = name.toUpperCase();
    const matchKeyKanjiRaw = applyVariantMap(name, variantMap).toUpperCase();

    // [5] 幅変換
    const canonical      = applyWidth(canonicalRaw,      canonicalWidthCfg);
    const nameOut        = applyWidth(name,               canonicalWidthCfg);
    const legalNameOut   = legalName !== null ? applyWidth(legalName, canonicalWidthCfg) : null;
    const matchKey       = applyWidth(matchKeyRaw,        matchKeyWidthCfg);
    const matchKeyKanji  = applyWidth(matchKeyKanjiRaw,   matchKeyWidthCfg);

    // [6] kana 処理
    const kanaResult = rawKana !== undefined
      ? processKana(rawKana, kanaOpts, kanaInvalidRe)
      : undefined;

    return {
      raw: rawName,
      canonical,
      name: nameOut,
      legalName: legalNameOut,
      legalPosition: legalPosition === 'none' ? 'none' : legalPosition,
      kind,
      matchKey,
      matchKeyKanji,
      ambiguous,
      ...(kanaResult !== undefined ? { kana: kanaResult.kana, kanaMatchKey: kanaResult.kanaMatchKey } : {}),
    };
  };

  return { normalize };
};

export const Normalizer = { create } as const;
