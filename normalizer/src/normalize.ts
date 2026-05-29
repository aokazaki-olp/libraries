/**
 * normalize.ts
 * @description 正規化オーケストレーション・Normalizer ファクトリ
 */

import { preNormalize } from './preNormalize.js';
import { loadVariantMap, applyVariantMap } from './variantMap.js';
import { extractLegalEntity } from './legalEntity.js';
import type { NormalizeResult, NormalizeOptions, NormalizerOptions } from './types.js';

// ────────────────────────────────────────────────────
// matchKey 生成
// ────────────────────────────────────────────────────

/** baseName を大文字統一してマッチキーを生成する */
const toMatchKey = (baseName: string): string => baseName.toUpperCase();

/** baseName に字体正規化を適用してから大文字統一する */
const toMatchKeyKanji = (
  baseName: string,
  variantMap: Map<string, string>,
): string => applyVariantMap(baseName, variantMap).toUpperCase();

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
 * @param options - dbPath を指定すると字体正規化が有効になる
 * @returns NormalizerInstance
 * @throws {TypeError} dbPath が空文字の場合
 */
const create = (options: NormalizerOptions = {}): NormalizerInstance => {
  const { dbPath } = options;

  if (dbPath !== undefined && (typeof dbPath !== 'string' || dbPath === '')) {
    throw new TypeError('dbPath には空でない文字列を指定してください');
  }

  const variantMap: Map<string, string> = dbPath !== undefined
    ? loadVariantMap(dbPath)
    : new Map();

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
      : { legalName: null, kind: null, legalPosition: 'none' as const, baseName: preNormed, ambiguous: false };

    const { legalName, kind, legalPosition, baseName, ambiguous } = legal;

    // normalized: 表示用（法人格を前株に統一して再組み立て）
    const normalized = legalName !== null
      ? legalName + baseName
      : preNormed;

    // [4] matchKey 生成
    const matchKey      = toMatchKey(baseName);
    const matchKeyKanji = toMatchKeyKanji(baseName, variantMap);

    return {
      raw,
      normalized,
      baseName,
      legalName,
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
