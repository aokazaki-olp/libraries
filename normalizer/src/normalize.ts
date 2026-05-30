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

const toMatchKey = (name: string): string => name.toUpperCase();

const toMatchKeyKanji = (
  name: string,
  variantMap: Map<string, string>,
): string => applyVariantMap(name, variantMap).toUpperCase();

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
      : { legalName: null, kind: null, legalPosition: 'none' as const, name: preNormed, ambiguous: false };

    const { legalName, kind, legalPosition, name, ambiguous } = legal;

    // normalized: 略称を正式名称に展開し、前後位置は元のまま保持
    const normalized = legalName !== null
      ? legalPosition === 'post'
        ? name + legalName
        : legalName + name
      : preNormed;

    // [4] matchKey 生成
    const matchKey      = toMatchKey(name);
    const matchKeyKanji = toMatchKeyKanji(name, variantMap);

    return {
      raw,
      normalized,
      name,
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
