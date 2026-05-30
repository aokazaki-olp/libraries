# normalizer

企業名・人名・団体名の正規化ライブラリ。**matchKey を正確に生成することだけ**を責務とし、ファジーマッチの前処理として機能します。

## 概要

入力文字列に対して以下の処理を段階的に適用し、照合用キー（`matchKey` / `matchKeyKanji`）と表示用正規化名（`normalized`）を生成します。

```
入力文字列
  ↓ [1] 基礎正規化（全種別共通）
  ↓ [2] 字体正規化（matchKeyKanji のみ）
  ↓ [3] 法人格正規化（corporate のみ）
  ↓ [4] matchKey 生成
出力: NormalizeResult
```

重複の確定判断やファジーマッチは呼び出し側の責務です。このライブラリはその前段階を担います。

```
matchKey 完全一致       → 高信頼度の重複候補
matchKeyKanji のみ一致  → 字体ゆれによる重複候補
どちらも不一致          → ファジーマッチ or 人手確認（呼び出し側）
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

### 字体正規化なし（DB 不要）

```typescript
import { Normalizer } from './src/index.js';

const normalizer = Normalizer.create();

const result = normalizer.normalize('㈱トヨタ自動車');
console.log(result.normalized);     // "株式会社トヨタ自動車"
console.log(result.legalName);      // "株式会社"
console.log(result.baseName);       // "トヨタ自動車"
console.log(result.matchKey);       // "トヨタ自動車"
console.log(result.matchKeyKanji);  // "トヨタ自動車"（DB なし時は字体変換なし）
```

### 字体正規化あり（DB を生成してから使う）

```typescript
import { Normalizer } from './src/index.js';
import { resolve } from 'node:path';

const normalizer = Normalizer.create({
  dbPath: resolve('./data/character_variants.db'),
});

const result = normalizer.normalize('齋藤商事株式会社');
console.log(result.matchKey);       // "齋藤商事"（元字体のまま）
console.log(result.matchKeyKanji);  // "斎藤商事"（通用字体に変換）
```

### エンティティ種別の指定

```typescript
// 個人名: 法人格処理をスキップ
const person = normalizer.normalize('田中太郎', { type: 'person' });
console.log(person.legalName);  // null
console.log(person.baseName);   // "田中太郎"

// 団体名: 法人格処理をスキップ
const org = normalizer.normalize('テスト協会', { type: 'organization' });
console.log(org.legalName);     // null
```

---

## API リファレンス

### `Normalizer.create(options?)`

Normalizer インスタンスを生成するファクトリ関数。`dbPath` を指定すると起動時に DB を読み込み、字体正規化が有効になります。

```typescript
const normalizer = Normalizer.create(options?: NormalizerOptions): NormalizerInstance
```

**`NormalizerOptions`**

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `dbPath` | `string` | 任意 | `character_variants.db` の絶対パス |

- `dbPath` を省略すると字体正規化はスキップされ（`matchKey === matchKeyKanji`）、DB なしで動作します
- `dbPath` に空文字を渡すと `TypeError` をスローします

---

### `normalizer.normalize(raw, options?)`

文字列を正規化して `NormalizeResult` を返します。

```typescript
normalize(raw: string, options?: NormalizeOptions): NormalizeResult
```

**`NormalizeOptions`**

| プロパティ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `type` | `EntityType` | `'corporate'` | エンティティ種別 |

**`EntityType`**

| 値 | 法人格処理 | 説明 |
|---|---|---|
| `'corporate'` | あり | 法人（法人格を検出・除去） |
| `'person'` | なし | 個人名 |
| `'organization'` | なし | 団体名 |

`raw` が文字列でない場合は `TypeError` をスローします。

---

### `NormalizeResult`

| プロパティ | 型 | 説明 |
|---|---|---|
| `raw` | `string` | 入力そのまま（NFKC 前） |
| `normalized` | `string` | 表示用正規化名（法人格を前株形式で先頭に統一） |
| `baseName` | `string` | 法人格除去後の本体名 |
| `legalName` | `string \| null` | 検出した法人格の canonical 名（例: `"株式会社"`） |
| `legalPosition` | `LegalPosition \| null` | 法人格の位置 |
| `kind` | `string \| null` | 国税庁 kind コード（例: `"301"`） |
| `matchKey` | `string` | 元字体ベースの照合キー（大文字統一済み） |
| `matchKeyKanji` | `string` | 通用字体ベースの照合キー（大文字統一済み） |
| `ambiguous` | `boolean` | `true` = 法人格の確信が持てない（人手確認推奨） |

**`LegalPosition`**

| 値 | 説明 |
|---|---|
| `'pre'` | 法人格が先頭（前株） |
| `'post'` | 法人格が末尾（後株） |
| `'both'` | 前後両方に同じ法人格が検出された |
| `'none'` | 法人格なし |
| `null` | 前後で異なる法人格が検出された（`ambiguous: true` のみ） |

---

## 処理フロー詳細

### [1] 基礎正規化（全種別共通）

`preNormalize()` が担当します。

| ステップ | 対象 | 変換内容 |
|---|---|---|
| ① NFKC 正規化 | 全角英数字・記号、半角カナ、`㈱` 等 | 半角 ASCII・全角カナに変換（例: `㈱` → `(株)`） |
| ② ハイフン統一 | U+2010〜2015、U+2212 | → U+002D（`-`） |
| ② ソフトハイフン削除 | U+00AD | → 削除 |
| ② 中黒統一 | U+00B7、U+2027 | → U+30FB（`・`）※U+FF65 は NFKC で処理済み |
| ② 波線統一 | U+301C | → U+007E（`~`）※U+FF5E は NFKC で処理済み |
| ③ NBSP 系→半角スペース | U+00A0、U+202F | → U+0020 |
| ③ ゼロ幅文字削除 | U+200B、U+FEFF | → 削除 |
| ③ 多重空白圧縮 | 連続するスペース | → 1 文字 |
| ③ trim | 前後の空白 | → 除去 |

**触らないもの**: U+30FC（長音符 `ー`）、U+3001（読点 `、`）、U+3002（句点 `。`）、各種括弧

`preNormalize` はべき等です（2 回適用しても結果は変わりません）。

---

### [2] 字体正規化（matchKeyKanji のみ）

`variantMap.ts` の `loadVariantMap()` / `applyVariantMap()` が担当します。

**データソース**: IPA MJ縮退マップ（[https://moji.or.jp/mojikiban/map/](https://moji.or.jp/mojikiban/map/)）  
**フォーマット**: JSON（`MJShrinkMap.json`）  
**ストレージ**: `node:sqlite`（Node.js 組み込み、ゼロ依存）

`Normalizer.create({ dbPath })` の呼び出し時に DB を 1 回だけ読み込み、`Map<string, string>` に展開して以降は O(1) でルックアップします。

**DB スキーマ**:

```sql
CREATE TABLE character_variants (
  variant   TEXT PRIMARY KEY,  -- 旧字体・異体字
  canonical TEXT NOT NULL,     -- 通用字体
  source    TEXT NOT NULL DEFAULT 'MJ'
);
CREATE INDEX idx_variant ON character_variants(variant);
```

**字体正規化の原則**（同じ字の字体ゆれのみ対象）:

| 正規化する（字体ゆれ） | しない（別字） |
|---|---|
| 齋/齊 → 斎/斉 | 藤 ≠ 東 |
| 邊/邉 → 辺 | 田 ≠ 多 |
| 冨 → 富 | |
| 髙 → 高 | |

DB なし時は `matchKey === matchKeyKanji`（字体変換は行われません）。

---

### [3] 法人格正規化（corporate のみ）

`extractLegalEntity()` が担当します。基礎正規化済み文字列の先頭・末尾からエイリアスを greedy マッチ（長いエイリアス優先）します。

**対応法人格一覧**（NFKC 適用後の表記で定義）:

| 法人格 | kind | 完全形 | 片割れ（行頭用） | 片割れ（行末用） | 銀行系（行頭） | 銀行系（行末） |
|---|---|---|---|---|---|---|
| 株式会社 | 301 | `(株)` | `株)` | `(株` | `カ)` | `(カ` |
| 有限会社 | 302 | `(有)` | `有)` | `(有` | `ユ)` | `(ユ` |
| 合名会社 | 303 | `(名)` | `名)` | `(名` | `メ)` | `(メ` |
| 合資会社 | 304 | `(資)` | `資)` | `(資` | `シ)` | `(シ` |
| 合同会社 | 305 | `(同)` | `同)` | `(同` | `ド)` | `(ド` |
| 医療法人 | 399 | `(医)` | `医)` | `(医` | — | — |
| 一般社団法人 | 399 | `(一社)` | `一社)` | `(一社` | — | — |
| 公益社団法人 | 399 | `(公社)` | `公社)` | `(公社` | — | — |
| 一般財団法人 | 399 | `(一財)` | `一財)` | `(一財` | — | — |
| 公益財団法人 | 399 | `(公財)` | `公財)` | `(公財` | — | — |
| 特定非営利活動法人 | 399 | `NPO法人` `(NPO)` | `NPO)` | `(NPO` | — | — |
| 学校法人 | 399 | `(学)` | `学)` | `(学` | — | — |
| 社会福祉法人 | 399 | `(福)` | `福)` | `(福` | — | — |

全角括弧は NFKC で半角化済みであるため、エイリアスはすべて半角括弧で定義されています。

**対応していないエイリアス**:

| 例 | 非対応の理由 |
|---|---|
| `K.K.` `GK` | 英文コンテキストは範囲外 |
| `LLC` `Inc.` | 国内法人と断定できない |
| `合同` `有限`（単体） | 誤検知リスク |

---

### [4] matchKey 生成

| キー | 適用処理 |
|---|---|
| `matchKey` | [1] 基礎正規化後の `baseName`.toUpperCase() |
| `matchKeyKanji` | [2] 字体正規化を適用した `baseName`.toUpperCase() |

前株・後株・括弧形など異なる表記であっても、同一法人であれば `matchKey` は一致します。

```typescript
normalize('株式会社TIS').matchKey  // "TIS"
normalize('TIS(株)').matchKey      // "TIS"
normalize('ＴＩＳ株式会社').matchKey // "TIS"  ← 全角英字も統一
```

---

## ambiguous フラグ

以下の条件で `ambiguous: true` になります。呼び出し側は人手確認フローへ誘導することを推奨します。

| # | 条件 | legalName | kind | legalPosition |
|---|---|---|---|---|
| ① | 除去後の `baseName` に法人格 canonical 名を含む | 検出値 | 検出値 | `'pre'` or `'post'` |
| ② | 前後で同じ法人格がマッチ | 検出値 | 検出値 | `'both'` |
| ③ | 前後で異なる法人格がマッチ | `null` | `null` | `null` |

```typescript
// ① baseName に法人格名を含む → 前株優先で legalName を決定
normalize('株式会社有限会社設立サポート')
// { legalName: "株式会社", baseName: "有限会社設立サポート", ambiguous: true }

// ② 前後で同じ法人格
normalize('(株)テスト(株)')
// { legalName: "株式会社", legalPosition: "both", ambiguous: true }

// ③ 前後で異なる法人格 → legalName は null、baseName は入力そのまま
normalize('(株)テスト(有)')
// { legalName: null, kind: null, legalPosition: null, baseName: "(株)テスト(有)", ambiguous: true }
```

なお、`baseName` に法人格名の一部（例: `合同出版` の `合同`）が含まれても、canonical 名と完全一致しなければ `ambiguous: false` になります。

---

## 使用例

```typescript
const n = Normalizer.create();

// 全角英字を含む法人名
n.normalize('ＴＩＳ株式会社')
// { matchKey: "TIS", legalName: "株式会社", normalized: "株式会社TIS", ... }

// 銀行振込系略称（前株）
n.normalize('カ)田中商事')
// { legalName: "株式会社", legalPosition: "pre", baseName: "田中商事", ... }

// 片割れ括弧（行末）
n.normalize('田中商事(株')
// { legalName: "株式会社", legalPosition: "post", baseName: "田中商事", ... }

// NPO 法人
n.normalize('NPO法人テスト支援センター')
// { legalName: "特定非営利活動法人", baseName: "テスト支援センター", ... }

// 長音符を含む社名（変換しない）
n.normalize('ソフトバンク株式会社')
// { baseName: "ソフトバンク", matchKey: "ソフトバンク", ... }

// 英文入力（法人格検出不可）
n.normalize('Cisco Systems G.K.')
// { legalName: null, baseName: "Cisco Systems G.K.", matchKey: "CISCO SYSTEMS G.K.", ... }

// 空文字
n.normalize('')
// { raw: "", matchKey: "", legalName: null, ... }
```

---

## DB の生成（字体正規化を使う場合）

### 手順

1. [IPA MJ縮退マップ](https://moji.or.jp/mojikiban/map/) から `MJShrinkMap.json` をダウンロード
2. `build/mj-source/` に配置
3. スクリプトを実行

```bash
tsx normalizer/build/generate-db.ts
# または JSON パスを明示
tsx normalizer/build/generate-db.ts path/to/MJShrinkMap.json
```

`data/character_variants.db` が生成されます。

### generate-db.ts の動作

`MJShrinkMap.json` の各エントリを以下のルールで処理します：

| 条件 | 処理 |
|---|---|
| `実装したUCS` または `縮退先` が未設定 | スキップ |
| 私用領域（U+E000〜F8FF 等）の文字 | スキップ |
| `variant === canonical`（自己参照） | スキップ |
| `縮退先` に `一意: true` のエントリがある | そのエントリの `UCS` を canonical として採用 |
| `一意: true` がない | `縮退先` の先頭エントリを採用 |
| 同じ `variant` が複数回出現 | 初出のみ採用 |

---

## テスト実行

```bash
# 基本動作確認
tsx normalizer/test/normalize.test.ts

# 網羅的テスト
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
  README.md                             # 本ドキュメント
  DESIGN.md                             # 設計定義書（詳細）
  src/
    index.ts                            # 公開 API エントリーポイント
    normalize.ts                        # Normalizer ファクトリ・オーケストレーション
    preNormalize.ts                     # [1] 基礎正規化
    variantMap.ts                       # [2] 字体正規化（DB ロード・applyVariantMap）
    legalEntity.ts                      # [3] 法人格正規化
    types.ts                            # 共通型定義
  build/
    generate-db.ts                      # MJ縮退マップ JSON → character_variants.db 生成
    mj-source/                          # MJShrinkMap.json の配置場所
  data/
    character_variants.db               # 字体正規化 DB（generate-db.ts で生成）
  test/
    normalize.test.ts                   # 基本動作確認テスト
    normalize.comprehensive.test.ts     # 網羅的テスト
```
