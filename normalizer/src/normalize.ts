/**
 * normalize.ts
 * @description 正規化オーケストレーション・Normalizer ファクトリ
 */

import { preNormalize } from './preNormalize.js';
import { loadVariantMap, applyVariantMap } from './variantMap.js';
import { extractLegalEntity } from './legalEntity.js';
import { resolveWidthConfig, applyWidth } from './width.js';
import type { NormalizeResult, NormalizeOptions, NormalizerOptions } from './types.js';

// ────────────────────────────────────────────────────
// Normalizer インスタンス型
// ────────────────────────────────────────────────────

export interface NormalizerInstance {
  /**
   * 文字列を正規化して NormalizeResult を返す
   *
   * @param raw - 正規化前の文字列
   * @param options - エンティティ種別等のオプション
   * @returns 正規化結果
   * @throws {TypeError} raw が文字列でない場合
   */
  normalize(raw: string, options?: NormalizeOptions): NormalizeResult;
}

// ────────────────────────────────────────────────────
// ファクトリ
// ────────────────────────────────────────────────────

/**
 * Normalizer インスタンスを生成する
 *
 * @param options - dbPath・classWidth・fields を指定可能
 * @returns NormalizerInstance
 * @throws {TypeError} dbPath が空文字の場合
 */
const create = (options: NormalizerOptions = {}): NormalizerInstance => {
  const { dbPath, classWidth = {}, fields = {} } = options;

  if (dbPath !== undefined && (typeof dbPath !== 'string' || dbPath === '')) {
    throw new TypeError('dbPath には空でない文字列を指定してください');
  }

  const variantMap: Map<string, string> = dbPath !== undefined
    ? loadVariantMap(dbPath)
    : new Map();

  const canonicalWidthCfg = resolveWidthConfig(classWidth, fields.canonical?.classWidth);
  const matchKeyWidthCfg  = resolveWidthConfig(classWidth, fields.matchKey?.classWidth);

  const normalize = (raw: string, opts: NormalizeOptions = {}): NormalizeResult => {
    if (typeof raw !== 'string') {
      throw new TypeError('raw には文字列を指定してください');
    }

    const { type = 'corporate' } = opts;

    // [1] 基礎正規化
    const preNormed = preNormalize(raw);

    // [3] 法人格正規化（corporate のみ）
    const legal = type === 'corporate'
      ? extractLegalEntity(preNormed)
      : { legalName: null, kind: null, legalPosition: 'none' as const, name: preNormed, ambiguous: false };

    const { legalName, kind, legalPosition, name, ambiguous } = legal;

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

    return {
      raw,
      canonical,
      name: nameOut,
      legalName: legalNameOut,
      legalPosition: legalPosition === 'none' ? 'none' : legalPosition,
      kind,
      matchKey,
      matchKeyKanji,
      ambiguous,
    };
  };

  return { normalize };
};

export const Normalizer = { create } as const;
