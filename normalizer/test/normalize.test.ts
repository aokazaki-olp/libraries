/**
 * normalize.test.ts
 * @description 正規化ライブラリの基本動作確認
 *
 * 実行方法:
 *   tsx normalizer/test/normalize.test.ts
 */

import { preNormalize } from '../src/preNormalize.js';
import { extractLegalEntity } from '../src/legalEntity.js';
import { Normalizer } from '../src/normalize.js';

// ────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

const assert = (label: string, actual: unknown, expected: unknown): void => {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    期待: ${JSON.stringify(expected)}`);
    console.error(`    実際: ${JSON.stringify(actual)}`);
    fail++;
  }
};

const section = (title: string): void => {
  console.log(`\n[ ${title} ]`);
};

// ────────────────────────────────────────────────────
// [1] 基礎正規化
// ────────────────────────────────────────────────────

section('preNormalize');

assert('全角英字 → 半角',     preNormalize('ＡＢＣ'),          'ABC');
assert('全角数字 → 半角',     preNormalize('１２３'),          '123');
assert('全角括弧 → 半角',     preNormalize('（株）'),          '(株)');
assert('㈱ → (株)',           preNormalize('㈱'),              '(株)');
assert('㈲ → (有)',           preNormalize('㈲'),              '(有)');
assert('多重空白 → 1文字',    preNormalize('A  B'),            'A B');
assert('trim',                preNormalize('  ABC  '),         'ABC');
assert('NFKC: ﾄﾖﾀ → トヨタ', preNormalize('ﾄﾖﾀ'),            'トヨタ');

// ────────────────────────────────────────────────────
// [3] 法人格抽出
// ────────────────────────────────────────────────────

section('extractLegalEntity');

const e1 = extractLegalEntity('株式会社トヨタ自動車');
assert('前株: legalName',    e1.legalName,      '株式会社');
assert('前株: legalPosition', e1.legalPosition, 'pre');
assert('前株: name',     e1.name,       'トヨタ自動車');
assert('前株: ambiguous',    e1.ambiguous,      false);

const e2 = extractLegalEntity('トヨタ自動車株式会社');
assert('後株: legalName',    e2.legalName,      '株式会社');
assert('後株: legalPosition', e2.legalPosition, 'post');
assert('後株: name',     e2.name,       'トヨタ自動車');

const e3 = extractLegalEntity('(株)トヨタ自動車');
assert('(株)前: legalName',  e3.legalName,      '株式会社');
assert('(株)前: position',   e3.legalPosition,  'pre');

const e4 = extractLegalEntity('トヨタ自動車(株)');
assert('(株)後: position',   e4.legalPosition,  'post');

const e5 = extractLegalEntity('カ)トヨタ自動車');
assert('銀行前略: legalName', e5.legalName,     '株式会社');
assert('銀行前略: position',  e5.legalPosition, 'pre');

const e6 = extractLegalEntity('株式会社有限会社設立サポート');
assert('ambiguous①: legalName',  e6.legalName,  '株式会社');
assert('ambiguous①: ambiguous',  e6.ambiguous,  true);

const e7 = extractLegalEntity('(株)テスト(有)');
assert('ambiguous③: legalName',  e7.legalName,  null);
assert('ambiguous③: ambiguous',  e7.ambiguous,  true);
assert('ambiguous③: kind',       e7.kind,       null);

const e8 = extractLegalEntity('NPO法人テスト団体');
assert('NPO: legalName',         e8.legalName,  '特定非営利活動法人');
assert('NPO: position',          e8.legalPosition, 'pre');

// ────────────────────────────────────────────────────
// normalize() 統合テスト
// ────────────────────────────────────────────────────

section('Normalizer.create().normalize()');

const normalizer = Normalizer.create();  // db なし

const r1 = normalizer.normalize({ name: '㈱トヨタ自動車' });
assert('matchKey',       r1.matchKey,      'トヨタ自動車');
assert('matchKeyKanji',  r1.matchKeyKanji, 'トヨタ自動車');
assert('legalName',      r1.legalName,     '株式会社');
assert('normalized',     r1.canonical,    '株式会社トヨタ自動車');

const r2 = normalizer.normalize({ name: 'トヨタ自動車㈱' });
assert('後株 matchKey',  r2.matchKey,      'トヨタ自動車');

const r3 = normalizer.normalize({ name: 'TIS(株)' });
assert('英字 matchKey',  r3.matchKey,      'TIS');

const r4 = normalizer.normalize({ name: 'ＴＩＳ株式会社' });
assert('全角英字 matchKey', r4.matchKey,   'TIS');

const r5 = normalizer.normalize({ name: '田中太郎' });
assert('person: legalName', r5.legalName,  null);
assert('person: name',  r5.name,   '田中太郎');

// ────────────────────────────────────────────────────
// 結果
// ────────────────────────────────────────────────────

console.log(`\n結果: ${pass} 件 OK / ${fail} 件 NG`);
if (fail > 0) {
  process.exit(1);
}
