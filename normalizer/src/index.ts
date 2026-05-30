/**
 * index.ts
 * @description 正規化ライブラリの公開 API エントリーポイント
 */

export { Normalizer } from './normalize.js';
export type { NormalizerInstance } from './normalize.js';

export type {
  LegalPosition,
  NormalizeResult,
  NormalizerOptions,
  KanaOptions,
  WidthMode,
  ClassWidthConfig,
  FieldWidthConfig,
} from './types.js';
