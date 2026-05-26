/**
 * index.ts
 * @description 公開 API エントリーポイント
 */

import { sanitize } from './sanitize.js';
import { classify } from './classify.js';
import { splitGeographic } from './split-geographic.js';
import type { NormalizeResult, NormalizedPhone } from './types.js';

export type { PhoneKind, BillPayer, PhoneMeta, PhoneParts, NormalizedPhone, NormalizeResult } from './types.js';

/**
 * 日本の電話番号を正規化・分類する
 *
 * @param input - 電話番号文字列（全角・ハイフン・括弧・+81 等を許容）
 * @returns 正規化結果。パース不能または未知番号の場合は valid: false
 * @throws {TypeError} input が string でない場合
 */
export const normalize = (input: string): NormalizeResult => {
  if (typeof input !== 'string') {
    throw new TypeError('input には string を指定してください');
  }

  const sanitized = sanitize(input);
  if (!sanitized.ok) {
    return { valid: false, raw: input };
  }

  const { national, e164 } = sanitized;

  const entry = classify(national);
  if (!entry) {
    return { valid: false, raw: input };
  }

  const result: NormalizedPhone = {
    valid:    true,
    raw:      input,
    national,
    ...(e164 != null ? { e164 } : {}),
    kind:     entry.kind,
    meta:     entry.meta,
  };

  if (entry.kind === 'geographic') {
    const geo = splitGeographic(national);
    if (geo) {
      result.parts  = geo.parts;
      result.region = geo.region;
    }
  }

  return result;
};
