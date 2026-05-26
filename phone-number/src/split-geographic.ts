/**
 * split-geographic.ts
 * @description 地域電気通信番号を市外局番・市内局番・加入者番号に分割し、地域名を付与する
 */

import type { PhoneParts } from './types.js';
import { NDC_MAP } from './data/ndc.js';

export interface GeoResult {
  parts:  PhoneParts;
  region: string | undefined;
}

// 試行する NDC 長（先頭0を含む桁数）の昇順リスト
const NDC_LENGTHS = [2, 3, 4, 5] as const;

// 地域電気通信番号の総桁数・加入者番号桁数は番号計画で固定
const TOTAL_LEN      = 10 as const;
const SUBSCRIBER_LEN =  4 as const;

/**
 * 地域電気通信番号（10桁、先頭0付き）を市外局番・市内局番・加入者番号に分割する
 *
 * local の桁数は `10 - ndc長 - 4` で導出するため追加辞書は不要。
 *
 * @param national - 先頭0付き10桁の国内番号（例: "0312345678"）
 * @returns 分割結果。NDC が辞書に存在しない場合は null
 */
export const splitGeographic = (national: string): GeoResult | null => {
  if (national.length !== TOTAL_LEN || !national.startsWith('0')) {
    return null;
  }

  for (const ndcLen of NDC_LENGTHS) {
    const ndc = national.slice(0, ndcLen);
    if (NDC_MAP[ndc] !== undefined) {
      const localLen = TOTAL_LEN - ndcLen - SUBSCRIBER_LEN;
      return {
        parts: {
          ndc,
          local:      national.slice(ndcLen, ndcLen + localLen),
          subscriber: national.slice(ndcLen + localLen),
        },
        region: NDC_MAP[ndc],
      };
    }
  }

  // NDC が辞書にない場合: 分割根拠がないため null を返す
  return null;
};
