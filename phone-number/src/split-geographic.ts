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
    if (NDC_MAP[candidate] !== undefined) {
      return {
        parts:  { ndc: candidate, subscriber: national.slice(ndcLen) },
        region: NDC_MAP[candidate],
      };
    }
  }

  // NDC が辞書にない場合: 分割根拠がないため null を返す（region も parts も undefined）
  return null;
};
