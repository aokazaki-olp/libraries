# 設計レビュー・コードレビュー（第3版）

- **対象**: `/home/user/libraries/` 配下の全ソースコード（10ファイル）
- **レビュー日**: 2026-02-07
- **ベース**: PR #4 マージ後の `main` ブランチ

---

## 1. 全体アーキテクチャ総評

### 1.1 設計パターンの一貫性

本ライブラリは GAS V8 ランタイム向けのユーティリティ群であり、以下のパターンが一貫して適用されている。

| パターン | 適用箇所 | 評価 |
|---|---|---|
| IIFE モジュール | HttpCore, ClientHelper, ApiClient, WebhookClient, SlackCore, SlackApiClient, SlackWebhookClient, GSC, LoggerFacade, SlackFilters | GAS のスコープ制約に適合。一貫性あり |
| Transport + Decorator | HttpCore.withRetry, withLogger, withBearerAuth, withGoogleAuth, SlackCore.withRetry | 関心の分離が明確。合成可能 |
| Immutable Builder | ApiClient.extend() | 元クライアントを変更しない。安全 |
| Plugin Injection | ClientHelper.use() | **PR #4 で新規追加**。拡張性が大幅に向上 |
| Facade | LoggerFacade | SLF4J 互換。多様なロガー実装を吸収 |
| Factory + Static | WebhookClient, SlackWebhookClient | create() + send() の二重インターフェース |

**総合評価**: 設計の一貫性は高く、各モジュール間の責任分離が明確。PR #4 で追加された `ClientHelper`（HTTP メソッドショートカット・Plugin Injection）は既存設計を壊さず自然に統合されている。

### 1.2 PR #4 による改善点

1. **`ClientHelper` モジュール新設** — `use()` による Plugin Injection パターンを導入し、API クライアントの拡張性を大幅に改善
2. **HTTP メソッドショートカット** — `get()`, `post()`, `put()`, `patch()`, `delete()` で呼び出しが簡潔に
3. **`responseHandler` パターン** — レスポンス後処理を `ApiClient.createClient()` の設定に集約。SlackApiClient・GSC クライアントともにクリーンな統合
4. **テスト大幅拡充** — HttpClient.test.gs にエッジケース・Plugin テスト・responseHandler テストを追加

---

## 2. 指摘事項

### 重要度の定義

| ランク | 意味 |
|---|---|
| **H (High)** | バグまたはデータ損失・予期しない動作に直結する問題 |
| **M (Medium)** | 堅牢性・保守性に影響する問題。修正推奨 |
| **L (Low)** | 改善が望ましいが影響は限定的 |

---

### H-1: HttpCore.withRetry — リトライ上限時の二重ログ

**ファイル**: `HttpClient.gs:166-202`

HTTP ステータス 429/5xx でリトライ上限に達した場合、エラーが **2回ログ出力** される。

**再現フロー**:
```
1. attempt === maxRetries かつ status === 429 or 5xx
2. L174: log.error(「RETRY exhausted status=...」)    ← 1回目
3. L176: throw new Error(「リトライ回数上限...」)
4. この throw は try ブロック (L167) 内なので catch (L187) に捕捉される
5. L189: attempt === maxRetries → true
6. L191: log.error(「RETRY exhausted method url」, e)  ← 2回目
7. L193: break → L202: throw lastError
```

**SlackCore との対比**: SlackCore.withRetry（SlackClient.gs:94-98）では `e.message.includes('リトライ回数上限')` チェックで再スローしており、二重ログを回避している。HttpCore にはこの防御がない。

**修正案**: catch ブロック冒頭にリトライ上限エラーの再スロー判定を追加する。
```javascript
catch (e) {
  if (e.message && e.message.includes('リトライ回数上限')) {
    throw e;
  }
  // ...既存のリトライロジック
}
```

---

### H-2: SlackCore.withRetry — 文字列マッチによるエラー識別の脆弱性

**ファイル**: `SlackClient.gs:96`

```javascript
if (e.message && e.message.includes('リトライ回数上限')) {
  throw e;
}
```

エラーの識別にエラーメッセージの文字列マッチを使用している。これは以下のリスクがある:

- エラーメッセージが変更されると検出が壊れる
- 別のエラーが偶然同じ文字列を含む場合に誤検出する

**修正案**: カスタムエラー型またはエラープロパティで識別する。
```javascript
// throw 側
const e = new Error(`リトライ回数上限に達しました (HTTP ${status})`);
e.name = 'RetryExhaustedError';
throw e;

// catch 側
if (e.name === 'RetryExhaustedError') {
  throw e;
}
```

---

### H-3: LazyTemplate.gs — strict mode でのエクスポート不成立

**ファイル**: `LazyTemplate.gs:646-658`

```javascript
// GAS環境
if (typeof global !== 'undefined' && global === this) {
  global.LazyTemplate = LazyTemplate;
}
```

ファイル先頭に `'use strict';`（L1）があるため、IIFE 内部の `this` は `undefined` になる。`global`（引数で渡された外側の `this`）と IIFE 内の `this`（`undefined`）は一致せず、GAS 環境向けのエクスポートが実行されない。

**GAS での実影響**: GAS V8 ランタイムでは `.gs` ファイルのトップレベル `const` 宣言がプロジェクト全体で共有されるため、実運用上はクラスにアクセス可能。ただし、Node.js やブラウザでの再利用時に問題が顕在化する。

**修正案**:
```javascript
// GAS環境 (strict mode 対応)
if (typeof global !== 'undefined' && typeof globalThis !== 'undefined' && global === globalThis) {
  global.LazyTemplate = LazyTemplate;
}
```
または IIFE の呼び出しを `}).call(this, this);` に変更する。

---

### M-1: HTTP メソッドショートカット — options による意図しないオーバーライド

**ファイル**: `HttpClient.gs:272-282`

```javascript
get: (endpoint, query, options) =>
  call({ method: 'GET', endpoint, query, ...options }),
post: (endpoint, body, options) =>
  call({ method: 'POST', endpoint, body, ...options }),
```

`options` にスプレッドを使用しているため、`options` に `method` や `endpoint` が含まれている場合、意図したメソッド・エンドポイントが上書きされる。

```javascript
// 意図: GET /users
// 実際: POST /users (options.method が優先される)
client.get('/users', {}, { method: 'POST' });
```

**修正案**: `options` から `method`, `endpoint`, `query`, `body` を除外する。
```javascript
get: (endpoint, query, options) => {
  const { method: _, endpoint: __, query: ___, body: ____, ...rest } = options || {};
  return call({ method: 'GET', endpoint, query, ...rest });
},
```
または、`options` パラメータを `headers` や `timeoutMs` など限定的なキーのみ受け付ける設計にする。

---

### M-2: SlackCore — Retry-After ヘッダーの NaN 安全性

**ファイル**: `SlackClient.gs:61`

```javascript
const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 1;
const delayMs = delaySeconds * 1000;
```

`Retry-After` ヘッダーが数値でない文字列（例: `"Thu, 01 Dec 2026 16:00:00 GMT"`）の場合、`parseInt` は `NaN` を返す。`NaN * 1000 = NaN` となり、`Utilities.sleep(NaN)` の挙動は未定義。

**修正案**:
```javascript
const delaySeconds = retryAfter ? (parseInt(retryAfter, 10) || 1) : 1;
```

---

### M-3: HttpCore.hasHeader — hasOwnProperty ガード欠落

**ファイル**: `HttpClient.gs:84-92`

```javascript
const hasHeader = (headers, key) => {
  const needle = String(key).toLowerCase();
  for (const k in headers) {
    if (String(k).toLowerCase() === needle) {
      return true;
    }
  }
  return false;
};
```

`for...in` がプロトタイプチェーンのプロパティも走査する。`cloneHeaders`（L51）と `mergeHeaders`（L69）は `Object.prototype.hasOwnProperty.call()` ガードを使用しているが、`hasHeader` にはない。

**実影響**: headers は通常プレーンオブジェクトなので影響は限定的だが、3つのヘッダーユーティリティ間で一貫性がない。

**修正案**:
```javascript
for (const k in headers) {
  if (Object.prototype.hasOwnProperty.call(headers, k) && String(k).toLowerCase() === needle) {
    return true;
  }
}
```

---

### M-4: resolveSheet — 最終フォールバックが無効な型を返す

**ファイル**: `resolveSheet.gs:215-216`

```javascript
// それ以外は Sheet オブジェクトとして直接返す
return source;
```

`source` が `number`, `boolean`, `Date` などの場合、Sheet オブジェクトではないものがそのまま返却される。呼び出し元で Sheet API（`getRange()` 等）を呼ぶと不明なエラーが発生する。

**修正案**: 認識できない型はエラーにする。
```javascript
throw new Error(`resolveSheet: サポートされていない source 型です: ${typeof source}`);
```

---

### M-5: LazyTemplate.applyFilters — 未知のフィルター名を黙殺

**ファイル**: `LazyTemplate.gs:440-448`

```javascript
applyFilters(value, filterNames) {
  let v = value;
  for (const name of filterNames) {
    const fn = this.filters[name];
    if (typeof fn === 'function') {
      v = fn(v);
    }
  }
  return v;
}
```

フィルター名のタイポ（例: `{{{name | boldd}}}`）が検出されず、値がそのまま通過する。テンプレート開発時にデバッグが困難になる。

**修正案**: 未知のフィルターで警告ログを出力するか、strict モードオプションでエラーにする。

---

### M-6: SlackWebhookClient.create — パラメータ再代入

**ファイル**: `SlackClient.gs:226`

```javascript
const create = (webhookUrl, options) => {
  options = options || {};
```

引数 `options` を再代入している。strict mode では動作するが、ESLint の `no-param-reassign` ルールに違反し、可読性を損なう。同様のパターンが `WebhookClient.create`（HttpClient.gs:533）にも存在する。

**修正案**: `const opts = options || {};` に変更する。

---

### M-7: GoogleSearchConsoleApiClient — withGoogleAuth の不要なエクスポート

**ファイル**: `GoogleSearchConsoleApiClient.gs:80`

```javascript
return { withGoogleAuth, create };
```

`withGoogleAuth` は `create()` 内部でのみ使用される内部関数。外部に公開すると、不完全な状態（baseUrl なし等）で使用される可能性がある。

**修正案**: `return { create };` のみにする。

---

### M-8: TestRunner — グローバル可変状態

**ファイル**: `HttpClient.test.gs:28-29`

```javascript
let results = [];
let currentSuite = '';
```

`TestRunner` はシングルトンで可変状態を保持している。複数のテストファイル（HttpClient.test.gs, SlackClient.test.gs）が同じ `TestRunner` を共有するため、`reset()` 呼び出し漏れでテスト結果が汚染される。

**現状**: 各テストランナー関数（`runAllHttpClientTests`, `runAllSlackClientTests`）で `reset()` を呼んでおり問題は発生していないが、テストファイルの追加時にリスクが増大する。

---

### M-9: SlackClient.test.gs — slackResponseHandler テストがロジックを複製

**ファイル**: `SlackClient.test.gs:462-531`

`slackResponseHandler` のテスト（L462-531）が、実際の `SlackApiClient` を経由せず、ハンドラのロジックをテストコード内で再実装している。

```javascript
// テスト内でロジックを再実装
if (response.body && response.body.ok === false) {
  const errorCode = response.body.error || 'slack_error';
  const e = new Error(`Slack APIエラー: ${errorCode}`);
  e.code = errorCode;
  throw e;
}
```

これでは「テスト用の再実装が正しいか」を検証しているだけで、実際の `slackResponseHandler` 関数の挙動は保証されない。

**修正案**: `ApiClient.createClient` に `responseHandler` と `MockTransport` を組み合わせて、実際のハンドラを経由するテストに変更する。

---

### L-1: ClientHelper.use() — プラグイン戻り値の型検証なし

**ファイル**: `HttpClient.gs:318-328`

```javascript
client.use = (pluginOrName, fn) => {
  let newMethods;
  if (typeof pluginOrName === 'string') {
    newMethods = { [pluginOrName]: fn(client) };
  } else {
    newMethods = pluginOrName(client);
  }
  return createExtended({ ...additionalMethods, ...newMethods });
};
```

`pluginOrName(client)` が `null`, `undefined`, または非オブジェクトを返した場合、スプレッドで予期しない動作が発生する可能性がある。

---

### L-2: ApiClient.createClient — デフォルトメソッドが POST

**ファイル**: `HttpClient.gs:443`

```javascript
const method = (request.method || 'POST').toUpperCase();
```

一般的な HTTP クライアントは GET をデフォルトとするが、本ライブラリは POST をデフォルトとしている。Slack API（多くのメソッドが POST）向けの設計意図は理解できるが、汎用的な `ApiClient` としては直感に反する。HTTP メソッドショートカット（`get()`, `post()` 等）の導入により、`call()` 直接呼び出し時のデフォルトの影響は軽減されている。

---

### L-3: resolveSheet — 内部関数の毎回再生成

**ファイル**: `resolveSheet.gs:66, 74, 87, 106`

`isUrl`, `getGid`, `getOrCreateSheet`, `throwCreateNotSupported` が `resolveSheet` 呼び出しのたびに再定義される。`getOrCreateSheet` は `create` 変数をクロージャで参照するため内部定義が必要だが、`isUrl` と `getGid` は外部に移動可能。

---

### L-4: assertDeepEqual — JSON.stringify による比較の制約

**ファイル**: `HttpClient.test.gs:51-54`

```javascript
const assertDeepEqual = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
```

`undefined` 値、`function` 型、循環参照を含むオブジェクトでは正しく比較できない。現在のテストケースでは問題ないが、テストの拡張時に注意が必要。

---

### L-5: GoogleSearchConsoleApiClient — JSDoc 誤字

**ファイル**: `GoogleSearchConsoleApiClient.gs:14`

```
リトライは ApiClient.withRetry を再利用し、レートリミットに合わせて緩やかな設定にある
```

「設定にある」→「設定にする」の誤字。また、実際には `ApiClient.withRetry` ではなく `HttpCore.withRetry` を使用している。

---

### L-6: テスト — Retry-After NaN ケースのテスト不足

**ファイル**: `SlackClient.test.gs`

`Retry-After` ヘッダーに数値でない文字列が設定された場合のテストが存在しない。M-2 の問題を検出できない。

---

## 3. モジュール別評価

| モジュール | ファイル | 行数 | 品質 | 主な評価 |
|---|---|---|---|---|
| HttpCore | HttpClient.gs:32-256 | 225 | **B+** | Transport + Decorator の基盤は堅牢。H-1（二重ログ）が未修正 |
| ClientHelper | HttpClient.gs:263-337 | 75 | **A-** | PR #4 で新規追加。Plugin Injection の設計は良好。M-1（options オーバーライド）に注意 |
| ApiClient | HttpClient.gs:354-497 | 144 | **A** | responseHandler 統合で可読性向上。extend() のイミュータブル設計も健全 |
| WebhookClient | HttpClient.gs:518-595 | 78 | **A** | シンプルで明確。問題なし |
| SlackCore | SlackClient.gs:27-120 | 94 | **B** | Retry-After 対応は適切だが NaN 安全性（M-2）と文字列マッチ（H-2）に課題 |
| SlackApiClient | SlackClient.gs:136-184 | 49 | **A** | responseHandler パターンへの移行で大幅に簡潔化 |
| SlackWebhookClient | SlackClient.gs:210-300 | 91 | **A-** | 機能的に問題なし。M-6（パラメータ再代入）は軽微 |
| GSC Client | GoogleSearchConsoleApiClient.gs | 82 | **A-** | responseHandler 統合で簡潔。OAuth 動的取得の設計は適切 |
| LazyTemplate | LazyTemplate.gs | 661 | **B+** | テンプレートエンジンとして高機能。H-3（エクスポート）と M-5（未知フィルター黙殺）が課題 |
| SlackFilters | SlackFilters.gs | 455 | **A** | 純関数のみ。命名規則統一。問題なし |
| LoggerFacade | LoggerFacade.gs | 103 | **A** | SLF4J 互換の設計が簡潔で明確。問題なし |
| resolveSheet | resolveSheet.gs | 217 | **B+** | 柔軟な入力対応。M-4（最終フォールバック）の修正推奨 |
| loadFromSheetAsObjects | loadFromSheetAsObjects.gs | 215 | **A** | 「切るだけ」の設計原則が徹底。型による引数判定も明確 |
| HttpClient.test.gs | HttpClient.test.gs | 1483 | **A-** | PR #4 でテスト大幅拡充。MockTransport の設計が良好。カバレッジ充分 |
| SlackClient.test.gs | SlackClient.test.gs | 615 | **B+** | Plugin パターンのテストは良好。M-9（ロジック複製）が改善点 |

---

## 4. 指摘事項サマリー

| ID | 重要度 | モジュール | 概要 |
|---|---|---|---|
| H-1 | High | HttpCore.withRetry | リトライ上限時の二重ログ |
| H-2 | High | SlackCore.withRetry | 文字列マッチによるエラー識別の脆弱性 |
| H-3 | High | LazyTemplate | strict mode でのエクスポート不成立 |
| M-1 | Medium | ClientHelper | HTTP メソッドショートカットの options オーバーライド |
| M-2 | Medium | SlackCore | Retry-After parseInt NaN 安全性 |
| M-3 | Medium | HttpCore | hasHeader の hasOwnProperty ガード欠落 |
| M-4 | Medium | resolveSheet | 最終フォールバックが無効な型を返す |
| M-5 | Medium | LazyTemplate | applyFilters が未知フィルターを黙殺 |
| M-6 | Medium | SlackWebhookClient, WebhookClient | パラメータ再代入 |
| M-7 | Medium | GSC Client | withGoogleAuth の不要なエクスポート |
| M-8 | Medium | TestRunner | グローバル可変状態 |
| M-9 | Medium | SlackClient.test.gs | slackResponseHandler テストがロジック複製 |
| L-1 | Low | ClientHelper | use() のプラグイン戻り値型検証なし |
| L-2 | Low | ApiClient | デフォルトメソッドが POST |
| L-3 | Low | resolveSheet | 内部関数の毎回再生成 |
| L-4 | Low | HttpClient.test.gs | assertDeepEqual の JSON.stringify 制約 |
| L-5 | Low | GSC Client | JSDoc 誤字 |
| L-6 | Low | SlackClient.test.gs | Retry-After NaN テスト不足 |

**High: 3件 / Medium: 9件 / Low: 6件 / 合計: 18件**

---

## 5. 推奨対応優先順位

### 即時対応（High）
1. **H-1**: HttpCore.withRetry に二重ログ防止の catch ガードを追加
2. **H-2**: エラー識別をカスタムエラー型（`e.name = 'RetryExhaustedError'`）に変更。HttpCore・SlackCore 両方に適用
3. **H-3**: LazyTemplate のエクスポート条件を strict mode 対応に修正

### 早期対応（Medium）
4. **M-1**: HTTP メソッドショートカットの options から予約キーを除外
5. **M-2**: Retry-After の parseInt に `|| 1` フォールバックを追加
6. **M-4**: resolveSheet の最終フォールバックをエラーに変更

### 継続改善（Low + 残り Medium）
7. 残りの Medium・Low 項目を技術的負債として管理
