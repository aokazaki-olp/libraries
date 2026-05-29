/**
 * preNormalize.ts
 * @description [1] 基礎正規化
 *
 * 【触らないもの】
 *   U+30FC 長音符（ー）、U+3001 読点、U+3002 句点、各種括弧
 */

// ハイフン・ダッシュ系 → U+002D（U+FF0D は NFKC で処理済み）
// U+2010 HYPHEN, U+2011 NON-BREAKING HYPHEN, U+2012 FIGURE DASH
// U+2013 EN DASH, U+2014 EM DASH, U+2015 HORIZONTAL BAR, U+2212 MINUS SIGN
const HYPHEN_RE = /[‐‑‒–—―−]/g;

// U+00AD SOFT HYPHEN → 削除
const SOFT_HYPHEN_RE = /­/g;

// 中黒系 → U+30FB（U+FF65 は NFKC で U+30FB に処理済み）
// U+00B7 MIDDLE DOT, U+2027 HYPHENATION POINT
const MIDDLE_DOT_RE = /[·‧]/g;

// U+301C WAVE DASH → U+007E（U+FF5E は NFKC で U+007E に処理済み）
const WAVE_DASH_RE = /〜/g;

// NBSP 系 → U+0020（U+3000 全角スペースは NFKC で処理済み）
// U+00A0 NO-BREAK SPACE, U+202F NARROW NO-BREAK SPACE
const NBSP_RE = /[  ]/g;

// ゼロ幅文字 → 削除
// U+200B ZERO WIDTH SPACE, U+FEFF BOM / ZERO WIDTH NO-BREAK SPACE
const ZERO_WIDTH_RE = /[​﻿]/g;

// 多重空白 → 1 文字
const MULTI_SPACE_RE = / {2,}/g;

/**
 * 入力文字列に基礎正規化を適用する
 *
 * @param raw - 正規化前の文字列
 * @returns 正規化後の文字列
 * @throws {TypeError} raw が文字列でない場合
 */
export const preNormalize = (raw: string): string => {
  if (typeof raw !== 'string') {
    throw new TypeError('raw には文字列を指定してください');
  }

  // ① NFKC: 全角英数字・記号 → 半角、⑨ → (株) 等
  let s = raw.normalize('NFKC');

  // ② 記号統一（NFKC で残るもの）
  s = s.replace(HYPHEN_RE, '-');
  s = s.replace(SOFT_HYPHEN_RE, '');
  s = s.replace(MIDDLE_DOT_RE, '・');
  s = s.replace(WAVE_DASH_RE, '~');

  // ③ 空白処理
  s = s.replace(NBSP_RE, ' ');
  s = s.replace(ZERO_WIDTH_RE, '');
  s = s.replace(MULTI_SPACE_RE, ' ');
  s = s.trim();

  return s;
};
