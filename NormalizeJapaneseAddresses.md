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

### 外部 npm 依存（runtime）

| パッケージ | バージョン | 独自依存 | 規模 | 用途 | GAS での代替 |
|---|---|---|---|---|---|
| `@geolonia/japanese-numeral` | 1.0.2 | **なし** | ~100行 | 漢数字変換（`kanji2number`, `number2kanji`, `findKanjiNumbers`）| ソースをそのままインライン化（MIT）|
| `@geolonia/japanese-addresses-v2` | 0.0.5 | **なし** | 49行 | 型定義 + `prefectureName` 等5つのヘルパー関数 | 型削除 + 5関数インライン化 |
| `lru-cache` | 11.0.1 | **なし** | 1,545行 | LRU キャッシュ（`LRUCache({ max })` のみ使用）| `Map` + エントリ数管理の独自実装で代替可 |
| `papaparse` | 5.4.1 | **なし** | 1,922行 | CSV 解析（1箇所のみ: `parseSubresource()` 内）| `Utilities.parseCsv()` に置換可 |
| `undici` | 6.19.8 | **なし** | - | Node.js 専用 HTTP クライアント（`main-node.ts` のみ）| 不要（GAS は `UrlFetchApp`）|

**全ての runtime 依存が zero-deps**。パッケージツリーはフラット（間接依存なし）。

### 外部 API エンドポイント

| リクエスト | URL パターン | レスポンス | 使用場面 |
|---|---|---|---|
| 都道府県・市区町村一覧 | `{api}/.json` | JSON | レベル1〜2（初回1回のみ）|
| 町丁目一覧 | `{api}/{都道府県}/{市区町村}.json?v={ts}` | JSON | レベル3（市区町村ごと）|
| 住居表示CSV | `{api}/{都道府県}/{市区町村}-住居表示.txt?v={ts}` | テキスト（CSV）| レベル8（Range ヘッダーで部分取得）|
| 地番CSV | `{api}/{都道府県}/{市区町村}-地番.txt?v={ts}` | テキスト（CSV）| レベル8（Range ヘッダーで部分取得）|

住居表示・地番はHTTP Range ヘッダー（`bytes=N-M`）でバイト範囲指定の部分取得。`UrlFetchApp` はヘッダー指定が可能なため代替可能。

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

レベル 3〜8 の正規化は API コールが連鎖する（都道府県 JSON → 市区町村 JSON → 地番/住居表示 txt）。  
GAS の `UrlFetchApp` 呼び出しはレイテンシが高く、1 住所の解析で複数回のリクエストが発生する。  
GAS のスクリプト実行時間制限（6分）内に収めるには、`CacheService` 等の永続キャッシュ活用が必要。

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
| レベル 3〜8 正規化（町丁目・地番）| 連鎖 API コールの同期化 + GAS 実行時間対策 | 大 |
| キャッシュ戦略 | LRU → `CacheService`（容量・TTL 制限あり）への変更 | 中 |

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
tsconfig.json
rollup.config.js  ← 既存ライブラリのものを参考に GAS 向けに調整
dist/
  AddressNormalizer.js  ← clasp push の対象（単一ファイル）
.clasp.json
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

### 5.4 移植方針の推奨

**フェーズ 1（即実施可能）: pure ユーティリティの移植**
- `zen2han`, `kan2num`, `prenormalize`, `patchAddr`, `dict`/`dictionaries` をそのまま TypeScript で移植
- `@geolonia/japanese-numeral` はソースが ~100行・zero-deps なのでインライン化
- `@geolonia/japanese-addresses-v2` は49行・ヘルパー5関数のみなのでインライン化

**フェーズ 2（中優先）: レベル 1〜2 正規化**
- `fetch` → `UrlFetchApp.fetch()`（同期）に置換
- `URL` コンストラクタ → テンプレートリテラルに置換
- `async` 関数シグネチャを同期に変更
- `lru-cache` → `Map` + エントリ数制限のシンプルな実装
- `CacheService.getScriptCache()` で都道府県データをセッション間キャッシュ

**フェーズ 3（要検討）: レベル 3〜8 正規化**
- `papaparse` → `Utilities.parseCsv()` に置換
- Range ヘッダーは `UrlFetchApp` で指定可能なため対応可
- 連鎖 API コールの実行時間コストを実測して判断

---

## 6. 結論

| 移植対象 | 判定 | 備考 |
|---|---|---|
| pure ユーティリティ（zen2han 等）| ✅ 移植可 | 即実施可能、型そのまま維持 |
| レベル 1〜2 正規化 | ✅ 移植可 | async→sync 変換が主な作業 |
| レベル 3〜8 正規化 | ⚠️ 移植可 | 実行コストの実測・設計が別途必要 |
| Node.js 専用部分（fs, undici）| ❌ 移植不要 | GAS では削除 |
| TypeScript 維持 | ✅ 可能 | Rollup + clasp の構成で実現（既存ライブラリ参考）|
| async/await 維持 | ⚠️ 非推奨 | GAS V8 はイベントループなし、同期設計に変更を推奨 |
