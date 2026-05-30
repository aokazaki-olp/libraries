# normalizer

企業名・人名・団体名の正規化ライブラリ。**matchKey を正確に生成すること**を唯一の責務とし、ファジーマッチの前処理として機能します。

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

matchKey の一致度と重複確定の判断は呼び出し側の責務です。このライブラリはその前段階を担います。

```
matchKey 完全一致       → 高信頼度の重複候補
matchKeyKanji のみ一致  → 字体ゆれによる重複候補
どちらも不一致          → ファジーマッチ or 人手確認（呼び出し側）
```

---

## インストール・動作要件

| 項目 | 要件 |
|---|---|
| 言語 | TypeScript |
| Node.js | 22.5.0 以上（24 LTS 推奨） |
| 外部依存 | **なし**（ゼロ依存） |
| SQLite | `node:sqlite`（Node.js 組み込み） ※字体正規化を使う場合のみ |

字体正規化（`matchKeyKanji`）を有効にするには、`build/generate-db.ts` で生成した `data/character_variants.db` が必要です。

---

## 基本的な使い方

### 字体正規化なし（dbPath 省略）

```typescript
import { Normalizer } from './src/index.js';

const normalizer = Normalizer.create();

const result = normalizer.normalize('㈱トヨタ自動車');
console.log(result.normalized);     // "株式会社トヨタ自動車"
console.log(result.legalName);      // "株式会社"
console.log(result.baseName);       // "トヨタ自動車"
console.log(result.matchKey);       // "トヨタ自動車"
console.log(result.matchKeyKanji);  // "トヨタ自動車"（DB なしは字体正規化なし）
```

### 字体正規化あり（dbPath 指定）

```typescript
import { Normalizer } from './src/index.js';
import { resolve } from 'node:path';

const normalizer = Normalizer.create({
  dbPath: resolve('./data/character_variants.db'),
});

const result = normalizer.normalize('齋藤商事株式会社');
console.log(result.matchKey);       // "齋藤商事"（元字体）
console.log(result.matchKeyKanji);  // "斎藤商事"（通用字体）
```

### 人名・団体名（type 指定）

```typescript
const result = normalizer.normalize('田中太郎', { type: 'person' });
// 法人格処理をスキップ
console.log(result.legalName);  // null
console.log(result.baseName);   // "田中太郎"
```

---

## API リファレンス

### `Normalizer.create(options?)`

Normalizer インスタンスを生成するファクトリ関数。

```typescript
const normalizer = Normalizer.create(options?: NormalizerOptions): NormalizerInstance
```

**`NormalizerOptions`**

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| `dbPath` | `string` | 任意 | `character_variants.db` の絶対パス。指定すると字体正規化が有効になる |

`dbPath` を空文字で渡すと `TypeError` をスローします。

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

| 値 | 説明 |
|---|---|
| `'corporate'` | 法人（法人格正規化を適用） |
| `'person'` | 個人（法人格処理をスキップ） |
| `'organization'` | 団体（法人格処理をスキップ） |

`raw` が文字列でない場合は `TypeError` をスローします。

---

### `NormalizeResult`

`normalize()` の戻り値。

| プロパティ | 型 | 説明 |
|---|---|---|
| `raw` | `string` | 入力そのまま |
| `normalized` | `string` | 表示用正規化名（法人格を前株に統一して再組み立て） |
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
| `null` | 前後で異なる法人格が検出された（ambiguous） |

---

## 処理フロー詳細

### [1] 基礎正規化（全種別共通）

`preNormalize()` が担当します。

| ステップ | 内容 |
|---|---|
| ① NFKC 正規化 | 全角英数字・記号 → 半角 ASCII、`㈱` → `(株)` 等 |
| ② ハイフン統一 | U+2010〜2015、U+2212 など → U+002D（`-`） |
| ② ソフトハイフン削除 | U+00AD → 削除 |
| ② 中黒統一 | U+00B7、U+2027 → U+30FB（`・`） |
| ② 波線統一 | U+301C → U+007E（`~`） |
| ③ NBSP 系 → 半角スペース | U+00A0、U+202F → U+0020 |
| ③ ゼロ幅文字削除 | U+200B、U+FEFF → 削除 |
| ③ 多重空白 → 1 文字 | `"A  B"` → `"A B"` |
| ③ trim | 前後の空白を除去 |

**触らないもの**: U+30FC（長音符 `ー`）、U+3001（読点）、U+3002（句点）、各種括弧

### [2] 字体正規化（matchKeyKanji のみ）

IPA MJ文字図鑑（約 6 万字、CC BY 2.1 JP）を元に生成した SQLite DB を使用します。

| 正規化する（字体ゆれ） | しない（別字） |
|---|---|
| 齋/齊 → 斎/斉 | 藤 ≠ 東 |
| 邊/邉 → 辺 | 田 ≠ 多 |
| 冨 → 富 | |
| 髙 → 高 | |

ランタイムでは起動時に 1 回だけ DB を読み込み、`Map<string, string>` に展開して O(1) でルックアップします。

**DB スキーマ**:

```sql
CREATE TABLE character_variants (
  variant   TEXT PRIMARY KEY,  -- 旧字体・異体字
  canonical TEXT NOT NULL,     -- 通用字体
  source    TEXT DEFAULT 'MJ'
);
```

### [3] 法人格正規化（corporate のみ）

`extractLegalEntity()` が担当します。基礎正規化済み文字列の先頭・末尾からエイリアスを greedy マッチします。

**対応法人格一覧（NFKC 適用後の表記）**:

| 法人格 | kind | 完全形 | 片割れ（行頭） | 片割れ（行末） | 銀行系（行頭） | 銀行系（行末） |
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

長いエイリアスを優先（greedy）マッチします。

**対応していないエイリアス**（誤検知リスク等の理由）:

| 種別 | 例 | 非対応の理由 |
|---|---|---|
| 英字音訳系 | `K.K.` `GK` | 英文コンテキストは範囲外 |
| 英語法人格系 | `LLC` `Inc.` | 国内法人と断定できない |
| 単体略称 | `合同` `有限` | 誤検知リスク |

### [4] matchKey 生成

| キー | 適用処理 |
|---|---|
| `matchKey` | [1] 基礎正規化 + [3] 法人格除去 + 大文字統一 |
| `matchKeyKanji` | [1] 基礎正規化 + [2] 字体正規化 + [3] 法人格除去 + 大文字統一 |

---

## ambiguous フラグ

以下の条件で `ambiguous: true` になります。呼び出し側は人手確認フローへ誘導することを推奨します。

| # | 条件 | legalName | kind | legalPosition |
|---|---|---|---|---|
| ① | baseName に法人格 canonical 名が含まれる | 検出値 | 検出値 | `'pre'` or `'post'` |
| ② | 前後で同じ法人格マッチ | 検出値 | 検出値 | `'both'` |
| ③ | 前後で異なる法人格マッチ | `null` | `null` | `null` |

```typescript
// ① baseName に法人格名を含む
normalize('株式会社有限会社設立サポート')
// { legalName: "株式会社", baseName: "有限会社設立サポート", ambiguous: true }

// ② 前後で同じ法人格
normalize('(株)トヨタ自動車(株)')
// { legalName: "株式会社", legalPosition: "both", ambiguous: true }

// ③ 前後で異なる法人格
normalize('(株)○○(有)')
// { legalName: null, kind: null, legalPosition: null, ambiguous: true }
```

---

## 使用例集

```typescript
const n = Normalizer.create();

// 全角英字の法人名
n.normalize('ＴＩＳ株式会社')
// { matchKey: "TIS", legalName: "株式会社", baseName: "TIS", ... }

// 銀行振込系略称
n.normalize('カ)トヨタ自動車')
// { legalName: "株式会社", legalPosition: "pre", baseName: "トヨタ自動車", ... }

// NPO 法人
n.normalize('NPO法人テスト団体')
// { legalName: "特定非営利活動法人", baseName: "テスト団体", ... }

// 英文入力（法人格検出不可）
n.normalize('Cisco Systems G.K.')
// { legalName: null, baseName: "Cisco Systems G.K.", ... }

// 個人名
n.normalize('田中太郎', { type: 'person' })
// { legalName: null, baseName: "田中太郎", matchKey: "田中太郎", ... }
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
  README.md                         # 本ドキュメント
  DESIGN.md                         # 設計定義書（詳細）
  src/
    index.ts                        # 公開 API エントリーポイント
    normalize.ts                    # Normalizer ファクトリ・オーケストレーション
    preNormalize.ts                 # [1] 基礎正規化
    variantMap.ts                   # [2] 字体正規化（DB ロード・適用）
    legalEntity.ts                  # [3] 法人格正規化
    types.ts                        # 共通型定義
  build/
    generate-db.ts                  # MJ文字図鑑 CSV → character_variants.db 生成
    mj-source/                      # MJ文字図鑑 CSV 置き場
  data/
    character_variants.db           # 字体正規化 DB（generate-db.ts で生成）
  test/
    normalize.test.ts               # 基本動作確認テスト
    normalize.comprehensive.test.ts # 網羅的テスト
```

## テスト実行

```bash
# 基本テスト
tsx normalizer/test/normalize.test.ts

# 網羅的テスト
tsx normalizer/test/normalize.comprehensive.test.ts
```
