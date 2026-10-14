/**
 * sleep.ts
 *
 * @description 中断可能な待機（リトライのバックオフ・ポーリング間隔）
 */

import { toError } from './toError.ts';

/**
 * 指定ミリ秒待つ。signal が中断されたら待機をやめて reject する
 *
 * @param ms - 待機ミリ秒
 * @param signal - 中断シグナル
 * @returns 待機完了で resolve する Promise
 * @throws signal が中断された場合、その理由（既定は AbortError）
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<undefined>();
  if (!signal) {
    setTimeout(() => {
      resolve(undefined);
    }, ms);
    return promise;
  }

  const abortReason = (): Error => {
    const reason: unknown = signal.reason;
    return toError(reason);
  };
  if (signal.aborted) {
    reject(abortReason());
    return promise;
  }

  const onAbort = (): void => {
    clearTimeout(timer);
    reject(abortReason());
  };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve(undefined);
  }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
  return promise;
};
