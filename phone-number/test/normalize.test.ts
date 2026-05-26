/**
 * normalize.test.ts
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../src/index.js';

// ============================================================================
// 地域電気通信番号（固定電話）
// ============================================================================

describe('geographic', () => {
  it('東京 (03) を正規化する', () => {
    const result = normalize('03-1234-5678');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.national).toBe('0312345678');
    expect(result.e164).toBe('+81312345678');
    expect(result.kind).toBe('geographic');
    expect(result.meta.geographic).toBe(true);
    expect(result.meta.billPayer).toBe('caller');
    expect(result.meta.emergencyOk).toBe(true);
    expect(result.meta.intlDialable).toBe(true);
    expect(result.parts?.ndc).toBe('03');
    expect(result.parts?.subscriber).toBe('12345678');
    expect(result.region).toBe('東京都');
  });

  it('大阪 (06) を正規化する', () => {
    const result = normalize('06-9876-5432');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('geographic');
    expect(result.parts?.ndc).toBe('06');
    expect(result.region).toBe('大阪府（大阪市等）');
  });

  it('横浜 (045) を正規化する', () => {
    const result = normalize('045-123-4567');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('geographic');
    expect(result.parts?.ndc).toBe('045');
    expect(result.parts?.subscriber).toBe('1234567');
    expect(result.region).toBe('神奈川県（横浜市）');
  });

  it('函館 (0138) を正規化する', () => {
    const result = normalize('0138-62-1234');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('geographic');
    expect(result.parts?.ndc).toBe('0138');
    expect(result.region).toBe('北海道（函館市）');
  });

  it('+81 国際形式を受け入れる', () => {
    const result = normalize('+81-3-1234-5678');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.national).toBe('0312345678');
    expect(result.kind).toBe('geographic');
  });

  it('全角入力を受け入れる', () => {
    const result = normalize('０３－１２３４－５６７８');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.national).toBe('0312345678');
  });
});

// ============================================================================
// 携帯電話
// ============================================================================

describe('mobile', () => {
  it('090 を正規化する', () => {
    const result = normalize('090-1234-5678');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.national).toBe('09012345678');
    expect(result.e164).toBe('+819012345678');
    expect(result.kind).toBe('mobile');
    expect(result.meta.geographic).toBe(false);
    expect(result.meta.emergencyOk).toBe(true);
    expect(result.meta.intlDialable).toBe(true);
    expect(result.parts).toBeUndefined();
    expect(result.region).toBeUndefined();
  });

  it('080 を正規化する', () => {
    const result = normalize('080-9999-8888');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('mobile');
  });

  it('070 を正規化する', () => {
    const result = normalize('070-1111-2222');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('mobile');
  });
});

// ============================================================================
// 非地理的番号各種
// ============================================================================

describe('fmc', () => {
  it('060 を FMC と判定する', () => {
    const result = normalize('060-1234-5678');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('fmc');
    expect(result.meta.emergencyOk).toBe(true);
  });
});

describe('ip', () => {
  it('050 を IP 電話と判定する', () => {
    const result = normalize('050-1234-5678');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('ip');
    expect(result.meta.emergencyOk).toBe(false);
    expect(result.meta.intlDialable).toBe(true);
  });
});

describe('m2m', () => {
  it('020 を M2M と判定する', () => {
    const result = normalize('020-1234-5678');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('m2m');
    expect(result.meta.emergencyOk).toBe(false);
    expect(result.meta.intlDialable).toBe(false);
  });
});

describe('toll_free', () => {
  it('0120 を着信課金と判定する', () => {
    const result = normalize('0120-123-456');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('toll_free');
    expect(result.meta.billPayer).toBe('callee');
    expect(result.meta.emergencyOk).toBe(true);
  });

  it('0800 を着信課金と判定する', () => {
    const result = normalize('0800-123-4567');
    expect(result.valid).toBe(true);
    if (!result.valid) return;    expect(result.kind).toBe('toll_free');
    expect(result.meta.billPayer).toBe('callee');
  });
});

describe('universal', () => {
  it('0570 を全国統一番号と判定する', () => {
    const result = normalize('0570-01-2345');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('universal');
    expect(result.meta.billPayer).toBe('shared');
  });
});

describe('premium', () => {
  it('0990 を情報料代理徴収と判定する', () => {
    const result = normalize('0990-12-3456');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('premium');
    expect(result.meta.billPayer).toBe('caller');
    expect(result.meta.emergencyOk).toBe(false);
  });
});

describe('voicemail', () => {
  it('0180 を自動応答と判定する', () => {
    const result = normalize('0180-12-3456');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('voicemail');
    expect(result.meta.emergencyOk).toBe(false);
  });
});

// ============================================================================
// 緊急通報・特番
// ============================================================================

describe('emergency', () => {
  it('110 を緊急通報と判定する', () => {
    const result = normalize('110');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.national).toBe('110');
    expect(result.e164).toBeUndefined();
    expect(result.kind).toBe('emergency');
    expect(result.meta.billPayer).toBe('none');
    expect(result.meta.intlDialable).toBe(false);
  });

  it('119 を緊急通報と判定する', () => {
    const result = normalize('119');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('emergency');
  });

  it('118 を緊急通報と判定する', () => {
    const result = normalize('118');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('emergency');
  });
});

describe('special', () => {
  it('117 (時報) を特番と判定する', () => {
    const result = normalize('117');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('special');
  });

  it('177 (天気予報) を特番と判定する', () => {
    const result = normalize('177');
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.kind).toBe('special');
  });
});

// ============================================================================
// 無効入力
// ============================================================================

describe('invalid', () => {
  it('空文字は valid: false を返す', () => {
    expect(normalize('').valid).toBe(false);
  });

  it('不正な文字列は valid: false を返す', () => {
    expect(normalize('not-a-number').valid).toBe(false);
  });

  it('桁数不足は valid: false を返す', () => {
    expect(normalize('0312345').valid).toBe(false);
  });
});
