/**
 * legalEntity.ts
 * @description [3] 法人格正規化
 *
 * エイリアスはすべて NFKC 適用後の形式（半角括弧）で定義する。
 * 長いエイリアスを優先マッチ（greedy）するため、buildAliasEntries() で長さ降順にソートする。
 */

// ────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────

type AliasPosition = 'pre' | 'post' | 'both';

interface LegalEntityDef {
  readonly canonical: string;
  readonly kind: string;
  /** 行頭・行末どちらにもマッチするエイリアス（正式名称・完全括弧形） */
  readonly both: readonly string[];
  /** 行頭専用エイリアス（片割れ閉じ括弧・銀行系行頭略） */
  readonly pre: readonly string[];
  /** 行末専用エイリアス（片割れ開き括弧・銀行系行末略） */
  readonly post: readonly string[];
}

interface AliasEntry {
  readonly alias: string;
  readonly canonical: string;
  readonly kind: string;
  readonly position: AliasPosition;
}

export interface LegalEntityResult {
  legalName: string | null;
  kind: string | null;
  legalPosition: 'pre' | 'post' | 'both' | 'none' | null;
  name: string;
  ambiguous: boolean;
}

// ────────────────────────────────────────────────────
// 法人格定義（NFKC 適用後の表記で定義）
// ────────────────────────────────────────────────────

const LEGAL_ENTITY_DEFS: readonly LegalEntityDef[] = [
  {
    canonical: '株式会社',
    kind: '301',
    both: ['株式会社', '(株)'],
    pre:  ['株)', 'カ)'],
    post: ['(株', '(カ'],
  },
  {
    canonical: '有限会社',
    kind: '302',
    both: ['有限会社', '(有)'],
    pre:  ['有)', 'ユ)'],
    post: ['(有', '(ユ'],
  },
  {
    canonical: '合名会社',
    kind: '303',
    both: ['合名会社', '(名)'],
    pre:  ['名)', 'メ)'],
    post: ['(名', '(メ'],
  },
  {
    canonical: '合資会社',
    kind: '304',
    both: ['合資会社', '(資)'],
    pre:  ['資)', 'シ)'],
    post: ['(資', '(シ'],
  },
  {
    canonical: '合同会社',
    kind: '305',
    both: ['合同会社', '(同)'],
    pre:  ['同)', 'ド)'],
    post: ['(同', '(ド'],
  },
  {
    canonical: '特定非営利活動法人',
    kind: '399',
    both: ['特定非営利活動法人', 'NPO法人', '(NPO)'],
    pre:  ['NPO)'],
    post: ['(NPO'],
  },
  {
    canonical: '医療法人',
    kind: '399',
    both: ['医療法人', '(医)'],
    pre:  ['医)'],
    post: ['(医'],
  },
  {
    canonical: '一般社団法人',
    kind: '399',
    both: ['一般社団法人', '(一社)'],
    pre:  ['一社)'],
    post: ['(一社'],
  },
  {
    canonical: '公益社団法人',
    kind: '399',
    both: ['公益社団法人', '(公社)'],
    pre:  ['公社)'],
    post: ['(公社'],
  },
  {
    canonical: '一般財団法人',
    kind: '399',
    both: ['一般財団法人', '(一財)'],
    pre:  ['一財)'],
    post: ['(一財'],
  },
  {
    canonical: '公益財団法人',
    kind: '399',
    both: ['公益財団法人', '(公財)'],
    pre:  ['公財)'],
    post: ['(公財'],
  },
  {
    canonical: '学校法人',
    kind: '399',
    both: ['学校法人', '(学)'],
    pre:  ['学)'],
    post: ['(学'],
  },
  {
    canonical: '社会福祉法人',
    kind: '399',
    both: ['社会福祉法人', '(福)'],
    pre:  ['福)'],
    post: ['(福'],
  },
] as const;

// ────────────────────────────────────────────────────
// エイリアスエントリ構築（長さ降順・greedy マッチ用）
// ────────────────────────────────────────────────────

const buildAliasEntries = (): AliasEntry[] => {
  const entries: AliasEntry[] = [];

  for (const def of LEGAL_ENTITY_DEFS) {
    for (const alias of def.both) {
      entries.push({ alias, canonical: def.canonical, kind: def.kind, position: 'both' });
    }
    for (const alias of def.pre) {
      entries.push({ alias, canonical: def.canonical, kind: def.kind, position: 'pre' });
    }
    for (const alias of def.post) {
      entries.push({ alias, canonical: def.canonical, kind: def.kind, position: 'post' });
    }
  }

  return entries.sort((a, b) => b.alias.length - a.alias.length);
};

const ALIAS_ENTRIES = buildAliasEntries();

/** 全 canonical 名のセット（ambiguous ① 判定用） */
const CANONICAL_SET = new Set(LEGAL_ENTITY_DEFS.map(d => d.canonical));

// ────────────────────────────────────────────────────
// マッチング
// ────────────────────────────────────────────────────

interface MatchResult {
  entry: AliasEntry;
  alias: string;
}

const matchPrefix = (name: string): MatchResult | null => {
  for (const entry of ALIAS_ENTRIES) {
    if (entry.position === 'post') {
      continue;
    }
    if (name.startsWith(entry.alias)) {
      return { entry, alias: entry.alias };
    }
  }
  return null;
};

const matchSuffix = (name: string): MatchResult | null => {
  for (const entry of ALIAS_ENTRIES) {
    if (entry.position === 'pre') {
      continue;
    }
    if (name.endsWith(entry.alias)) {
      return { entry, alias: entry.alias };
    }
  }
  return null;
};

/**
 * baseName の中に法人格 canonical 名が含まれるか判定する（ambiguous ① 検出）
 */
const containsLegalEntityName = (baseName: string): boolean => {
  for (const canonical of CANONICAL_SET) {
    if (baseName.includes(canonical)) {
      return true;
    }
  }
  return false;
};

// ────────────────────────────────────────────────────
// メイン API
// ────────────────────────────────────────────────────

/**
 * 基礎正規化済み文字列から法人格を検出・除去する
 *
 * @param name - preNormalize() 適用済みの文字列
 * @returns 法人格情報と本体名
 */
export const extractLegalEntity = (name: string): LegalEntityResult => {
  if (typeof name !== 'string') {
    throw new TypeError('name には文字列を指定してください');
  }

  const front = matchPrefix(name);
  const back  = matchSuffix(name);

  // ケース③: 前後で異なる法人格マッチ
  if (front !== null && back !== null && front.entry.canonical !== back.entry.canonical) {
    return {
      legalName: null,
      kind: null,
      legalPosition: null,
      name,
      ambiguous: true,
    };
  }

  // ケース②: 前後で同じ法人格マッチ
  if (front !== null && back !== null) {
    const baseName = name.slice(front.alias.length, name.length - back.alias.length);
    return {
      legalName: front.entry.canonical,
      kind: front.entry.kind,
      legalPosition: 'both',
      name: baseName,
      ambiguous: true,
    };
  }

  // 前株のみ
  if (front !== null) {
    const baseName = name.slice(front.alias.length);
    const ambiguous = containsLegalEntityName(baseName);
    return {
      legalName: front.entry.canonical,
      kind: front.entry.kind,
      legalPosition: 'pre',
      name: baseName,
      ambiguous,
    };
  }

  // 後株のみ
  if (back !== null) {
    const baseName = name.slice(0, name.length - back.alias.length);
    const ambiguous = containsLegalEntityName(baseName);
    return {
      legalName: back.entry.canonical,
      kind: back.entry.kind,
      legalPosition: 'post',
      name: baseName,
      ambiguous,
    };
  }

  // 法人格なし
  return {
    legalName: null,
    kind: null,
    legalPosition: 'none',
    name,
    ambiguous: false,
  };
};
