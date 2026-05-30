# normalizer

企業名・人名・団体名の正規化ライブラリ。**matchKey を正確に生成することだけ**を責務とし、ファジーマッチの前処理として機能します。

## 概要

入力の `name`（および任意の `kana`）に対して以下の処理を段階的に適用し、照合用キー（`matchKey` / `matchKeyKanji` / `kanaMatchKey`）と正規化名（`canonical`）を生成します。

```
{ name, kana? }
  ↓ [1] 基礎正規化（NFKC・記号統一・空白処理）
  ↓ [2] 字体正規化（matchKeyKanji のみ）
  ↓ [3] 法人格正規化（略称展開・除去）
  ↓ [4] matchKey 生成（大文字統一）
  ↓ [5] 幅変換（canonical / name / legalName / matchKey）
  ↓ [6] 読み仮名正規化（kana が渡された場合のみ）
出力: NormalizeResult
```

重複の確定判断やファジーマッチは呼び出し側の責務です。

```
matchKey 完全一致         → 高信頼度の重複候補
matchKeyKanji のみ一致   → 字体ゆれによる重複候補
kanaMatchKey のみ一致    → 読み方が同じ重複候補
どちらも不一致            → ファジーマッチ or 人手確認（呼び出し側）
```

---

## 動作要件

| 項目 | 要件 |
|---|---|
| 言語 | TypeScript |
| Node.js | 22.5.0 以上（24 LTS 推奨） |
| 外部依存 | **なし**（ゼロ依存） |
| SQLite | `node:sqlite`（Node.js 組み込み）※字体正規化を使う場合のみ |

---

## クイックスタート

### 基本（name のみ）

```typescript
import { Normalizer } from './src/index.js';

const normalizer = Normalizer.create();

const result = normalizer.normalize({ name: '㈱トヨタ自動車' });
console.log(result.canonical);   // "株式会社トヨタ自動車"（略称展開・前株のまま）
console.log(result.legalName);   // "株式会社"
console.log(result.name);        // "トヨタ自動車"
console.log(result.matchKey);    // "トヨタ自動車"

// 後株は後株のまま
normalizer.normalize({ name: 'トヨタ自動車(株)' }).canonical;
// → "トヨタ自動車株式会社"
```

### 読み仮名も渡す

```typescript
const result = normalizer.normalize({
  name: 'トヨタ自動車株式会社',
  kana: 'トヨタジドウシャカブシキガイシャ',
});
console.log(result.kana);          // "トヨタジドウシャカブシキガイシャ"
console.log(result.kanaMatchKey);  // "トヨタジドウシャ"（法人格のカナを除去・小書き展開）
```

### 字体正規化あり

```typescript
const normalizer = Normalizer.create({
  dbPath: resolve('./data/character_variants.db'),
});
normalizer.normalize({ name: '齋藤商事株式会社' }).matchKey;      // "齋藤商事"
normalizer.normalize({ name: '齋藤商事株式会社' }).matchKeyKanji; // "斎藤商事"
```

---

## API リファレンス

### `Normalizer.create(options?)`

```typescript
Normalizer.create(options?: NormalizerOptions): NormalizerInstance
```

**`NormalizerOptions`**

| プロパティ | 型 | 説明 |
|---|---|---|
| `dbPath` | `string` | `character_variants.db` の絶対パス。指定すると字体正規化が有効になる |
| `classWidth` | `ClassWidthConfig` | 文字クラス別の幅設定（グローバルデフォルトを上書き） |
| `fields.canonical` | `FieldWidthConfig` | `canonical` / `name` / `legalName` フィールドの幅設定 |
| `fields.matchKey` | `FieldWidthConfig` | `matchKey` / `matchKeyKanji` フィールドの幅設定 |
| `kana` | `KanaOptions` | 読み仮名正規化オプション |

`dbPath` に空文字を渡すと `TypeError`。`kana.allowCharClass` が不正な場合も `TypeError`。

---

### `normalizer.normalize(raw)`

```typescript
normalize(raw: { name: string; kana?: string }): NormalizeResult
```

- `raw` がオブジェクトでない、または `raw.name` が文字列でない場合は `TypeError`
- `kana` を省略すると `kana` / `kanaMatchKey` フィールドは出力に含まれない

---

### `NormalizeResult`

| プロパティ | 型 | 説明 |
|---|---|---|
| `raw` | `string` | `raw.name` 入力そのまま（NFKC 前） |
| `canonical` | `string` | 略称を正式名称に展開した正規化名。前後位置は元のまま保持。幅変換適用済み |
| `name` | `string` | 法人格除去後の本体名。幅変換適用済み |
| `legalName` | `string \| null` | 検出した法人格の正式名称（例: `"株式会社"`）。幅変換適用済み |
| `legalPosition` | `LegalPosition \| null` | 法人格の位置 |
| `kind` | `string \| null` | 国税庁 kind コード（例: `"301"`） |
| `matchKey` | `string` | 元字体ベースの照合キー（大文字統一・常に半角） |
| `matchKeyKanji` | `string` | 通用字体ベースの照合キー（大文字統一・常に半角） |
| `ambiguous` | `boolean` | `true` = 法人格の確信が持てない（人手確認推奨） |
| `kana` | `string` *(省略可)* | 正規化済み読み仮名（`raw.kana` を渡した場合のみ） |
| `kanaMatchKey` | `string` *(省略可)* | 読み仮名照合キー（法人格カナ除去・小書き展開済み） |

**`canonical` の挙動**:

```
"(株)テスト"      → "株式会社テスト"   （前株 → 前株・略称展開）
"テスト(株)"      → "テスト株式会社"   （後株 → 後株・略称展開）
"テスト株式会社"  → "テスト株式会社"   （変化なし）
```

**`LegalPosition`**:

| 値 | 説明 |
|---|---|
| `'pre'` | 法人格が先頭（前株） |
| `'post'` | 法人格が末尾（後株） |
| `'both'` | 前後両方に同じ法人格が検出された |
| `'none'` | 法人格なし |
| `null` | 前後で異なる法人格が検出された（`ambiguous: true` のみ） |

---

## 処理フロー詳細

### [1] 基礎正規化（全入力共通）

`preNormalize()` が担当します。

| ステップ | 対象 | 変換内容 |
|---|---|---|
| ① NFKC | 全角英数字・記号、半角カナ、`㈱` 等 | 半角 ASCII・全角カナに変換（例: `㈱` → `(株)`） |
| ② ハイフン統一 | U+2010〜2015、U+2212 | → `-`（U+002D） |
| ② ソフトハイフン削除 | U+00AD | → 削除 |
| ② 中黒統一 | U+00B7、U+2027 | → `・`（U+30FB） |
| ② 波線統一 | U+301C | → `~`（U+007E） |
| ③ NBSP 系 | U+00A0、U+202F | → 半角スペース |
| ③ ゼロ幅文字 | U+200B、U+FEFF | → 削除 |
| ③ 多重空白 | 連続スペース | → 1 文字 |
| ③ trim | 前後の空白 | → 除去 |

**触らないもの**: `ー`（U+30FC）、`、`（U+3001）、`。`（U+3002）、各種括弧

べき等です（2 回適用しても結果は変わりません）。

---

### [2] 字体正規化（matchKeyKanji のみ）

`variantMap.ts` が担当します。IPA MJ縮退マップ（[https://moji.or.jp/mojikiban/map/](https://moji.or.jp/mojikiban/map/)）を元に生成した SQLite DB を使用します。

起動時に 1 回だけ DB を読み込み、`Map<string, string>` に展開して O(1) でルックアップします。

**DB スキーマ**:

```sql
CREATE TABLE character_variants (
  variant   TEXT PRIMARY KEY,
  canonical TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'MJ'
);
CREATE INDEX idx_variant ON character_variants(variant);
```

DB なし時は `matchKey === matchKeyKanji`。

---

### [3] 法人格正規化

`extractLegalEntity()` が担当します。先頭・末尾からエイリアスを greedy マッチ（長いエイリアス優先）します。

**対応法人格一覧**（NFKC 適用後の表記）:

| 法人格 | kind | 読み（kanaCanonical） | 完全形・括弧略称 | カナ略称 | 片割れ前 | 片割れ後 |
|---|---|---|---|---|---|---|
| 株式会社 | 301 | カブシキガイシャ | `株式会社` `(株)` | `(カ)` `(カブ)` | `株)` `カ)` `カブ)` | `(株` `(カ` `(カブ` |
| 有限会社 | 302 | ユウゲンガイシャ | `有限会社` `(有)` | `(ユ)` `(ユウ)` | `有)` `ユ)` `ユウ)` | `(有` `(ユ` `(ユウ` |
| 合名会社 | 303 | ゴウメイガイシャ | `合名会社` `(名)` | `(メ)` `(メイ)` | `名)` `メ)` `メイ)` | `(名` `(メ` `(メイ` |
| 合資会社 | 304 | ゴウシガイシャ | `合資会社` `(資)` | `(シ)` | `資)` `シ)` | `(資` `(シ` |
| 合同会社 | 305 | ゴウドウガイシャ | `合同会社` `(同)` | `(ド)` `(ドウ)` | `同)` `ド)` `ドウ)` | `(同` `(ド` `(ドウ` |
| 医療法人 | 399 | イリョウホウジン | `医療法人` `(医)` | `(イ)` | `医)` `イ)` | `(医` `(イ` |
| 一般社団法人 | 399 | イッパンシャダンホウジン | `一般社団法人` `(一社)` | `(イッシャ)` | `一社)` `イッシャ)` | `(一社` `(イッシャ` |
| 公益社団法人 | 399 | コウエキシャダンホウジン | `公益社団法人` `(公社)` | `(コウシャ)` | `公社)` `コウシャ)` | `(公社` `(コウシャ` |
| 一般財団法人 | 399 | イッパンザイダンホウジン | `一般財団法人` `(一財)` | `(イチザイ)` | `一財)` `イチザイ)` | `(一財` `(イチザイ` |
| 公益財団法人 | 399 | コウエキザイダンホウジン | `公益財団法人` `(公財)` | `(コウザイ)` | `公財)` `コウザイ)` | `(公財` `(コウザイ` |
| 特定非営利活動法人 | 399 | トクテイヒエイリカツドウホウジン | `特定非営利活動法人` `NPO法人` `(NPO)` | — | `NPO)` | `(NPO` |
| 学校法人 | 399 | ガッコウホウジン | `学校法人` `(学)` | `(ガク)` | `学)` `ガク)` | `(学` `(ガク` |
| 社会福祉法人 | 399 | シャカイフクシホウジン | `社会福祉法人` `(福)` | `(フク)` | `福)` `フク)` | `(福` `(フク` |

全角括弧は NFKC で半角化済みのため、エイリアスはすべて半角括弧で定義されています。

---

### [4] matchKey 生成

| キー | 処理 |
|---|---|
| `matchKey` | `name`.toUpperCase() → 幅変換（常に全半角） |
| `matchKeyKanji` | 字体正規化後の `name`.toUpperCase() → 幅変換（常に全半角） |

前株・後株・括弧形など異なる表記でも同一法人なら一致します:

```typescript
normalize({ name: '株式会社TIS' }).matchKey  // "TIS"
normalize({ name: 'TIS(株)'    }).matchKey  // "TIS"
normalize({ name: 'ＴＩＳ株式会社' }).matchKey  // "TIS"
```

---

### [5] 幅変換

`width.ts` の `applyWidth()` が担当します。ASCII 文字（U+0021〜U+007E）を文字クラスごとに半角・全角に変換します。

**文字クラス**:

| クラス | 対象 |
|---|---|
| `digit` | `0`–`9` |
| `alpha` | `A`–`Z`、`a`–`z` |
| `symbol` | `!`–`/`、`:`–`@`、`[`–`` ` ``、`{`–`~` |
| `default` | それ以外（カナ・漢字等） |

**デフォルト設定**（日本語システム標準）:

| クラス | デフォルト |
|---|---|
| `digit` | `half` |
| `alpha` | `half` |
| `symbol` | `full`（`.` `(` `)` 等が全角になる） |
| `default` | `half` |

**matchKey は設定によらず常に全半角。**

**カスタマイズ例**:

```typescript
// グローバルで記号も半角
Normalizer.create({ classWidth: { symbol: 'half' } });

// canonical フィールドだけ記号を半角
Normalizer.create({ fields: { canonical: { classWidth: { symbol: 'half' } } } });
```

---

### [6] 読み仮名正規化（kana を渡した場合のみ）

`kana.ts` が担当します。`raw.kana` を渡したときのみ実行され、`kana` / `kanaMatchKey` が出力に追加されます。

**`KanaOptions`**:

| プロパティ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `kanaMode` | `'katakana' \| 'hiragana'` | `'katakana'` | 出力のかな種別 |
| `allowCharClass` | `string` | `''` | 無効文字除去の例外。正規表現文字クラス文字列で指定（例: `'\\-=0-9'`） |

`allowCharClass` が 500 文字超、未エスケープの `]` を含む、または不正な正規表現の場合は `TypeError`。

**処理フロー（processKana）**:

1. `preNormalize(rawKana)` で基礎正規化
2. `extractLegalEntity()` で法人格を best-effort 検出
3. 法人格が検出できた場合（`ambiguous` でない）、法人格部分を `kanaCanonical`（カタカナ正式名称）に置換して `kanaRaw` を組み立て
4. `kanaMode` に応じてひらがな⇔カタカナ変換
5. **`kana`（表示用）**: 無効文字（かな・スペース・`allowCharClass` 以外）を空白置換 → 多重空白圧縮 → trim
6. **`kanaMatchKey`（照合用）**: 小書き仮名を通常仮名に展開（`ぁ→あ`、`ァ→ア` 等）→ かな文字のみ残す（スペース・記号を除去）

```typescript
const n = Normalizer.create();

n.normalize({ name: '株式会社テスト', kana: 'カブシキガイシャテスト' })
// kana:         "カブシキガイシャテスト"
// kanaMatchKey: "テスト"（法人格カナを除去）

n.normalize({ name: '株式会社テスト', kana: 'かぶしきがいしゃてすと' })
// kana:         "カブシキガイシャテスト"（ひらがな → カタカナに変換）
// kanaMatchKey: "テスト"

// hiragana モード
const nHira = Normalizer.create({ kana: { kanaMode: 'hiragana' } });
nHira.normalize({ name: '株式会社テスト', kana: 'カブシキガイシャテスト' })
// kana: "かぶしきがいしゃてすと"
```

---

## ambiguous フラグ

| # | 条件 | legalName | kind | legalPosition |
|---|---|---|---|---|
| ① | 除去後の `name` に法人格 canonical 名を含む | 検出値 | 検出値 | `'pre'` or `'post'` |
| ② | 前後で同じ法人格がマッチ | 検出値 | 検出値 | `'both'` |
| ③ | 前後で異なる法人格がマッチ | `null` | `null` | `null` |

```typescript
// ③ name は入力そのまま
normalize({ name: '(株)テスト(有)' })
// { legalName: null, legalPosition: null, name: "(株)テスト(有)", ambiguous: true }
```

---

## DB の生成（字体正規化を使う場合）

1. [IPA MJ縮退マップ](https://moji.or.jp/mojikiban/map/) から `MJShrinkMap.json` をダウンロード
2. `build/mj-source/` に配置
3. 実行

```bash
tsx normalizer/build/generate-db.ts
# パスを明示する場合
tsx normalizer/build/generate-db.ts path/to/MJShrinkMap.json
```

生成ルール：私用領域除外・自己参照除外・`一意: true` 優先・初出のみ採用。

---

## テスト実行

```bash
tsx normalizer/test/normalize.test.ts
tsx normalizer/test/normalize.comprehensive.test.ts
```

---

## スコープ外

- インボイス番号照合
- ファジーマッチ実装
- 法人番号 API 連携
- 重複の最終確定判断
- 姓名分離

---

## ディレクトリ構成

```
normalizer/
  README.md
  DESIGN.md
  src/
    index.ts          公開 API エントリーポイント
    normalize.ts      Normalizer ファクトリ・オーケストレーション
    preNormalize.ts   [1] 基礎正規化
    variantMap.ts     [2] 字体正規化（DB ロード・applyVariantMap）
    legalEntity.ts    [3] 法人格正規化
    width.ts          [5] 幅変換（half ↔ full）
    kana.ts           [6] 読み仮名正規化
    types.ts          共通型定義
  build/
    generate-db.ts    MJ縮退マップ JSON → character_variants.db 生成
    mj-source/        MJShrinkMap.json の配置場所
  data/
    character_variants.db   字体正規化 DB（generate-db.ts で生成）
  test/
    normalize.test.ts
    normalize.comprehensive.test.ts
```
