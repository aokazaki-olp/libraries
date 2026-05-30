/**
 * width.ts
 * @description 文字幅変換（half ↔ full）
 */

export type WidthMode = 'half' | 'full';

export interface ClassWidthConfig {
  digit?: WidthMode;    // [0-9]
  alpha?: WidthMode;    // [A-Za-z]
  symbol?: WidthMode;   // ASCII記号 [!-/:-@\[-`{-~]
  default?: WidthMode;  // それ以外（カナ・漢字等）
}

type Category = 'digit' | 'alpha' | 'symbol' | 'default';

export interface ResolvedWidthConfig {
  digit: WidthMode;
  alpha: WidthMode;
  symbol: WidthMode;
  default: WidthMode;
}

const HALF_TO_FULL_OFFSET = 0xFEE0; // U+FF01 - U+0021

const categorize = (cp: number): Category => {
  if (cp >= 0x30 && cp <= 0x39) return 'digit';
  if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) return 'alpha';
  if ((cp >= 0x21 && cp <= 0x2F) ||
      (cp >= 0x3A && cp <= 0x40) ||
      (cp >= 0x5B && cp <= 0x60) ||
      (cp >= 0x7B && cp <= 0x7E)) return 'symbol';
  return 'default';
};

export const resolveWidthConfig = (
  global: ClassWidthConfig = {},
  override: ClassWidthConfig = {},
): ResolvedWidthConfig => ({
  digit:   override.digit   ?? global.digit   ?? 'half',
  alpha:   override.alpha   ?? global.alpha   ?? 'half',
  symbol:  override.symbol  ?? global.symbol  ?? 'half',
  default: override.default ?? global.default ?? 'half',
});

export const applyWidth = (text: string, config: ResolvedWidthConfig): string => {
  let result = '';
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const mode = config[categorize(cp)];
    if (mode === 'full' && cp >= 0x21 && cp <= 0x7E) {
      result += String.fromCodePoint(cp + HALF_TO_FULL_OFFSET);
    } else {
      result += char;
    }
  }
  return result;
};
