/**
 * sanitize.ts
 * @description libphonenumber-js ラッパー。入力正規化と E.164 変換のみを担う。
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export interface SanitizeResult {
  ok:       true;
  national: string;
  e164?:    string;
}

export type SanitizeFailure = { ok: false };

// 3桁の特番（緊急通報・案内番号）は libphonenumber-js が解釈できないため先行処理する
const SHORT_CODE_RE = /^[0-9]{3}$/;

// 全角数字 ０-９ (U+FF10–U+FF19) を半角に変換する
const toHalfWidth = (s: string): string =>
  s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

/**
 * 電話番号入力をサニタイズし、national 番号と E.164 を返す
 *
 * @param input - ユーザー入力（全角・ハイフン・括弧・+81 等を許容）
 * @returns サニタイズ成功時は ok: true + national/e164、失敗時は ok: false
 */
export const sanitize = (input: string): SanitizeResult | SanitizeFailure => {
  if (!input) {
    return { ok: false };
  }

  // 全角正規化してから数字のみ抽出（SHORT_CODE 判定用）
  const stripped = toHalfWidth(input).replace(/[^\d]/g, '');

  if (SHORT_CODE_RE.test(stripped)) {
    return { ok: true, national: stripped };
  }

  const parsed = parsePhoneNumberFromString(input, 'JP');
  if (!parsed?.isPossible()) {
    return { ok: false };
  }

  return {
    ok:       true,
    national: '0' + parsed.nationalNumber,
    e164:     parsed.number,
  };
};
