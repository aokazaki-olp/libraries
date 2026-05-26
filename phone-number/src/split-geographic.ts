/**
 * split-geographic.ts
 * @description 地域電気通信番号を市外局番・加入者番号に分割し、地域名を付与する
 */

import type { PhoneParts } from './types.js';
import { NDC_MAP } from './data/ndc.js';

export interface GeoResult {
  parts:  PhoneParts;
  region: string | undefined;
}

// 試行する NDC 長（先頭0を含む桁数）の昇順リスト
const NDC_LENGTHS = [2, 3, 4, 5] as const;

/**
 * 地域電気通信番号（10桁、先頭0付き）を市外局番と加入者番号に分割する
 *
 * @param national - 先頭0付き10桁の国内番号（例: "0312345678"）
 * @returns 分割結果。NDC が辞書に存在しない場合も parts は返り、region のみ undefined になる
 */
export const splitGeographic = (national: string): GeoResult | null => {
  if (national.length !== 10 || !national.startsWith('0')) {
    return null;
  }

  for (const ndcLen of NDC_LENGTHS) {
    const candidate = national.slice(0, ndcLen);
    if (NDC_MAP[candidate] !== undefined || isKnownNdcLength(national, ndcLen)) {
      return {
        parts:  { ndc: candidate, subscriber: national.slice(ndcLen) },
        region: NDC_MAP[candidate],
      };
    }
  }

  // NDC が辞書にない場合: 2桁で分割しておく（フォールバック）
  return {
    parts:  { ndc: national.slice(0, 2), subscriber: national.slice(2) },
    region: undefined,
  };
};

// NDC_MAP にヒットしなくても、既知の NDC 長構造から分割可能かを判断する
// 現行番号計画では 2桁NDC は 03/06 のみ確定しているため、
// 辞書ヒットのみで十分。このフックは将来の拡張用。
const isKnownNdcLength = (_national: string, _ndcLen: number): boolean => false;
