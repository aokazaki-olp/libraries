'use strict';

const { normalize, isSameCompany } = require('../lib/normalizer');

let pass = 0;
let fail = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.error(`  ❌ ${label}`);
    console.error(`     期待: ${JSON.stringify(expected)}`);
    console.error(`     実際: ${JSON.stringify(actual)}`);
    fail++;
  }
}

// ── normalize() テスト ─────────────────────────────────────────────────────
// [入力, 期待 matchKey, 期待 legalName, 期待 legalPosition]
const normalizeCases = [
  ['㈱トヨタ自動車',           'トヨタ自動車',   '株式会社',         'pre'],
  ['トヨタ自動車㈱',           'トヨタ自動車',   '株式会社',         'post'],
  ['トヨタ自動車株式会社',     'トヨタ自動車',   '株式会社',         'post'],
  ['株式会社トヨタ自動車',     'トヨタ自動車',   '株式会社',         'pre'],
  ['（株）トヨタ自動車',       'トヨタ自動車',   '株式会社',         'pre'],
  ['ＴＩＳ株式会社',           'TIS',            '株式会社',         'post'],
  ['TIS(株)',                  'TIS',            '株式会社',         'post'],
  ['合同会社ABC',              'ABC',            '合同会社',         'pre'],
  ['ABC LLC',                 'ABC',            '合同会社',         'post'],
  ['NPO法人テスト',            'テスト',         '特定非営利活動法人', 'pre'],
  ['一般社団法人　日本協会',   '日本協会',       '一般社団法人',     'pre'],
  ['（一社）日本協会',         '日本協会',       '一般社団法人',     'pre'],
  ['有限会社サンプル',         'サンプル',       '有限会社',         'pre'],
  ['サンプル㈲',               'サンプル',       '有限会社',         'post'],
  ['医療法人社団テスト',       'テスト',         '医療法人',         'pre'],
  ['公益財団法人テスト財団',   'テスト財団',     '公益財団法人',     'pre'],
  ['(公財)テスト財団',         'テスト財団',     '公益財団法人',     'pre'],
];

console.log('\n── normalize() ──────────────────────────────────────');
for (const [input, expectedKey, expectedLegal, expectedPos] of normalizeCases) {
  const r = normalize(input);
  assert(
    `matchKey  "${input}"`,
    r.matchKey, expectedKey,
  );
  assert(
    `legalName "${input}"`,
    r.legalName, expectedLegal,
  );
  assert(
    `position  "${input}"`,
    r.legalPosition, expectedPos,
  );
}

// ── normalized 表示名のテスト（前置形式に統一されること）──────────────────
console.log('\n── normalized 表示名（前置統一） ────────────────────');
const displayCases = [
  ['トヨタ自動車㈱',       '株式会社トヨタ自動車'],
  ['㈱トヨタ自動車',       '株式会社トヨタ自動車'],
  ['TIS(株)',              '株式会社TIS'],
  ['ABC LLC',             '合同会社ABC'],
];
for (const [input, expected] of displayCases) {
  const r = normalize(input);
  assert(`normalized "${input}"`, r.normalized, expected);
}

// ── isSameCompany() テスト ────────────────────────────────────────────────
console.log('\n── isSameCompany() ──────────────────────────────────');
const sameTests = [
  ['㈱トヨタ自動車',     'トヨタ自動車株式会社', true,  '記号表記 vs 後株'],
  ['TIS(株)',            '株式会社TIS',          true,  '後株英字 vs 前株'],
  ['ABC合同会社',        'ABC LLC',              true,  '後置 vs LLC略称'],
  ['株式会社ABC',        '有限会社ABC',          false, '法人格が違う'],
  ['株式会社テスト',     '株式会社テスト',       true,  '完全一致'],
  ['（一社）日本協会',   '一般社団法人　日本協会', true, '略称 vs 正式名'],
];
for (const [a, b, expected, label] of sameTests) {
  const res = isSameCompany(a, b);
  assert(`${label}  "${a}" vs "${b}"`, res.isSame, expected);
}

// ── 結果サマリー ───────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`結果: ${pass} 件 OK / ${fail} 件 NG`);
if (fail > 0) process.exit(1);
