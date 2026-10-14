/**
 * abort.ts
 *
 * @description AbortSignal の中断理由を例外として扱うための共有ユーティリティ
 */

import { toError } from './toError.ts';

/**
 * 中断された signal の理由を Error として返す
 *
 * どの経路（通信中・待機中・失敗後）で中断に気づいても、呼び出し側には同じ値を投げるために使う。
 *
 * @param signal - 中断された signal
 * @returns signal.reason（Error でなければ cause に包んだ Error）
 */
export const abortReason = (signal: AbortSignal): Error => {
  const reason: unknown = signal.reason;
  return toError(reason);
};
