/**
 * toError.ts
 *
 * @description catch した unknown を Error に正規化する共有ユーティリティ
 */

/**
 * catch した値を Error に正規化する
 *
 * 判定は realm を跨いでも正しい `Error.isError` で行う。Error でない値は捨てずに `cause` へ入れる。
 *
 * @param e - catch した値
 * @returns e が Error ならそのもの、そうでなければ e を cause に持つ新しい Error
 */
export const toError = (e: unknown): Error =>
  Error.isError(e) ? e : new Error(String(e), { cause: e });
