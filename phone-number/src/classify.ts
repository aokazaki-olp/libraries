/**
 * classify.ts
 * @description national 番号から番号計画エントリを返す
 */

import { GEOGRAPHIC_ENTRY, PREFIX_MAP, type PlanEntry } from './number-plan.js';

/**
 * national 番号の種別を判定する
 *
 * @param national - 先頭0付き10〜11桁の国内番号、または3桁特番（例: "0312345678", "110"）
 * @returns 該当するプランエントリ。未知の番号は null
 */
export const classify = (national: string): PlanEntry | null => {
  // 4桁プレフィックスを先にチェック（0120/0800/0570/0990/0180）
  const p4 = national.slice(0, 4);
  const hit4 = PREFIX_MAP.get(p4);
  if (hit4 !== undefined) {
    return hit4;
  }

  // 3桁プレフィックス（020/050/060/070/080/090 および 特番・緊急）
  const p3 = national.slice(0, 3);
  const hit3 = PREFIX_MAP.get(p3);
  if (hit3 !== undefined) {
    return hit3;
  }

  // 地域電気通信番号: 先頭0・合計10桁
  if (national.startsWith('0') && national.length === 10) {
    return GEOGRAPHIC_ENTRY;
  }

  return null;
};
