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

### 外部 npm 依存

| パッケージ | 用途 | GAS での代替 |
|---|---|---|
| `@geolonia/japanese-numeral` | 漢数字変換 | ソースをインライン化（MIT）|
| `@geolonia/japanese-addresses-v2` | 型定義・ヘルパー関数 | 型削除 + 関数インライン化 |
| `lru-cache` | LRU キャッシュ | `Map` + エントリ数管理の独自実装 |
| `papaparse` | CSV 解析 | `Utilities.parseCsv()` |
| `undici` | Node.js HTTP クライアント | 不要（GAS は同期 UrlFetchApp）|

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

## 5. 移植方針の推奨

### 段階的移植ロードマップ

**フェーズ 1（即実施可能）: pure ユーティリティの移植**
- `zen2han`, `kan2num`, `prenormalize`, `patchAddr`, `dict`/`dictionaries`
- 依存ゼロ、非同期なし → IIFE ラップしてそのまま `.gs` 化

**フェーズ 2（中優先）: レベル 1〜2 正規化**
- `UrlFetchApp.fetch()` で `ja.json` を取得（同期）
- `URL` コンストラクタを文字列操作に置換
- `CacheService.getScriptCache()` でキャッシュ

**フェーズ 3（要検討）: レベル 3〜8 正規化**
- 実行時間と API レイテンシのトレードオフを要評価
- スプレッドシート等への事前データ展開も選択肢

### GAS 移植コード上の注意点

- TypeScript 型注釈は削除（GAS は JavaScript）
- `import/export` を削除し、IIFE または名前空間オブジェクトに変換
- `for...of` はそのまま使用可（CODING_RULES 準拠）
- `forEach` は使用禁止（CODING_RULES 準拠）→元コードの `forEach` は `for...of` に変換

---

## 6. 結論

| 移植対象 | 判定 | 備考 |
|---|---|---|
| pure ユーティリティ（zen2han 等）| ✅ 移植可 | 即実施可能 |
| レベル 1〜2 正規化 | ✅ 移植可 | async→sync 変換が必要 |
| レベル 3〜8 正規化 | ⚠️ 移植可 | 実行コストの設計が別途必要 |
| Node.js 専用部分（fs, undici）| ❌ 移植不要 | GAS では削除 |
