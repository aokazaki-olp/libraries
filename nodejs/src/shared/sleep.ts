/**
 * sleep.ts
 *
 * @description 中断可能な待機（リトライのバックオフ・ポーリング間隔）
 */

import { abortReason } from './abort.ts';

/** タイマーに渡せる最大のミリ秒（これを超えると Node は 1ms に丸める） */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * 指定ミリ秒待つ。signal が中断されたら待機をやめて reject する
 *
 * MAX_TIMER_MS を超える待機は MAX_TIMER_MS で打ち切る（そのまま渡すと 1ms に丸められ、
 * 指数バックオフや大きな Retry-After がほぼ待たずに再送になる）。
 *
 * @param ms - 待機ミリ秒
 * @param signal - 中断シグナル
 * @returns 待機完了で resolve する Promise
 * @throws signal が中断された場合、その理由（既定は AbortError）
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<undefined>();
  const delay = Math.min(ms, MAX_TIMER_MS);
  if (!signal) {
    setTimeout(() => {
      resolve(undefined);
    }, delay);
    return promise;
  }

  if (signal.aborted) {
    reject(abortReason(signal));
    return promise;
  }

  const onAbort = (): void => {
    clearTimeout(timer);
    reject(abortReason(signal));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve(undefined);
  }, delay);
  signal.addEventListener('abort', onAbort, { once: true });
  return promise;
};
