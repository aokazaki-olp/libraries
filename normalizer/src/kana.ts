/**
 * kana.ts
 * @description 読み仮名正規化（文字レベル処理）
 */

const HIRAGANA_TO_KATAKANA_OFFSET = 0x60;

const SMALL_KANA_MAP: Readonly<Record<string, string>> = {
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ',
  'ゕ': 'か', 'ゖ': 'け',
  'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
  'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ',
  'ヵ': 'カ', 'ヶ': 'ケ',
};

export const hiraganaToKatakana = (s: string): string =>
  s.replace(/[ぁ-ゖ]/g, c => String.fromCodePoint(c.codePointAt(0)! + HIRAGANA_TO_KATAKANA_OFFSET));

export const katakanaToHiragana = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, c => String.fromCodePoint(c.codePointAt(0)! - HIRAGANA_TO_KATAKANA_OFFSET));

export const applySmallToLarge = (s: string): string =>
  [...s].map(c => SMALL_KANA_MAP[c] ?? c).join('');

export const buildKanaInvalidCharRe = (allowCharClass: string): RegExp =>
  new RegExp(`[^ぁ-ゖァ-ヶー\\s${allowCharClass}]`, 'g');

export const validateAllowCharClass = (allowCharClass: unknown): void => {
  if (allowCharClass === undefined) return;
  if (typeof allowCharClass !== 'string') {
    throw new TypeError('allowCharClass には文字列を指定してください');
  }
  if (allowCharClass.length > 500) {
    throw new TypeError('allowCharClass が長すぎます（500文字以内）');
  }
  if (/(?<!\\)]/.test(allowCharClass)) {
    throw new TypeError('allowCharClass に未エスケープの ] が含まれています。\\] と記述してください');
  }
  try {
    new RegExp(`[^ぁ-ゖァ-ヶー\\s${allowCharClass}]`);
  } catch {
    throw new TypeError(`allowCharClass が不正な正規表現文字クラスです: "${allowCharClass}"`);
  }
};
