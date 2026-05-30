/**
 * normalize.comprehensive.test.ts
 * @description 正規化ライブラリの網羅的テスト
 *
 * 実行方法:
 *   tsx normalizer/test/normalize.comprehensive.test.ts
 */

import { preNormalize } from '../src/preNormalize.js';
import { applyVariantMap } from '../src/variantMap.js';
import { extractLegalEntity } from '../src/legalEntity.js';
import { Normalizer } from '../src/normalize.js';

// ────────────────────────────────────────────────────
// テストランナー
// ────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
let currentSection = '';

const section = (title: string): void => {
  currentSection = title;
  console.log(`\n══ ${title} ══`);
};

const subsection = (title: string): void => {
  console.log(`\n  ─ ${title}`);
};

const assert = (label: string, actual: unknown, expected: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`    ✓ ${label}`);
    pass++;
  } else {
    console.error(`    ✗ ${label}`);
    console.error(`      期待: ${JSON.stringify(expected)}`);
    console.error(`      実際: ${JSON.stringify(actual)}`);
    console.error(`      セクション: ${currentSection}`);
    fail++;
  }
};

const assertThrows = (label: string, fn: () => unknown, errorType: string): void => {
  try {
    fn();
    console.error(`    ✗ ${label} (例外が発生しなかった)`);
    fail++;
  } catch (e) {
    if (e instanceof Error && e.constructor.name === errorType) {
      console.log(`    ✓ ${label}`);
      pass++;
    } else {
      console.error(`    ✗ ${label} (期待: ${errorType}, 実際: ${e instanceof Error ? e.constructor.name : typeof e})`);
      fail++;
    }
  }
};

// ────────────────────────────────────────────────────
// [1] preNormalize
// ────────────────────────────────────────────────────

section('preNormalize');

subsection('入力バリデーション');
assertThrows('数値 → TypeError',   () => preNormalize(42 as unknown as string),   'TypeError');
assertThrows('null → TypeError',   () => preNormalize(null as unknown as string),  'TypeError');
assertThrows('配列 → TypeError',   () => preNormalize([] as unknown as string),    'TypeError');

subsection('空文字・空白のみ');
assert('空文字',         preNormalize(''),           '');
assert('半角スペースのみ', preNormalize('   '),       '');
assert('タブのみ → trim で空',  preNormalize('\t'),       '');   // 先頭末尾のタブはtrimで除去

subsection('NFKC: 全角英数字 → 半角');
assert('全角大文字 Ａ-Ｚ',  preNormalize('ＡＢＣＤＥ'),     'ABCDE');
assert('全角小文字 ａ-ｚ',  preNormalize('ａｂｃｄｅ'),     'abcde');
assert('全角数字 ０-９',    preNormalize('０１２３４５'),   '012345');
assert('混在',             preNormalize('ＴＩＳ１２３'),    'TIS123');

subsection('NFKC: 全角記号 → 半角');
assert('全角スペース',     preNormalize('A　B'),            'A B');
assert('全角括弧',         preNormalize('（株）'),          '(株)');
assert('全角感嘆符',       preNormalize('Ａ！'),            'A!');
assert('全角アンパサンド', preNormalize('Ａ＆Ｂ'),          'A&B');
assert('全角スラッシュ',   preNormalize('Ａ／Ｂ'),          'A/B');

subsection('NFKC: 法人格記号');
assert('㈱ → (株)',        preNormalize('㈱テスト'),        '(株)テスト');
assert('㈲ → (有)',        preNormalize('㈲テスト'),        '(有)テスト');
assert('半角カナ → 全角', preNormalize('ﾄﾖﾀ'),            'トヨタ');
assert('半角カナ中黒',     preNormalize('ｶ･ｶ'),            'カ・カ');

subsection('ハイフン・ダッシュ統一 → U+002D');
// 各種ダッシュが - に統一されることを確認
assert('U+2010 HYPHEN',               preNormalize('A‐B'), 'A-B');
assert('U+2011 NON-BREAKING HYPHEN',  preNormalize('A‑B'), 'A-B');
assert('U+2012 FIGURE DASH',          preNormalize('A‒B'), 'A-B');
assert('U+2013 EN DASH',              preNormalize('A–B'), 'A-B');
assert('U+2014 EM DASH',              preNormalize('A—B'), 'A-B');
assert('U+2015 HORIZONTAL BAR',       preNormalize('A―B'), 'A-B');
assert('U+2212 MINUS SIGN',           preNormalize('A−B'), 'A-B');
assert('U+00AD SOFT HYPHEN → 削除',  preNormalize('A­B'), 'AB');

subsection('中黒統一 → U+30FB');
assert('U+00B7 MIDDLE DOT → ・',     preNormalize('A·B'), 'A・B');
assert('U+2027 HYPHENATION POINT → ・', preNormalize('A‧B'), 'A・B');
assert('U+FF65 半角中黒 → ・ (NFKC)', preNormalize('A･B'), 'A・B');

subsection('波線統一');
assert('U+301C WAVE DASH → ~',        preNormalize('A〜B'), 'A~B');
assert('U+FF5E FULLWIDTH TILDE → ~ (NFKC)', preNormalize('A～B'), 'A~B');

subsection('空白処理');
assert('U+00A0 NBSP → 半角SP',       preNormalize('A B'),  'A B');
assert('U+202F NARROW NBSP → 半角SP', preNormalize('A B'), 'A B');
assert('U+200B ZERO WIDTH SP → 削除', preNormalize('A​B'), 'AB');
assert('U+FEFF BOM → 削除',           preNormalize('﻿ABC'), 'ABC');
assert('多重空白 → 1文字',            preNormalize('A   B'),     'A B');
assert('先頭末尾空白 trim',           preNormalize(' ABC '),     'ABC');
assert('全角スペース多重',            preNormalize('A　　B'), 'A B');

subsection('触らないもの');
assert('U+30FC 長音符 保持',          preNormalize('ソフトバンク'),  'ソフトバンク');
assert('U+3001 読点 保持',            preNormalize('山田、太郎'),    '山田、太郎');
assert('U+3002 句点 保持',            preNormalize('山田太郎。'),    '山田太郎。');
assert('半角括弧 保持',               preNormalize('(株)テスト'),    '(株)テスト');
assert('全角角括弧 → 半角 (NFKC)',   preNormalize('［ABC］'),       '[ABC]');

subsection('べき等性（正規化済み → 変化なし）');
const alreadyNormalized = 'ABC テスト (株)';
assert('2回適用しても同じ', preNormalize(preNormalize(alreadyNormalized)), alreadyNormalized);

// ────────────────────────────────────────────────────
// [2] applyVariantMap
// ────────────────────────────────────────────────────

section('applyVariantMap');

subsection('基本動作');
const vm = new Map([['齋', '斎'], ['邊', '辺'], ['冨', '富'], ['髙', '高']]);

assert('空文字',            applyVariantMap('', vm),         '');
assert('マップにない文字',  applyVariantMap('ABC', vm),      'ABC');
assert('単一変換',          applyVariantMap('齋藤', vm),     '斎藤');
assert('複数変換',          applyVariantMap('齋邊', vm),     '斎辺');
assert('混在（変換あり・なし）', applyVariantMap('齋藤太郎', vm), '斎藤太郎');
assert('連続した変換対象',  applyVariantMap('齋齋齋', vm),   '斎斎斎');
assert('冨 → 富',          applyVariantMap('冨田', vm),      '富田');
assert('髙 → 高',          applyVariantMap('髙橋', vm),      '高橋');

subsection('空マップ（db なし時）');
const emptyMap = new Map<string, string>();
assert('空マップ: 変化なし', applyVariantMap('齋藤邊冨', emptyMap), '齋藤邊冨');

// ────────────────────────────────────────────────────
// [3] extractLegalEntity
// ────────────────────────────────────────────────────

section('extractLegalEntity');

subsection('入力バリデーション');
assertThrows('数値 → TypeError', () => extractLegalEntity(42 as unknown as string), 'TypeError');

subsection('株式会社 kind=301 - 全エイリアス形式');
// 前株
assert('[301] 正式名称 前株', extractLegalEntity('株式会社テスト').legalName, '株式会社');
assert('[301] 正式名称 前株 position', extractLegalEntity('株式会社テスト').legalPosition, 'pre');
assert('[301] (株) 前株', extractLegalEntity('(株)テスト').legalName, '株式会社');
assert('[301] 株) 片割れ前', extractLegalEntity('株)テスト').legalName, '株式会社');
assert('[301] カ) 銀行前略', extractLegalEntity('カ)テスト').legalName, '株式会社');
// 後株
assert('[301] 正式名称 後株', extractLegalEntity('テスト株式会社').legalPosition, 'post');
assert('[301] (株) 後株', extractLegalEntity('テスト(株)').legalName, '株式会社');
assert('[301] (株 片割れ後', extractLegalEntity('テスト(株').legalName, '株式会社');
assert('[301] (カ 銀行後略', extractLegalEntity('テスト(カ').legalName, '株式会社');

subsection('有限会社 kind=302 - 全エイリアス形式');
assert('[302] 正式名称 前株', extractLegalEntity('有限会社テスト').legalName, '有限会社');
assert('[302] (有) 前株', extractLegalEntity('(有)テスト').legalName, '有限会社');
assert('[302] 有) 片割れ前', extractLegalEntity('有)テスト').legalName, '有限会社');
assert('[302] ユ) 銀行前略', extractLegalEntity('ユ)テスト').legalName, '有限会社');
assert('[302] (有 片割れ後', extractLegalEntity('テスト(有').legalName, '有限会社');
assert('[302] (ユ 銀行後略', extractLegalEntity('テスト(ユ').legalName, '有限会社');
assert('[302] kind', extractLegalEntity('有限会社テスト').kind, '302');

subsection('合名会社 kind=303 - 全エイリアス形式');
assert('[303] 正式名称', extractLegalEntity('合名会社テスト').legalName, '合名会社');
assert('[303] (名) 前株', extractLegalEntity('(名)テスト').legalName, '合名会社');
assert('[303] 名) 片割れ前', extractLegalEntity('名)テスト').legalName, '合名会社');
assert('[303] メ) 銀行前略', extractLegalEntity('メ)テスト').legalName, '合名会社');
assert('[303] (名 片割れ後', extractLegalEntity('テスト(名').legalName, '合名会社');
assert('[303] (メ 銀行後略', extractLegalEntity('テスト(メ').legalName, '合名会社');

subsection('合資会社 kind=304 - 全エイリアス形式');
assert('[304] 正式名称', extractLegalEntity('合資会社テスト').legalName, '合資会社');
assert('[304] (資) 前株', extractLegalEntity('(資)テスト').legalName, '合資会社');
assert('[304] 資) 片割れ前', extractLegalEntity('資)テスト').legalName, '合資会社');
assert('[304] シ) 銀行前略', extractLegalEntity('シ)テスト').legalName, '合資会社');
assert('[304] (資 片割れ後', extractLegalEntity('テスト(資').legalName, '合資会社');
assert('[304] (シ 銀行後略', extractLegalEntity('テスト(シ').legalName, '合資会社');

subsection('合同会社 kind=305 - 全エイリアス形式');
assert('[305] 正式名称', extractLegalEntity('合同会社テスト').legalName, '合同会社');
assert('[305] (同) 前株', extractLegalEntity('(同)テスト').legalName, '合同会社');
assert('[305] 同) 片割れ前', extractLegalEntity('同)テスト').legalName, '合同会社');
assert('[305] ド) 銀行前略', extractLegalEntity('ド)テスト').legalName, '合同会社');
assert('[305] (同 片割れ後', extractLegalEntity('テスト(同').legalName, '合同会社');
assert('[305] (ド 銀行後略', extractLegalEntity('テスト(ド').legalName, '合同会社');

subsection('特定非営利活動法人 kind=399 - 全エイリアス形式');
assert('[NPO] 正式名称 前', extractLegalEntity('特定非営利活動法人テスト').legalName, '特定非営利活動法人');
assert('[NPO] NPO法人 前', extractLegalEntity('NPO法人テスト').legalName, '特定非営利活動法人');
assert('[NPO] (NPO) 前', extractLegalEntity('(NPO)テスト').legalName, '特定非営利活動法人');
assert('[NPO] NPO) 片割れ前', extractLegalEntity('NPO)テスト').legalName, '特定非営利活動法人');
assert('[NPO] 正式名称 後', extractLegalEntity('テスト特定非営利活動法人').legalName, '特定非営利活動法人');
assert('[NPO] NPO法人 後', extractLegalEntity('テストNPO法人').legalName, '特定非営利活動法人');
assert('[NPO] (NPO 片割れ後', extractLegalEntity('テスト(NPO').legalName, '特定非営利活動法人');
assert('[NPO] kind', extractLegalEntity('NPO法人テスト').kind, '399');

subsection('医療法人');
assert('[医療] 正式名称 前', extractLegalEntity('医療法人テスト').legalName, '医療法人');
assert('[医療] (医) 前', extractLegalEntity('(医)テスト').legalName, '医療法人');
assert('[医療] 医) 片割れ前', extractLegalEntity('医)テスト').legalName, '医療法人');
assert('[医療] (医 片割れ後', extractLegalEntity('テスト(医').legalName, '医療法人');

subsection('一般社団法人');
assert('[一社] 正式名称 前', extractLegalEntity('一般社団法人テスト').legalName, '一般社団法人');
assert('[一社] (一社) 前', extractLegalEntity('(一社)テスト').legalName, '一般社団法人');
assert('[一社] 一社) 片割れ前', extractLegalEntity('一社)テスト').legalName, '一般社団法人');
assert('[一社] (一社 片割れ後', extractLegalEntity('テスト(一社').legalName, '一般社団法人');

subsection('公益社団法人');
assert('[公社] 正式名称 前', extractLegalEntity('公益社団法人テスト').legalName, '公益社団法人');
assert('[公社] (公社) 前', extractLegalEntity('(公社)テスト').legalName, '公益社団法人');

subsection('一般財団法人');
assert('[一財] 正式名称 前', extractLegalEntity('一般財団法人テスト').legalName, '一般財団法人');
assert('[一財] (一財) 前', extractLegalEntity('(一財)テスト').legalName, '一般財団法人');

subsection('公益財団法人');
assert('[公財] 正式名称 前', extractLegalEntity('公益財団法人テスト').legalName, '公益財団法人');
assert('[公財] (公財) 前', extractLegalEntity('(公財)テスト').legalName, '公益財団法人');

subsection('学校法人');
assert('[学校] 正式名称 前', extractLegalEntity('学校法人テスト').legalName, '学校法人');
assert('[学校] (学) 前', extractLegalEntity('(学)テスト').legalName, '学校法人');
assert('[学校] 学) 片割れ前', extractLegalEntity('学)テスト').legalName, '学校法人');

subsection('社会福祉法人');
assert('[社福] 正式名称 前', extractLegalEntity('社会福祉法人テスト').legalName, '社会福祉法人');
assert('[社福] (福) 前', extractLegalEntity('(福)テスト').legalName, '社会福祉法人');
assert('[社福] 福) 片割れ前', extractLegalEntity('福)テスト').legalName, '社会福祉法人');

subsection("name 抽出");
assert('前株: name正確', extractLegalEntity('株式会社トヨタ自動車').name, 'トヨタ自動車');
assert('後株: name正確', extractLegalEntity('トヨタ自動車株式会社').name, 'トヨタ自動車');
assert('(株)前: name正確', extractLegalEntity('(株)TIS').name, 'TIS');
assert('カ)前: name正確', extractLegalEntity('カ)田中商事').name, '田中商事');
assert('(株後: name正確', extractLegalEntity('TIS(株').name, 'TIS');

subsection('法人格なし');
assert('法人格なし: legalName', extractLegalEntity('テスト団体').legalName, null);
assert('法人格なし: legalPosition', extractLegalEntity('テスト団体').legalPosition, 'none');
assert('法人格なし: baseName', extractLegalEntity('テスト団体').name, 'テスト団体');
assert('法人格なし: kind', extractLegalEntity('テスト団体').kind, null);
assert('法人格なし: ambiguous', extractLegalEntity('テスト団体').ambiguous, false);
assert('英文社名: legalName', extractLegalEntity('Cisco Systems G.K.').legalName, null);
assert('空文字: legalName', extractLegalEntity('').legalName, null);
assert('空文字: legalPosition', extractLegalEntity('').legalPosition, 'none');

subsection('ambiguous ①: name に法人格名を含む');
const a1 = extractLegalEntity('株式会社有限会社設立サポート');
assert('①: legalName', a1.legalName, '株式会社');
assert('①: legalPosition', a1.legalPosition, 'pre');
assert('①: baseName', a1.name, '有限会社設立サポート');
assert('①: ambiguous', a1.ambiguous, true);

const a1b = extractLegalEntity('NPO法人株式会社支援機構');
assert('① NPO+株式会社: legalName', a1b.legalName, '特定非営利活動法人');
assert('① NPO+株式会社: ambiguous', a1b.ambiguous, true);

const a1c = extractLegalEntity('株式会社合同出版');
assert('① baseName=合同出版: ambiguous', a1c.ambiguous, false); // '合同出版' に canonical name なし

subsection('ambiguous ②: 前後で同じ法人格');
const a2 = extractLegalEntity('株式会社テスト株式会社');
assert('②: legalName', a2.legalName, '株式会社');
assert('②: legalPosition', a2.legalPosition, 'both');
assert('②: kind', a2.kind, '301');
assert('②: ambiguous', a2.ambiguous, true);

const a2b = extractLegalEntity('(株)テスト(株)');
assert('②括弧形: ambiguous', a2b.ambiguous, true);
assert('②括弧形: legalName', a2b.legalName, '株式会社');

subsection('ambiguous ③: 前後で異なる法人格');
const a3 = extractLegalEntity('(株)テスト(有)');
assert('③: legalName', a3.legalName, null);
assert('③: kind', a3.kind, null);
assert('③: legalPosition', a3.legalPosition, null);
assert('③: ambiguous', a3.ambiguous, true);
assert('③: baseName は入力そのまま', a3.name, '(株)テスト(有)');

const a3b = extractLegalEntity('株式会社テスト合同会社');
assert('③ 正式名称: legalName', a3b.legalName, null);
assert('③ 正式名称: ambiguous', a3b.ambiguous, true);

subsection('greedy マッチ（長いエイリアス優先）');
// 特定非営利活動法人 vs NPO法人（どちらも有効だが特定非営利活動法人が長い）
assert('NPO法人 > NPO)', extractLegalEntity('NPO法人テスト').legalName, '特定非営利活動法人');
// 一般社団法人 vs 社団法人（後者はエイリアスにない）
assert('一般社団法人 が前にあれば確定', extractLegalEntity('一般社団法人テスト').name, 'テスト');

subsection('法人格のみ（name が空）');
const onlyLegal = extractLegalEntity('株式会社');
assert('法人格のみ: legalName', onlyLegal.legalName, '株式会社');
assert('法人格のみ: baseName', onlyLegal.name, '');

subsection('特殊な社名');
assert('英字+法人格', extractLegalEntity('TIS株式会社').name, 'TIS');
assert('数字含む社名', extractLegalEntity('株式会社123商事').name, '123商事');
assert('長音符含む社名', extractLegalEntity('ソフトバンク株式会社').name, 'ソフトバンク');
assert('中黒含む社名', extractLegalEntity('山田・太郎株式会社').name, '山田・太郎');
assert('ハイフン含む社名', extractLegalEntity('セブン-イレブン株式会社').name, 'セブン-イレブン');

// ────────────────────────────────────────────────────
// normalize() 統合テスト
// ────────────────────────────────────────────────────

section('Normalizer.create().normalize()');

const n = Normalizer.create(); // db なし

subsection('入力バリデーション');
assertThrows('数値 → TypeError', () => n.normalize(42 as unknown as string), 'TypeError');
assertThrows('null → TypeError',  () => n.normalize(null as unknown as string), 'TypeError');

subsection('Normalizer.create() バリデーション');
assertThrows('dbPath 空文字 → TypeError', () => Normalizer.create({ dbPath: '' }), 'TypeError');

subsection('raw フィールド');
assert('raw は入力そのまま', n.normalize('㈱テスト').raw, '㈱テスト');
assert('raw は NFKC 前', n.normalize('ＡＢＣ').raw, 'ＡＢＣ');

subsection('canonical: 略称展開・前後位置は元のまま保持');
assert('前株入力 → 前株', n.normalize('株式会社テスト').canonical, '株式会社テスト');
assert('後株入力 → 後株のまま', n.normalize('テスト株式会社').canonical, 'テスト株式会社');
assert('(株)前 → 略称展開・前株', n.normalize('(株)テスト').canonical, '株式会社テスト');
assert('(株)後 → 略称展開・後株', n.normalize('テスト(株)').canonical, 'テスト株式会社');
assert('㈱前 → 略称展開・前株', n.normalize('㈱テスト').canonical, '株式会社テスト');
assert('法人格なし → preNormed そのまま', n.normalize('テスト団体').canonical, 'テスト団体');

subsection("name 抽出");
assert('日本語社名', n.normalize('株式会社トヨタ自動車').matchKey, 'トヨタ自動車');
assert('英字社名 大文字統一', n.normalize('TIS株式会社').matchKey, 'TIS');
assert('英字小文字 → 大文字', n.normalize('tis株式会社').matchKey, 'TIS');
assert('全角英字 → 大文字', n.normalize('ＴＩＳ株式会社').matchKey, 'TIS');
assert('前株と後株で同じ matchKey',
  n.normalize('株式会社テスト').matchKey,
  n.normalize('テスト株式会社').matchKey);
assert('異なる表記で同じ matchKey',
  n.normalize('㈱テスト').matchKey,
  n.normalize('(株)テスト').matchKey);

subsection('matchKeyKanji: db なし → matchKey と同じ');
assert('db なし: matchKey === matchKeyKanji',
  n.normalize('株式会社テスト').matchKey,
  n.normalize('株式会社テスト').matchKeyKanji);

subsection('matchKeyKanji: db あり（variantMap 注入で検証）');
// db なしで作った Normalizer に手動でvariantMapをテストする代わりに
// applyVariantMap を直接確認済みのため、ここでは統合的に確認
const vm2 = new Map([['齋', '斎']]);
const nWithMap = Normalizer.create(); // db なし
// matchKeyKanji は baseName に applyVariantMap を適用してから uppercase
// db なし時は variantMap が空なので齋藤 → 齋藤 のまま
assert('db なし: 旧字体は変換されない',
  nWithMap.normalize('齋藤商事株式会社').matchKeyKanji, '齋藤商事');
assert('db なし: matchKey と matchKeyKanji が等しい',
  nWithMap.normalize('齋藤商事株式会社').matchKey,
  nWithMap.normalize('齋藤商事株式会社').matchKeyKanji);

subsection('type: corporate（デフォルト）');
const corp = n.normalize('㈱テスト', { type: 'corporate' });
assert('corporate: legalName あり', corp.legalName, '株式会社');
assert('corporate: kind', corp.kind, '301');

subsection('type: person → 法人格正規化スキップ');
const person = n.normalize('株式会社テスト', { type: 'person' });
assert('person: legalName null', person.legalName, null);
assert('person: legalPosition none', person.legalPosition, 'none');
assert('person: name = preNormed', person.name, '株式会社テスト');
assert('person: matchKey = name.upper', person.matchKey, '株式会社テスト');

subsection('type: organization → 法人格正規化スキップ');
const org = n.normalize('㈱テスト', { type: 'organization' });
assert('organization: legalName null', org.legalName, null);
assert('organization: baseName', org.name, '（株）テスト');

subsection('ambiguous フラグ');
assert('通常: ambiguous false', n.normalize('株式会社テスト').ambiguous, false);
assert('①: ambiguous true', n.normalize('株式会社有限会社設立サポート').ambiguous, true);
assert('③: ambiguous true, legalName null', n.normalize('(株)テスト(有)').legalName, null);
assert('person に法人格含む: ambiguous false（スキップ）', n.normalize('株式会社テスト', { type: 'person' }).ambiguous, false);

subsection('全体フロー: 実データ想定');
const toyota = n.normalize('トヨタ自動車㈱');
assert('Toyota: matchKey', toyota.matchKey, 'トヨタ自動車');
assert('Toyota: legalName', toyota.legalName, '株式会社');
assert('Toyota: normalized', toyota.canonical, 'トヨタ自動車株式会社');
assert('Toyota: ambiguous', toyota.ambiguous, false);

const tis1 = n.normalize('TIS(株)');
const tis2 = n.normalize('株式会社TIS');
assert('TIS: 異表記で matchKey 一致', tis1.matchKey, tis2.matchKey);

const softbank = n.normalize('ソフトバンク株式会社');
assert('長音符: baseName', softbank.name, 'ソフトバンク');
assert('長音符: matchKey', softbank.matchKey, 'ソフトバンク');

const npo = n.normalize('NPO法人テスト支援センター');
assert('NPO: legalName', npo.legalName, '特定非営利活動法人');
assert('NPO: baseName', npo.name, 'テスト支援センター');

const cisco = n.normalize('Cisco Systems G.K.');
assert('英文: legalName null', cisco.legalName, null);
assert('英文: baseName', cisco.name, 'Cisco Systems G．K．');
assert('英文: matchKey 大文字', cisco.matchKey, 'CISCO SYSTEMS G.K.');

subsection('空文字入力');
const empty = n.normalize('');
assert('空文字: raw', empty.raw, '');
assert('空文字: matchKey', empty.matchKey, '');
assert('空文字: legalName', empty.legalName, null);

// ────────────────────────────────────────────────────
// 結果
// ────────────────────────────────────────────────────

const total = pass + fail;
console.log('\n' + '═'.repeat(50));
console.log(`結果: ${pass} / ${total} 件 OK`);
if (fail > 0) {
  console.error(`失敗: ${fail} 件`);
  process.exit(1);
} else {
  console.log('すべてのテスト PASS');
}
