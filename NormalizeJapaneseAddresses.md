# @geolonia/normalize-japanese-addresses — GAS 移植性分析

ソース: https://github.com/geolonia/normalize-japanese-addresses.git  
バージョン: v3.1.3 (TypeScript, MIT)

---

## 1. ライブラリ概要

日本の住所文字列を構造化データに正規化するライブラリ。  
外部 API (`https://japanese-addresses-v2.geoloniamaps.com/api/ja`) から住所データをオンデマンドで取得し、都道府県・市区町村・町丁目・地番/住居表示まで段階的に解析する。

### エントリーポイント

| ファイル | 用途 |
|---|---|
| `src/main.ts` | ブラウザ/汎用（global `fetch` を使用） |
| `src/main-node.ts` | Node.js 専用（`node:fs` + `undici` で file:// / http:// を処理） |

### 正規化レベル

| レベル | 意味 |
|---|---|
| 0 | 都道府県も判別不可 |
| 1 | 都道府県まで判別 |
| 2 | 市区町村まで判別 |
| 3 | 丁目・町字まで判別 |
| 8 | 住居表示または地番まで判別 |

---

## 2. ソース構成と依存関係

```
src/
  normalize.ts          # メイン正規化ロジック（全て async）
  config.ts             # エンドポイント設定・fetch インターフェース
  types.ts              # 型定義（NormalizeResult 等）
  lib/
    cacheRegexes.ts     # 都道府県/市区町村/町丁目パターン生成（async, LRU キャッシュ）
    normalizeHelpers.ts # prenormalize()（pure 関数）
    zen2han.ts          # 全角→半角変換（pure 関数）
    kan2num.ts          # 漢数字→算用数字（pure 関数）
    patchAddr.ts        # 例外住所パッチ（pure 関数）
    dict.ts             # 旧字体・異体字マッピング（pure 関数）
    dictionaries/       # JIS 第2水準変換テーブル 約285エントリ（pure）
    utils.ts            # 内部ヘルパー（pure 関数）
```

### ライセンス一覧

| パッケージ | バージョン | ライセンス | 著作権者 |
|---|---|---|---|
| `normalize-japanese-addresses`（本体）| 3.1.3 | **MIT** | Copyright 2020 Geolonia Inc. |
| `@geolonia/japanese-numeral` | 1.0.2 | **MIT** | Copyright 2020 Geolonia Inc. |
| `@geolonia/japanese-addresses-v2` | 0.0.5 | **MIT** | Copyright 2024 Geolonia Inc. |
| `lru-cache` | 11.0.1 | **ISC** | Copyright 2010-2023 Isaac Z. Schlueter and Contributors |
| `papaparse` | 5.4.1 | **MIT** | Copyright 2015 Matthew Holt |
| `undici` | 6.19.8 | **MIT** | Matteo Collina and Undici contributors |

**全パッケージが MIT または ISC**（いずれも OSI 承認済みの permissive ライセンス）。  
MIT と ISC は実質的に同等の条件であり、商用利用・改変・再配布・インライン化いずれも制限なし。

**移植時の義務**: コードをインライン化またはバンドルする場合、各パッケージの著作権表示とライセンス文をソース内に保持すること（配布時も同様）。

### 外部 npm 依存（runtime）

| パッケージ | バージョン | 独自依存 | 規模 | 用途 | GAS での代替 |
|---|---|---|---|---|---|
| `@geolonia/japanese-numeral` | 1.0.2 | **なし** | ~100行 | 漢数字変換（`kanji2number`, `number2kanji`, `findKanjiNumbers`）| ソースをそのままインライン化 |
| `@geolonia/japanese-addresses-v2` | 0.0.5 | **なし** | 49行 | 型定義 + `prefectureName` 等5つのヘルパー関数 | 型削除 + 5関数インライン化 |
| `lru-cache` | 11.0.1 | **なし** | 1,545行 | LRU キャッシュ（`LRUCache({ max })` のみ使用）| `Map` + エントリ数管理の独自実装で代替可 |
| `papaparse` | 5.4.1 | **なし** | 1,922行 | CSV 解析（1箇所のみ: `parseSubresource()` 内）| `Utilities.parseCsv()` に置換可 |
| `undici` | 6.19.8 | **なし** | - | Node.js 専用 HTTP クライアント（`main-node.ts` のみ）| 不要（GAS は `UrlFetchApp`）|

**全ての runtime 依存が zero-deps**。パッケージツリーはフラット（間接依存なし）。

### 外部 API エンドポイント

| リクエスト | URL パターン | レスポンス | 使用場面 |
|---|---|---|---|
| 都道府県・市区町村一覧 | `{api}/ja.json` | JSON (`PrefectureApi`) | レベル1〜2（初回1回のみ）|
| 町丁目一覧 | `{api}/ja/{都道府県}/{市区町村}.json` | JSON (`MachiAzaApi`) | レベル3（市区町村ごと）|
| 住居表示CSV | `{api}/ja/{都道府県}/{市区町村}-住居表示.txt` | テキスト（CSV）| レベル8（Range ヘッダーで部分取得）|
| 地番CSV | `{api}/ja/{都道府県}/{市区町村}-地番.txt` | テキスト（CSV）| レベル8（Range ヘッダーで部分取得）|

住居表示・地番はHTTP Range ヘッダー（`bytes=N-M`）でバイト範囲指定の部分取得。`UrlFetchApp` はヘッダー指定が可能なため代替可能。

`.txt` ファイルの内部フォーマットは **CSV**（`papaparse` で解析）。  
`address_data.proto` / `address_data.ts` に protobuf 定義が存在するが、これはデータ生成パイプラインの内部処理専用であり、API レスポンスは JSON / CSV のみ。

### API データ構造（`geolonia/japanese-addresses-v2` の型定義より）

**`ja.json`** — 全都道府県と市区町村をネストした1ファイル

```typescript
// PrefectureApi
{
  meta: { updated: 1700000000 },  // UNIX時間（秒）
  data: [
    {
      code: 1,
      pref: "北海道", pref_k: "ホッカイドウ", pref_r: "Hokkaido",
      point: [141.34, 43.06],     // [経度, 緯度]
      cities: [
        {
          code: 1101,
          city: "札幌市", city_k: "サッポロシ", city_r: "Sapporo-shi",
          ward: "中央区", ward_k: "チュウオウク",  // 政令市区のみ
          point: [141.35, 43.05]
        }, ...
      ]
    }, ...47都道府県
  ]
}
```

**`{都道府県}/{市区町村}.json`** — 町丁目一覧（レベル3）+ レベル8バイトオフセット

```typescript
// MachiAzaApi
{
  meta: { updated: ... },
  data: [
    {
      machiaza_id: "0001001",
      oaza_cho: "大通", oaza_cho_k: "オオドオリ", oaza_cho_r: "Odori",
      chome: "西一丁目", chome_n: 1,
      koaza: "",
      rsdt: true,              // 住居表示住所が存在する場合のみ付く
      point: [141.35, 43.06],
      csv_ranges: {            // レベル8専用。バンドル時は除去可能
        "住居表示": { start: 4096, length: 2048 }
      }
    }, ...
  ]
}
```

---

## 3. GAS 移植における課題

### 3.1 致命的課題：非同期設計

メイン関数 `normalize()` をはじめ、`getPrefectures()`、`getTownRegexPatterns()`、`getRsdt()`、`getChiban()` など全ての主要処理が `async/await` で設計されている。  
**GAS V8 ランタイムは `Promise` / `async/await` をサポートしていない。**

全ての非同期処理を `UrlFetchApp.fetch()`（同期）を使った同期処理に完全書き直す必要がある。

### 3.2 GAS 非対応 API

| 使用箇所 | 問題 | 対応方法 |
|---|---|---|
| `fetch` (global) | GAS 未サポート | `UrlFetchApp.fetch()` に置換 |
| `URL` コンストラクタ | GAS V8 未サポート | 文字列テンプレートに置換 |
| `node:fs`, `Buffer`, `process` | Node.js 専用 | 削除（GAS ではファイル読込不要）|
| `undici` | Node.js 専用 | 削除 |

### 3.3 実行コスト

原設計ではレベル 3〜8 の正規化は API コールが連鎖する（都道府県 JSON → 市区町村 JSON → 地番/住居表示 txt）。  
GAS では**レベル 1〜3 の全 JSON（約33MB）をバンドル化して Drive に格納し、初回実行時に一括ロード**することで HTTP 呼び出しをレベル8のみに限定できる（§6 参照）。

---

## 4. 移植可能性の評価

### 4.1 移植が容易な部分（pure 関数群）

以下は外部依存・非同期処理がなく、そのままほぼ移植可能。

| ソース | 機能 | 工数 |
|---|---|---|
| `zen2han.ts` | 全角英数→半角 | 小 |
| `patchAddr.ts` | 例外住所パッチ（3件のみ）| 小 |
| `dict.ts` + `dictionaries/` | JIS 旧字体マッピング（285エントリ）| 小 |
| `normalizeHelpers.ts` (prenormalize) | 入力前処理（NFC正規化、ハイフン統一等）| 小 |
| `kan2num.ts` | 漢数字変換（`@geolonia/japanese-numeral` をインライン化）| 小〜中 |

`String.prototype.normalize('NFC')` は GAS V8 で利用可能。

### 4.2 移植可能だが書き直しが必要な部分

| 機能 | 課題 | 工数 |
|---|---|---|
| レベル 1〜2 正規化（都道府県・市区町村）| async → sync 変換 + UrlFetchApp | 中 |
| LRU キャッシュ | npm パッケージ削除 → `Map` 実装 | 小 |
| CSV 解析（地番・住居表示）| papaparse → `Utilities.parseCsv()` | 小 |
| 外部 API フェッチ | fetch → `UrlFetchApp.fetch()` + `URL` コンストラクタ除去 | 中 |

### 4.3 移植可能だが追加設計が必要な部分

| 機能 | 課題 | 工数 |
|---|---|---|
| レベル 3 正規化（町丁目）| JSONバンドルの生成スクリプト + Drive への配置 | 中 |
| レベル 8 正規化（地番・住居表示）| `UrlFetchApp` + Range ヘッダー + `Utilities.parseCsv()` | 中 |
| バンドルキャッシュ | グローバル変数による実行内キャッシュ（CacheService は容量不足で不適）| 小 |

---

## 5. TypeScript 維持 + clasp 化の検討

### 5.1 clasp の現在の TypeScript サポート状況

clasp はかつて TypeScript をネイティブにトランスパイルしていたが、**現在はその機能を廃止**。  
公式推奨ワークフローは「外部バンドラーでビルド → clasp push」。

```
TypeScript ──(Rollup/esbuild)──→ 単一 JS ファイル ──(clasp push)──→ GAS
```

normalize-japanese-addresses は**すでに Rollup + TypeScript のビルド構成を持つ**ため、この構成をそのまま流用できる。

### 5.2 GAS V8 における async/await の実態

**GAS V8 は `async/await` 構文をサポートしているが、イベントループが存在しない。**

- `UrlFetchApp.fetch()` など全ての GAS API は**同期・ブロッキング**
- `async` 関数は Promise を返すが、内部処理が同期であれば即時解決する
- 真に非同期なコールバック（`setTimeout` 等）は使えないため、ネットワーク I/O を `await` しても意味がない

つまり `fetch` を `UrlFetchApp.fetch()` に置き換えると、`async/await` は**構文として残せるが実質的には無用**になる。  
型の整合性を保つ目的で `async` シグネチャを維持することは可能だが、戻り値は `Promise<T>` ではなく `T` を直接返す設計に変えた方がシンプル。

### 5.3 TypeScript + clasp 構成の設計案

```
src/          ← TypeScript ソース（normalize-japanese-addresses を GAS 向けに移植）
  index.ts    ← エントリーポイント（IIFE or 名前空間）
  ...
test/         ← Jest テスト（Node.js 上で実行）
tsconfig.json
rollup.config.js  ← 既存ライブラリのものを参考に GAS 向けに調整
dist/
  AddressNormalizer.js  ← clasp push の対象（単一ファイル）
.clasp.json
.claspignore
```

**tsconfig のポイント:**
```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["google-apps-script"]
  }
}
```

`@types/google-apps-script` により `UrlFetchApp`・`CacheService`・`Utilities` 等の型補完が得られる。

### 5.4 テスト戦略

clasp はデプロイツールに過ぎず、**開発・テストは Node.js 上で完結する**。既存の Jest（または `node:test`）はそのまま使用可。

- `UrlFetchApp` 等の GAS API はテスト内でモックする
- 純粋なロジック（`zen2han` 等）はモック不要でそのまま単体テスト可
- `puppeteer` のみ削除対象（ブラウザ統合テスト用、GAS 開発では不要）

**初期構築時の devDependencies 整理:**

| パッケージ | 判断 | 理由 |
|---|---|---|
| `puppeteer` | **削除** | ブラウザ統合テスト用、不要 |
| `jest` / `jest-matcher-deep-close-to` | **維持** | Node.js テストに使用 |
| `glob`, `tsx` | **維持** | テストランナー・TS 実行に必須 |
| `rollup` 関連 | **維持** | GAS 向けバンドルに使用 |
| `typescript`, `eslint` 関連 | **維持** | 型チェック・リントに使用 |
| `@types/google-apps-script` | **追加** | GAS API の型補完 |
| `@claspjs/clasp` | **追加** | デプロイ用 |

### 5.5 移植方針の推奨

**フェーズ 1（即実施可能）: pure ユーティリティの移植**
- `zen2han`, `kan2num`, `prenormalize`, `patchAddr`, `dict`/`dictionaries` をそのまま TypeScript で移植
- `@geolonia/japanese-numeral` はソースが ~100行・zero-deps なのでインライン化
- `@geolonia/japanese-addresses-v2` は49行・ヘルパー5関数のみなのでインライン化

**フェーズ 2（中優先）: レベル 1〜3 正規化 + データバンドル**
- 全 JSON バンドル（`ja.json` + 約1895市区町村 JSON）を生成するスクリプトを作成
- バンドルを Google Drive に配置し、`DriveApp.getFileById().getBlob().getDataAsString()` でロード
- グローバル変数にキャッシュして同一実行内の2件目以降を高速化
- `__internals.fetch` をバンドル参照実装に置き換え（HTTP 不要）
- `lru-cache` → シンプルな `Map` 実装
- `async` 関数シグネチャを同期に変更

**フェーズ 3（中優先）: レベル 8 正規化**
- `papaparse` → `Utilities.parseCsv()` に置換
- `UrlFetchApp.fetch(url, { headers: { Range: 'bytes=N-M' } })` でバイト範囲取得
- バイトオフセットはバンドル済みの市区町村 JSON の `csv_ranges` から取得（追加 HTTP 不要）

---

## 6. データホスティング戦略

### 6.1 ハイブリッド戦略の概要

レベルによってデータ取得方法を分ける。

| レベル | データソース | 取得方法 | 理由 |
|---|---|---|---|
| 1〜3 | 全 JSON を統合したバンドルファイル | ファイル1回読み込み → `JSON.parse` | 約2000ファイルをオンデマンド取得するより初回1回の方が効率的 |
| 8 | 公式 API or S3 上の `.txt` ファイル | `UrlFetchApp.fetch()` + `Range` ヘッダー | バイト範囲指定が必須なためオンライン取得のみ |

### 6.2 JSONバンドルの構造

`ja.json`（ルート）と全市区町村 JSON（1894ファイル）を1つのオブジェクトに統合。  
キーはファイルパス（拡張子なし）、値はそのファイルの内容。  
**市区町村 JSON からは `csv_ranges` を除去**してバンドルサイズを削減する（レベル8実行時は HTTP で当該ファイルを取得して `csv_ranges` を得る）。

```json
{
  "ja": { "meta": {...}, "data": [{ "pref": "北海道", "cities": [...] }, ...] },
  "ja/北海道/札幌市中央区": { "meta": {...}, "data": [{ "machiaza_id": "...", "oaza_cho": "大通", ... }] },
  "ja/東京都/渋谷区": { "meta": {...}, "data": [...] },
  ...全1894市区町村...
}
```

`__internals.fetch` の実装でキーを引いて即返すことで、元ソースの取得ロジックを無変更に近い形で差し替えられる。

### 6.3 バンドルサイズと格納先

**旧リポジトリ（`geolonia/japanese-addresses` v1）の実測値:**

| データ | ファイル数 | 実サイズ | 備考 |
|---|---|---|---|
| `ja.json` | 1 | 34 KB | v1形式（シンプル）|
| 市区町村 JSON | 1,894 | 19 MB | 最小69B / 最大272KB / 平均10KB / 中央値4.5KB |
| tar.gz 圧縮済 | — | 9.6 MB | — |

**v2形式での推定（kana/romaji/code フィールド追加、`csv_ranges` 除去後）:**

| データ | 推定サイズ |
|---|---|
| `ja.json` | ~200〜400 KB（全都市ネスト + メタデータ込み）|
| 市区町村 JSON 計（`csv_ranges` 除去済）| ~25〜30 MB |
| **統合バンドル** | **~25〜30 MB** |

> **備考**: v2 の `api.tar.zst`（全データの zstd 圧縮アーカイブ）が S3 の  
> `japanese-addresses-v2.geoloniamaps.com/experimental/api.tar.zst` に存在するが、  
> API と同様 Cloudflare でホスト制限されており（403）外部から直接取得不可。

**GAS のメモリ試算（25MB バンドルの場合）:**

```
JSON 文字列 25MB → V8 オブジェクト展開後 ~80〜120MB
GAS 実メモリ上限（非公式）~256MB → 十分に余裕あり
JSON.parse 所要時間 ~2〜4秒 → 2万件バッチなら許容範囲
```

**格納先の比較:**

| 格納先 | サイズ上限 | 評価 |
|---|---|---|
| Google Drive（単一ファイル）| 制限なし | ✅ 推奨。`getBlob().getDataAsString()` で全量ロード |
| GAS スクリプトファイル内定数 | 50 MB/プロジェクト | ✅ 可能だが deploy が重い |
| PropertiesService | 9 MB 合計 | ❌ 容量不足 |
| CacheService | 100 KB/アイテム | ❌ 容量不足 |

→ **Drive 格納が現実的**。実行開始時に1回だけロード・パースし、グローバル変数にキャッシュ。同一実行内の複数住所解析はキャッシュ再利用で高速。

### 6.4 レベル8のHTTP取得

`.txt` ファイルはバイト範囲指定（`bytes=N-M`）で部分取得するため、バンドル化不可。

```javascript
// GAS での Range ヘッダー指定
const response = UrlFetchApp.fetch(url, {
  headers: { 'Range': `bytes=${offset}-${offset + length - 1}` }
});
const csv = response.getContentText();
```

バイトオフセット (`csv_ranges.start`, `csv_ranges.length`) は市区町村 JSON に含まれており、バンドルから取得済みのデータをそのまま使える。

### 6.5 キャッシュ戦略まとめ

```
実行開始
  │
  ├─ グローバル変数 bundleData が null？
  │     YES → Drive から33MBバンドルをロード・JSON.parse → グローバルに保持
  │     NO  → キャッシュ済み（同一実行内の2件目以降）
  │
  ├─ レベル1〜3: bundleData["{pref}/{city}"] を直接参照（HTTP不要）
  │
  └─ レベル8: UrlFetchApp.fetch(url, {headers: {Range: ...}}) → papaparse → Utilities.parseCsv()
```

---

## 7. 移植方針

### 7.1 プロジェクト初期構築

```bash
# 1. 元ソースをベースに初期化
git clone https://github.com/geolonia/normalize-japanese-addresses.git AddressNormalizer
cd AddressNormalizer
npm install
rm -rf .git && git init

# 2. 不要ファイルを削除
rm src/cli.ts src/main.ts src/main-node.ts
rm -rf test/integration   # browser/webpack/Node CJS・ESM テスト
# puppeteer を devDependencies から削除（package.json 編集）
```

### 7.2 ファイル処理方針

**削除**

| ファイル | 理由 |
|---|---|
| `src/cli.ts` | CLI ツール。GAS 不要 |
| `src/main.ts` | ブラウザ向けエントリーポイント |
| `src/main-node.ts` | Node.js 専用（fs / undici）|
| `test/integration/` | Node.js / ブラウザ / webpack ビルド確認 |

**新規作成**

| ファイル | 内容 |
|---|---|
| `src/main-gas.ts` | GAS エントリーポイント（`__internals.fetch` の GAS 実装 + バンドルローダー）|
| `tools/build-bundle.ts` | データバンドル生成スクリプト（API から全 JSON 取得・`csv_ranges` 除去・統合）|

**維持（最小変換）**

| ファイル | 変換内容 |
|---|---|
| `src/normalize.ts` | `async/await` 除去、戻り値を `Promise<T>` → `T` に変更 |
| `src/lib/cacheRegexes.ts` | `lru-cache` → `Map`、`papaparse` → `Utilities.parseCsv()`、`async` 除去 |
| `src/lib/zen2han.ts` | そのまま |
| `src/lib/kan2num.ts` | `@geolonia/japanese-numeral` をインライン化 |
| `src/lib/normalizeHelpers.ts` | そのまま |
| `src/lib/patchAddr.ts` | そのまま |
| `src/lib/dict.ts` + `dictionaries/` | そのまま |
| `src/config.ts` | デフォルト fetch 実装を削除（GAS 版は `main-gas.ts` で注入）|

### 7.3 依存パッケージの置換

| パッケージ | 置換方法 |
|---|---|
| `@geolonia/japanese-numeral` | `src/lib/kan2num.ts` にインライン化（~100行）|
| `@geolonia/japanese-addresses-v2` | 型定義削除 + 5関数インライン化（49行）|
| `lru-cache` | `Map` ベースの簡易実装に置換 |
| `papaparse` | `Utilities.parseCsv()` に置換（1箇所のみ）|
| `undici` | 削除（`main-node.ts` ごと削除）|
| `fetch` global / `URL` コンストラクタ | `UrlFetchApp.fetch()` + テンプレートリテラル |

### 7.4 GAS fetch 実装（`main-gas.ts` の核心）

```typescript
// HttpClient.gs の HttpCore.createTransport() を活用してリトライを共通化
const transport = HttpCore.withRetry(HttpCore.createTransport(), { maxRetries: 3 });

let bundleData: Record<string, unknown> | null = null;

function loadBundle(): Record<string, unknown> {
  if (bundleData) { return bundleData; }
  const file = DriveApp.getFileById(BUNDLE_FILE_ID);
  bundleData = JSON.parse(file.getBlob().getDataAsString());
  return bundleData;
}

__internals.fetch = (input, options) => {
  // レベル1〜3: バンドルから直接参照（HTTP不要）
  const key = input.replace(/^\//, '').replace(/\.json(\?.*)?$/, '');
  const bundle = loadBundle();
  if (!options?.offset && bundle[key]) {
    return { json: () => bundle[key], text: () => JSON.stringify(bundle[key]), ok: true };
  }
  // レベル8: Range ヘッダーで HTTP 取得
  const url = BASE_URL + input;
  const headers: Record<string, string> = {};
  if (options?.offset != null && options?.length != null) {
    headers['Range'] = `bytes=${options.offset}-${options.offset + options.length - 1}`;
  }
  const resp = transport({ url, method: 'GET', headers });
  return { json: () => JSON.parse(resp.getContentText()), text: () => resp.getContentText(), ok: resp.getResponseCode() < 300 };
};
```

### 7.5 データバンドル生成

```bash
# tools/build-bundle.ts を実行して bundle.json を生成
npx tsx tools/build-bundle.ts

# bundle.json を Google Drive にアップロードし、ファイル ID を main-gas.ts に設定
```

バンドル生成ルール:
- `ja.json` → キー `"ja"`
- `{都道府県}/{市区町村}.json` → キー `"ja/{都道府県}/{市区町村}"`
- 各市区町村 JSON から **`csv_ranges` を除去**（レベル8時に HTTP で再取得）
- 推定サイズ: ~25〜30 MB（非圧縮）

### 7.6 コーディング規約の適用方針

| レイヤー | 規約準拠 |
|---|---|
| `main-gas.ts`（新規・GAS インターフェース層）| **完全準拠**（IIFE、JSDoc、`for...of`、命名規則）|
| `tools/build-bundle.ts`（新規ツール）| **完全準拠** |
| ポートされたアルゴリズムコード | **最低限**（`async` 除去・API 置換のみ。内部構造は元ソースを維持）|

元ソースとの対照性を保つことで upstream の変更取り込みコストを下げる。

### 7.7 テスト戦略

**フレームワーク: `node:test`（元ソースと同じ。Jest ランナーは不使用）**

```
test/
  helpers.ts              ← assertMatchCloseTo（既存流用）
  main/
    main.test.ts          ← 基本テスト 17件（GAS API モックで実行）
    metadata.test.ts      ← メタデータフィールド検証
  addresses/
    addresses.csv         ← 7,190件のテストデータ（流用）
    addresses.test.ts     ← 全件テスト（実バンドル or モック）
```

GAS API のモック（テスト冒頭で差し込み）:

```typescript
// test/mocks/gas.ts
export const DriveApp = { getFileById: (id) => ({ getBlob: () => ({ getDataAsString: () => JSON.stringify(testBundle) }) }) };
export const UrlFetchApp = { fetch: (url, opts) => mockHttpResponse(url, opts) };
export const Utilities = { parseCsv: (text) => text.split('\n').map(r => r.split(',')) };
```

Claude Code はモックベーステストをそのまま実行可能。実GAS環境テストは clasp push 後に手動確認。

### 7.8 実装フェーズ

| フェーズ | 内容 | 工数感 |
|---|---|---|
| **1** | pure ユーティリティ移植（`zen2han` / `kan2num` / `patchAddr` / `dict` / `prenormalize`）+ テスト | 小 |
| **2** | `cacheRegexes.ts` 書き換え（LRU→Map / async除去）+ レベル1〜3 正規化の同期化 | 中 |
| **3** | `tools/build-bundle.ts` 作成 + Drive バンドル読み込み実装（`main-gas.ts`）| 中 |
| **4** | レベル8実装（UrlFetchApp + Range + Utilities.parseCsv）| 中 |
| **5** | `addresses.csv` 7,190件での検証 + 実GAS環境での動作確認 | 中 |

---

## 8. 結論

| 移植対象 | 判定 | 備考 |
|---|---|---|
| pure ユーティリティ（zen2han 等）| ✅ 移植可 | 即実施可能、型そのまま維持 |
| レベル 1〜2 正規化 | ✅ 移植可 | async→sync 変換が主な作業 |
| レベル 3 正規化 | ✅ 移植可 | JSONバンドルから直接参照（HTTP不要）|
| レベル 8 正規化 | ✅ 移植可 | UrlFetchApp + Range ヘッダーで対応 |
| Node.js 専用部分（fs, undici）| ❌ 移植不要 | GAS では削除 |
| TypeScript 維持 | ✅ 可能 | Rollup + clasp の構成で実現（既存ライブラリ参考）|
| async/await 維持 | ⚠️ 非推奨 | GAS V8 はイベントループなし、同期設計に変更を推奨 |
| データ（レベル1〜3）| ✅ バンドル化 | ~33MB の統合 JSON を Drive に格納、実行開始時に1回ロード |
| データ（レベル8）| ✅ HTTP 取得 | Range ヘッダーで部分取得、バンドル化不可 |
