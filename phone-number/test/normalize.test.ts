/**
 * normalize.test.ts
 * @description normalize() の網羅的テスト
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../src/index.js';
import type { PhoneKind, PhoneMeta } from '../src/index.js';

// ============================================================================
// ヘルパー
// ============================================================================

const ok = (input: string) => {
  const r = normalize(input);
  expect(r.valid, `valid が false: ${input}`).toBe(true);
  if (!r.valid) throw new Error('unreachable');
  return r;
};

// ============================================================================
// 1. 入力フォーマット — 区切り記号・スペース
// ============================================================================

describe('入力フォーマット — 区切り記号', () => {
  const EXPECTED_NATIONAL = '0312345678';
  const EXPECTED_E164     = '+81312345678';

  const cases: Array<[string, string]> = [
    ['ハイフン区切り',       '03-1234-5678'],
    ['ハイフンなし連続',     '0312345678'],
    ['スペース区切り',       '03 1234 5678'],
    ['ドット区切り',         '03.1234.5678'],
    ['括弧形式',             '(03)1234-5678'],
    ['括弧+スペース',        '(03) 1234-5678'],
    ['先頭・末尾スペース',   '  03-1234-5678  '],
  ];

  for (const [label, input] of cases) {
    it(label, () => {
      const r = ok(input);
      expect(r.national, label).toBe(EXPECTED_NATIONAL);
      expect(r.e164,     label).toBe(EXPECTED_E164);
    });
  }
});

// ============================================================================
// 2. 入力フォーマット — 国際形式
// ============================================================================

describe('入力フォーマット — 国際形式', () => {
  it('+81 ハイフン形式', () => {
    const r = ok('+81-3-1234-5678');
    expect(r.national).toBe('0312345678');
    expect(r.e164).toBe('+81312345678');
    expect(r.kind).toBe('geographic');
  });

  it('+81 スペース形式', () => {
    const r = ok('+81 3 1234 5678');
    expect(r.national).toBe('0312345678');
  });

  it('+81 携帯', () => {
    const r = ok('+81-90-1234-5678');
    expect(r.national).toBe('09012345678');
    expect(r.e164).toBe('+819012345678');
    expect(r.kind).toBe('mobile');
  });
});

// ============================================================================
// 3. 入力フォーマット — 全角・混合
// ============================================================================

describe('入力フォーマット — 全角・混合', () => {
  it('全角数字のみ', () => {
    const r = ok('０３１２３４５６７８');
    expect(r.national).toBe('0312345678');
    expect(r.kind).toBe('geographic');
  });

  it('全角数字＋全角ハイフン', () => {
    const r = ok('０３－１２３４－５６７８');
    expect(r.national).toBe('0312345678');
  });

  it('混合（全角NDC＋半角残り）', () => {
    const r = ok('０3-1234-5678');
    expect(r.national).toBe('0312345678');
  });

  it('全角特番 110', () => {
    const r = ok('１１０');
    expect(r.national).toBe('110');
    expect(r.kind).toBe('emergency');
  });

  it('全角特番 119', () => {
    const r = ok('１１９');
    expect(r.kind).toBe('emergency');
  });

  it('全角特番 117', () => {
    const r = ok('１１７');
    expect(r.kind).toBe('special');
  });

  it('全角携帯', () => {
    const r = ok('０９０－１２３４－５６７８');
    expect(r.national).toBe('09012345678');
    expect(r.kind).toBe('mobile');
  });
});

// ============================================================================
// 4. 分類 — geographic（地域電気通信番号）
// ============================================================================

describe('分類 — geographic', () => {
  it('東京 03', () => {
    const r = ok('03-1234-5678');
    expect(r.kind).toBe('geographic');
  });

  it('大阪 06', () => {
    const r = ok('06-9876-5432');
    expect(r.kind).toBe('geographic');
  });

  it('名古屋 052', () => {
    const r = ok('052-123-4567');
    expect(r.kind).toBe('geographic');
  });

  it('福岡 092', () => {
    const r = ok('092-111-2222');
    expect(r.kind).toBe('geographic');
  });

  it('函館 0138（4桁NDC）', () => {
    const r = ok('0138-62-1234');
    expect(r.kind).toBe('geographic');
  });
});

// ============================================================================
// 5. 分類 — mobile（携帯電話）
// ============================================================================

describe('分類 — mobile', () => {
  for (const prefix of ['090', '080', '070']) {
    it(`${prefix} を mobile と判定`, () => {
      const r = ok(`${prefix}-1234-5678`);
      expect(r.kind).toBe('mobile');
      expect(r.national).toBe(`${prefix}12345678`);
    });
  }
});

// ============================================================================
// 6. 分類 — fmc / ip / m2m
// ============================================================================

describe('分類 — fmc / ip / m2m', () => {
  it('060 → fmc', () => {
    expect(ok('060-1234-5678').kind).toBe('fmc');
  });

  it('050 → ip', () => {
    expect(ok('050-1234-5678').kind).toBe('ip');
  });

  it('020 → m2m', () => {
    expect(ok('020-1234-5678').kind).toBe('m2m');
  });
});

// ============================================================================
// 7. 分類 — 付加的役務
// ============================================================================

describe('分類 — 付加的役務', () => {
  it('0120 → toll_free', () => {
    expect(ok('0120-123-456').kind).toBe('toll_free');
  });

  it('0800 → toll_free', () => {
    expect(ok('0800-123-4567').kind).toBe('toll_free');
  });

  it('0570 → universal', () => {
    expect(ok('0570-01-2345').kind).toBe('universal');
  });

  it('0990 → premium', () => {
    expect(ok('0990-12-3456').kind).toBe('premium');
  });

  it('0180 → voicemail', () => {
    expect(ok('0180-12-3456').kind).toBe('voicemail');
  });
});

// ============================================================================
// 8. 分類 — 緊急通報・特番
// ============================================================================

describe('分類 — 緊急通報', () => {
  for (const num of ['110', '118', '119']) {
    it(`${num} → emergency`, () => {
      const r = ok(num);
      expect(r.kind).toBe('emergency');
      expect(r.national).toBe(num);
      expect(r.e164).toBeUndefined();
    });
  }
});

describe('分類 — 特番', () => {
  for (const num of ['104', '113', '115', '116', '117', '171', '177']) {
    it(`${num} → special`, () => {
      const r = ok(num);
      expect(r.kind).toBe('special');
      expect(r.national).toBe(num);
      expect(r.e164).toBeUndefined();
    });
  }
});

// ============================================================================
// 9. meta — 全種別のメタ情報テーブル検証
// ============================================================================

describe('meta — 全種別テーブル検証', () => {
  const TABLE: Array<{
    kind:     PhoneKind;
    input:    string;
    meta:     PhoneMeta;
  }> = [
    {
      kind:  'geographic',
      input: '03-1234-5678',
      meta:  { geographic: true,  billPayer: 'caller', emergencyOk: true,  intlDialable: true  },
    },
    {
      kind:  'mobile',
      input: '090-1234-5678',
      meta:  { geographic: false, billPayer: 'caller', emergencyOk: true,  intlDialable: true  },
    },
    {
      kind:  'fmc',
      input: '060-1234-5678',
      meta:  { geographic: false, billPayer: 'caller', emergencyOk: true,  intlDialable: true  },
    },
    {
      kind:  'ip',
      input: '050-1234-5678',
      meta:  { geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: true  },
    },
    {
      kind:  'm2m',
      input: '020-1234-5678',
      meta:  { geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: false },
    },
    {
      kind:  'toll_free',
      input: '0120-123-456',
      meta:  { geographic: false, billPayer: 'callee', emergencyOk: true,  intlDialable: false },
    },
    {
      kind:  'universal',
      input: '0570-01-2345',
      meta:  { geographic: false, billPayer: 'shared', emergencyOk: true,  intlDialable: false },
    },
    {
      kind:  'premium',
      input: '0990-12-3456',
      meta:  { geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: false },
    },
    {
      kind:  'voicemail',
      input: '0180-12-3456',
      meta:  { geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: false },
    },
    {
      kind:  'emergency',
      input: '110',
      meta:  { geographic: false, billPayer: 'none',   emergencyOk: false, intlDialable: false },
    },
    {
      kind:  'special',
      input: '117',
      meta:  { geographic: false, billPayer: 'none',   emergencyOk: false, intlDialable: false },
    },
  ];

  for (const { kind, input, meta } of TABLE) {
    it(`${kind}: meta 4項目が正しい`, () => {
      const r = ok(input);
      expect(r.kind, 'kind').toBe(kind);
      expect(r.meta.geographic,   `${kind}.geographic`  ).toBe(meta.geographic);
      expect(r.meta.billPayer,    `${kind}.billPayer`   ).toBe(meta.billPayer);
      expect(r.meta.emergencyOk,  `${kind}.emergencyOk` ).toBe(meta.emergencyOk);
      expect(r.meta.intlDialable, `${kind}.intlDialable`).toBe(meta.intlDialable);
    });
  }
});

// ============================================================================
// 10. NDC 分割 — 局番ごとの分割結果
// ============================================================================

describe('NDC 分割 — 局番と地域名', () => {
  const cases: Array<[string, string, string, string, string]> = [
    // [input,            ndc,    local,  subscriber, region]
    ['03-1234-5678',     '03',   '1234', '5678',     '東京都'],
    ['06-9876-5432',     '06',   '9876', '5432',     '大阪府（大阪市等）'],
    ['011-123-4567',     '011',  '123',  '4567',     '北海道（札幌市）'],
    ['022-333-4444',     '022',  '333',  '4444',     '宮城県（仙台市）'],
    ['045-123-4567',     '045',  '123',  '4567',     '神奈川県（横浜市）'],
    ['052-111-2222',     '052',  '111',  '2222',     '愛知県（名古屋市）'],
    ['075-222-3333',     '075',  '222',  '3333',     '京都府（京都市）'],
    ['078-333-4444',     '078',  '333',  '4444',     '兵庫県（神戸市）'],
    ['092-444-5555',     '092',  '444',  '5555',     '福岡県（福岡市）'],
    ['098-888-1234',     '098',  '888',  '1234',     '沖縄県（那覇市等）'],
    ['0138-62-1234',     '0138', '62',   '1234',     '北海道（函館市）'],
    ['0166-23-4567',     '0166', '23',   '4567',     '北海道（旭川市）'],
  ];

  for (const [input, ndc, local, subscriber, region] of cases) {
    it(`${input} → NDC="${ndc}" local="${local}" subscriber="${subscriber}"`, () => {
      const r = ok(input);
      expect(r.parts?.ndc,        'ndc'       ).toBe(ndc);
      expect(r.parts?.local,      'local'     ).toBe(local);
      expect(r.parts?.subscriber, 'subscriber').toBe(subscriber);
      expect(r.region,            'region'    ).toBe(region);
    });
  }
});

// ============================================================================
// 11. NDC 分割 — 加入者番号の桁数
// ============================================================================

describe('NDC 分割 — 各フィールドの桁数（合計10桁）', () => {
  // 加入者番号は常に4桁。market の NDC 長によって local 桁数が変わる。
  // local = 10 - ndc長 - 4

  it('2桁NDC(03): local=4桁, subscriber=4桁', () => {
    const r = ok('03-1234-5678');
    expect(r.parts?.ndc.length,        'ndc'       ).toBe(2);
    expect(r.parts?.local.length,      'local'     ).toBe(4);
    expect(r.parts?.subscriber.length, 'subscriber').toBe(4);
    const total = (r.parts?.ndc.length ?? 0)
                + (r.parts?.local.length ?? 0)
                + (r.parts?.subscriber.length ?? 0);
    expect(total, '合計').toBe(10);
  });

  it('3桁NDC(045): local=3桁, subscriber=4桁', () => {
    const r = ok('045-123-4567');
    expect(r.parts?.ndc.length,        'ndc'       ).toBe(3);
    expect(r.parts?.local.length,      'local'     ).toBe(3);
    expect(r.parts?.subscriber.length, 'subscriber').toBe(4);
  });

  it('4桁NDC(0138): local=2桁, subscriber=4桁', () => {
    const r = ok('0138-62-1234');
    expect(r.parts?.ndc.length,        'ndc'       ).toBe(4);
    expect(r.parts?.local.length,      'local'     ).toBe(2);
    expect(r.parts?.subscriber.length, 'subscriber').toBe(4);
  });
});

// ============================================================================
// 12. NDC 分割 — 辞書未収録局番
// ============================================================================

describe('NDC 分割 — 辞書未収録局番', () => {
  it('辞書にない NDC (041): kind=geographic, parts/region は undefined', () => {
    // "041" は NDC_MAP に収録されていない（042〜049 は収録済み）
    // 10桁なので libphonenumber-js の isPossible() は通過する
    const r = ok('041-234-5678');
    expect(r.kind).toBe('geographic');
    expect(r.parts).toBeUndefined();
    expect(r.region).toBeUndefined();
  });
});

// ============================================================================
// 13. 結果構造 — raw / e164 / parts / region の有無
// ============================================================================

describe('結果構造 — フィールドの有無', () => {
  it('raw は常に入力のまま保持される（格変換なし）', () => {
    const input = '  ０３ー１２３４ー５６７８  ';
    const r = normalize(input);
    expect(r.raw).toBe(input);
  });

  it('raw は valid:false でも保持される', () => {
    const r = normalize('not-a-phone');
    expect(r.raw).toBe('not-a-phone');
  });

  it('geographic: e164 が存在する', () => {
    const r = ok('03-1234-5678');
    expect(r.e164).toMatch(/^\+81/);
  });

  it('mobile: e164 が存在する', () => {
    const r = ok('090-1234-5678');
    expect(r.e164).toMatch(/^\+81/);
  });

  it('emergency (110): e164 は undefined', () => {
    const r = ok('110');
    expect(r.e164).toBeUndefined();
  });

  it('special (117): e164 は undefined', () => {
    const r = ok('117');
    expect(r.e164).toBeUndefined();
  });

  it('geographic: parts と region が存在する（辞書収録の場合）', () => {
    const r = ok('03-1234-5678');
    expect(r.parts).toBeDefined();
    expect(r.region).toBeDefined();
  });

  it('mobile: parts と region は undefined', () => {
    const r = ok('090-1234-5678');
    expect(r.parts).toBeUndefined();
    expect(r.region).toBeUndefined();
  });

  it('toll_free: parts と region は undefined', () => {
    const r = ok('0120-123-456');
    expect(r.parts).toBeUndefined();
    expect(r.region).toBeUndefined();
  });

  it('emergency: parts と region は undefined', () => {
    const r = ok('119');
    expect(r.parts).toBeUndefined();
    expect(r.region).toBeUndefined();
  });
});

// ============================================================================
// 14. 無効入力
// ============================================================================

describe('無効入力', () => {
  const invalid: Array<[string, string]> = [
    ['空文字',           ''],
    ['スペースのみ',     '   '],
    ['アルファベット',   'abc'],
    ['混合（英数）',     'tel:03-1234'],
    ['桁数不足',         '03-1234'],
    ['桁数超過（11桁固定）', '03-1234-56789'],
    ['1桁だけ',           '0'],
    ['2桁だけ',           '03'],
    ['4桁だけ',           '0312'],
  ];

  for (const [label, input] of invalid) {
    it(label, () => {
      expect(normalize(input).valid, label).toBe(false);
    });
  }
});

// ============================================================================
// 15. TypeError — 非 string 入力
// ============================================================================

describe('TypeError — 非 string 入力', () => {
  it('null を渡すと TypeError', () => {
    expect(() => normalize(null as unknown as string)).toThrow(TypeError);
  });

  it('undefined を渡すと TypeError', () => {
    expect(() => normalize(undefined as unknown as string)).toThrow(TypeError);
  });

  it('number を渡すと TypeError', () => {
    expect(() => normalize(312345678 as unknown as string)).toThrow(TypeError);
  });

  it('object を渡すと TypeError', () => {
    expect(() => normalize({} as unknown as string)).toThrow(TypeError);
  });
});

// ============================================================================
// 16. 境界ケース — プレフィックス優先順位・桁数ルール
// ============================================================================

describe('境界ケース — プレフィックス優先順位', () => {
  it('0120 は geographic より toll_free が優先される', () => {
    // 4桁プレフィックスが3桁より先にマッチすること
    const r = ok('0120-123-456');
    expect(r.kind).toBe('toll_free');
    expect(r.kind).not.toBe('geographic');
  });

  it('0800 は 080（mobile）より toll_free が優先される', () => {
    const r = ok('0800-123-4567');
    expect(r.kind).toBe('toll_free');
    expect(r.kind).not.toBe('mobile');
  });

  it('0570 は geographic にならない', () => {
    const r = ok('0570-01-2345');
    expect(r.kind).toBe('universal');
    expect(r.kind).not.toBe('geographic');
  });

  it('0990 は geographic にならない', () => {
    const r = ok('0990-12-3456');
    expect(r.kind).toBe('premium');
    expect(r.kind).not.toBe('geographic');
  });
});

describe('境界ケース — toll_free の桁数', () => {
  it('0120: 合計10桁で valid', () => {
    // 0120 + 6桁 = 10桁
    const r = normalize('0120-123-456');
    expect(r.valid).toBe(true);
  });

  it('0800: 合計11桁で valid', () => {
    // 0800 + 7桁 = 11桁
    const r = normalize('0800-123-4567');
    expect(r.valid).toBe(true);
  });
});

describe('境界ケース — geographic の桁数', () => {
  it('10桁（03 + 8桁）で valid', () => {
    expect(normalize('03-1234-5678').valid).toBe(true);
  });

  it('9桁（03 + 7桁）は valid:false', () => {
    expect(normalize('03-1234-567').valid).toBe(false);
  });

  it('11桁の固定電話形式は valid:false', () => {
    expect(normalize('03-1234-56789').valid).toBe(false);
  });
});

describe('境界ケース — national の一致性', () => {
  it('+81 形式と 0X 形式で同じ national を返す', () => {
    const a = ok('+81-3-1234-5678');
    const b = ok('03-1234-5678');
    expect(a.national).toBe(b.national);
    expect(a.kind).toBe(b.kind);
  });

  it('+81 携帯形式と 090 形式で同じ national を返す', () => {
    const a = ok('+81-90-1234-5678');
    const b = ok('090-1234-5678');
    expect(a.national).toBe(b.national);
  });
});
