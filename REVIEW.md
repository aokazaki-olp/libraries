# 設計レビュー・コードレビュー（累積版）

> GAS V8 ライブラリ群の設計・コード・コーディング規則適合性を記録する累積レビュードキュメント。
> 各版では対象 PR / コンポーネントの詳細分析を行い、指摘事項の追跡・管理を行う。

---

## レビュー版一覧

| 版 | 対象 | レビュー日 | 新規指摘 | 要対応残 |
|---|---|---|---|---|
| [第9版](#第9版) | SlackFilters.gs / SlackResolvers.gs | 2026-02-25 | H×1, M×1, L×5 | **0件** |
| [第8版](#第8版) | PR #7 — loadAsObjects Range サポート | 2026-02-08 | H×1 (R-1) | **0件** |

---

## ライブラリ全体評価（第9版時点）

| モジュール | ファイル | 品質 | 主な評価 |
|---|---|---|---|
| HttpCore | HttpClient.gs:32-238 | **A-** | Transport + Decorator の基盤が堅牢。SlackCore との重複（→ T-1）が改善余地 |
| ClientHelper | HttpClient.gs:245-322 | **A** | Plugin Injection の設計が良好 |
| ApiClient | HttpClient.gs:339-478 | **A** | Immutable Builder が健全。responseHandler 統合で可読性向上 |
| WebhookClient | HttpClient.gs:499-574 | **A** | シンプルで明確 |
| SlackCore | SlackClient.gs:27-123 | **B+** | Retry-After 対応は適切。HttpCore との重複（→ T-1）が改善余地 |
| SlackApiClient | SlackClient.gs:139-187 | **A** | responseHandler パターンで簡潔 |
| SlackWebhookClient | SlackClient.gs:213-302 | **A** | Slack Webhook 仕様に忠実 |
| LoggerFacade | LoggerFacade.gs | **A** | SLF4J 互換の設計が簡潔で明確 |
| LazyTemplate | LazyTemplate.gs | **A-** | 高機能テンプレートエンジン。M-5 は設計意図によりクローズ |
| SlackFilters | SlackFilters.gs | **A** | 純関数のみ。SF-1, SF-2 修正済み |
| SlackResolvers | SlackResolvers.gs | **A** | SR-B1（H）修正済み。SR-1〜3 修正済み |
| resolveSheet | resolveSheet.gs | **A** | 柔軟な入力対応。全修正済み |
| loadAsObjects | loadAsObjects.gs | **A** | PR #7 で Range サポート追加。R-1 修正済み |
| GSC Client | GoogleSearchConsoleApiClient.gs | **A** | withGoogleAuth は共通デコレータとして公開（設計意図） |

---

## モジュール依存グラフ

```
LoggerFacade ← HttpCore ← ApiClient ← SlackApiClient
                  ↑            ↑           GoogleSearchConsoleApiClient
                  ↑            ↑
             ClientHelper      WebhookClient ← SlackWebhookClient
                               ↑
                          SlackCore

LazyTemplate ← SlackFilters
               SlackResolvers

resolveSheet ← loadFromRangeAsObjects ← loadFromSheetAsObjects
```

依存は単方向で循環なし。LoggerFacade が最下層、HttpCore が HTTP 基盤として全クライアントに共通サービスを提供する構造は健全。

---

## 継続中の検討事項

### T-1: HttpCore.withRetry と SlackCore.withRetry の構造的重複

**ファイル**: `HttpClient.gs:126-187`, `SlackClient.gs:37-120`
**初出**: 第8版 N-1

| 共通ロジック | HttpCore | SlackCore |
|---|---|---|
| ループ制御 (`for attempt`) | L142 | L52 |
| 429/5xx ステータス判定 | L147 | L57, L79 |
| `RetryExhaustedError` 名前付きエラー | L153 | L68, L85 |
| catch 内の再スロー判定 | L167 | L99 |
| lastError 管理 | L170 | L103 |
| 指数バックオフ | L131-135 | L41-45 |

差分: SlackCore のみ 429 時に `Retry-After` ヘッダーを尊重し固定 baseDelay = 1000ms。
結論: `Retry-After` は RFC 7231 Section 7.1.3 の標準ヘッダーであり HttpCore に統合する方向が自然。ただし strategy パターン導入による複雑度とのトレードオフがある。**新たな API クライアント追加タイミングで統合を検討**。

---

## 設計意図によりクローズした指摘

| ID | モジュール | 概要 | クローズ理由 |
|---|---|---|---|
| M-5 | LazyTemplate | `applyFilters` が未知フィルター名を黙殺 | テンプレートエンジンとしてのフォールバック動作として合理的。LoggerFacade 依存の追加は設計方針に反する |
| M-7 | GSC Client | `withGoogleAuth` のエクスポート | Google API 共通 OAuth デコレータとして再利用前提の暫定措置 |
| N-2 | SlackWebhookClient | `WebhookClient.send` とのレスポンス形式不一致 | Slack Webhook のプレーンテキストレスポンスを正確に反映するベストプラクティス |

---

## カスタムエラー型の整理

| エラー名 | 定義箇所 | 付与プロパティ | スロー条件 |
|---|---|---|---|
| `HttpError` | HttpClient.gs:94-101 | `status`, `headers`, `body`, `text`, `request` | HTTP 2xx 以外のレスポンス |
| `RetryExhaustedError` | HttpClient.gs:152-153, SlackClient.gs:67-68 | なし（メッセージのみ） | リトライ回数上限到達 |
| `SlackApiError` | SlackClient.gs:156-161 | `code`, `metadata`, `response` | Slack API `ok: false` |
| `SlackWebhookError` | SlackClient.gs:279-283 | `status`, `body` | Slack Webhook 非 2xx |

全エラーは `new Error(); e.name = '...'` 方式（GAS V8 互換）。`instanceof` 判定不可、`e.name ===` で判定する。

---

---

<a name="第9版"></a>

# 第9版 — SlackFilters / SlackResolvers 完全詳細分析（2026-02-25）

- **対象**: `SlackFilters.gs`, `SlackResolvers.gs`, `SlackFilters.test.gs`, `SlackResolvers.test.gs`
- **レビュー範囲**: 設計・コード・コーディング規則適合性・テスト品質
- **変更**: 4ファイル / バグ修正1件・規則違反修正6件・テスト強化1件

---

## 1. 全体設計評価

### 1.1 設計パターンの適用

| パターン | 適用箇所 | 評価 |
|---|---|---|
| IIFE モジュール | SlackFilters, SlackResolvers | GAS V8 の `const` スコープ制約に適合 ✅ |
| 純粋関数 | SlackFilters 全 21 フィルター | 副作用なし・統一シグネチャ `v => ...` ✅ |
| Factory | SlackResolvers.create(), createFromApi() | 辞書をクロージャに閉じ込めた安全な設計 ✅ |
| フェイルセーフ | toUserId / toChannelId | 未解決時に入力値をそのまま返す ✅ |

### 1.2 責任分離

```
SlackResolvers（解決: 名前 → ID）
  +
SlackFilters（装飾: ID → Slack 記法）
  ↓ Object.assign() で合成
LazyTemplate フィルター群
  ↓ フィルターチェーン
{{{ name | toUserId | mentionUser }}}
```

両モジュールの責任境界が明確で、組み合わせが直感的。

---

## 2. SlackFilters.gs — 詳細分析

**品質: A**（367行）

### 2.1 アーキテクチャ

IIFE で完全にカプセル化された純粋関数群。`typeof LazyTemplate === 'undefined'` によるガードで読み込み順序依存を明示する堅牢な設計。

| 区分 | 関数（21個） | 評価 |
|---|---|---|
| Mrkdwn装飾（6） | bold, italic, strike, code, codeBlock, quote | 空文字入力に空文字を返すガード一貫 ✅ |
| メンション/参照（5） | mentionUser, mentionChannel, mentionSpecial, link, mail | ID をラップするだけの単責任 ✅ |
| エスケープ（4） | escapeHtml, escapeMrkdwn, escapeJson, escapeBlockKit | 二重エスケープ防止の合成順序が正しい ✅ |
| ユーティリティ（6） | newline, bullet, bulletList, numbered, numberedList, date | processList の共通化が適切 ✅ |

### 2.2 エスケープ設計の正しさ

`escapeBlockKit` は `escapeJson(escapeMrkdwn(v))` の合成。

```
入力: 'A & <B> *C*'
  ↓ escapeMrkdwn
'A &amp; &lt;B&gt; \*C\*'   ← & を先にエスケープして二重エスケープ回避
  ↓ escapeJson
'A &amp; &lt;B&gt; \\*C\\*' ← バックスラッシュを JSON エスケープ
```

`escapeHtml` を挟むと `&amp;` が `&amp;amp;` に二重エスケープされるため、設計上 `escapeBlockKit` に `escapeHtml` を含めないのは正しい。

`escapeJson` は制御文字 U+0000〜U+001F を `switch (c)` で完全にカバーし、`default` で Unicode エスケープ（`\uXXXX`）に変換する。

### 2.3 観察事項（指摘なし）

- **`link` の JSDoc 分類**: セクションコメントの「メンション（参照）系」内に `link` が含まれているが、`link` は URL リンク記法。機能に問題はなくドキュメント上の軽微な不正確さ。
- **`quote` の trailing newline**: `'hello\n'` → `'> hello\n> '`（末尾に空引用行が生成される）。テストで認識済み。設計上 trailing newline の除去は行わない方針。
- **`date` フィルターと `0` 値**: `v = 0` は `toString(0) = '0'` となり空文字チェックを通過して `<!date^0^...>` を生成する。Unix timestamp `0`（1970-01-01 00:00:00 UTC）として正しい挙動であり、テストで明示検証済み。
- **`processList` と `numberedList` の実装分岐**: `bulletList` は `processList` ヘルパーを利用しているが、`numberedList` はインデックスが必要なため直接実装。`processList` を拡張するより直接実装のほうが複雑度が低く適切。

---

## 3. SlackResolvers.gs — 詳細分析

**品質: A-** → 修正後 **A**（212行）

### 3.1 アーキテクチャ

| 関数 | 責任 | 評価 |
|---|---|---|
| `create(dictionaries)` | 提供済み辞書からフィルター生成 | シンプルで明確 ✅ |
| `createFromApi(slackClient)` | API 全件取得 + 辞書構築 + フィルター委譲 | 責任の集約が適切 ✅ |
| `fetchAndBuildUsersMap` | users.list 全ページ取得・辞書構築 | 優先度ロジックが明確 ✅ |
| `fetchAndBuildChannelsMap` | conversations.list 全ページ取得・辞書構築 | シンプルで明確 ✅ |

### 3.2 優先度ロジック

`fetchAndBuildUsersMap` は低優先度から順に map へ書き込み、高優先度が上書きする方式（実行順序と「最終的に残る値 = 最優先」の対応）。

```
5. real_name    → map[real_name]  = id
4. display_name → map[display_name] = id  （上書き可）
3. name         → map[name] = id           （上書き可）
2. email local  → map[localPart] = id      （上書き可）
1. email        → map[email] = id          （最終的に残る = 最優先）
```

コードの読み順と優先度説明が直感に反する可能性はあるが、コメントと JSDoc で明確に説明されており問題なし。

### 3.3 フェイルセーフ設計のトレードオフ

未解決の名前が入力値そのまま返ることで、後続の `mentionUser` に渡ると `<@未定義名>` という無効なメンション構文が生成される。ただし情報損失を防ぐ設計選択として意図的であり、JSDoc に明記されている。

---

## 4. 指摘事項

### 重要度定義

| ランク | 意味 |
|---|---|
| **H (High)** | バグまたはデータ損失・予期しない動作に直結する問題 |
| **M (Medium)** | 堅牢性・保守性に影響する問題。修正推奨 |
| **L (Low)** | 改善が望ましいが影響は限定的 |

---

### SR-B1 [H]: GET リクエストで `body` を使用 — ページネーションが機能しない **[修正済み]**

**ファイル**: `SlackResolvers.gs:102, 168`

```javascript
// 修正前（WRONG）
slackClient.call({ endpoint: 'users.list',        body: params, method: 'GET' });
slackClient.call({ endpoint: 'conversations.list', body: params, method: 'GET' });

// 修正後（CORRECT）
slackClient.call({ endpoint: 'users.list',        query: params, method: 'GET' });
slackClient.call({ endpoint: 'conversations.list', query: params, method: 'GET' });
```

**根本原因**: `ApiClient.call`（HttpClient.gs:436-448）は GET/HEAD/DELETE の `body` を無視し警告ログを出力する。クエリパラメータは `request.query` のみが `buildUrl()` に渡される（HttpClient.gs:426）。

```javascript
// HttpClient.gs:436-447
const hasBody = request.body != null;
const canHaveBody = !/^(GET|HEAD|DELETE)$/.test(method);
if (hasBody) {
  if (canHaveBody) {
    options.payload = JSON.stringify(request.body);
  } else if (log) {
    log.warn(`[HTTP] ⚠ ${method}リクエストでbodyが検出されました。無視されます。`);
  }
}
```

**影響**:
1. `limit: 200` が未送信 → Slack のデフォルト件数が使用される（軽微）
2. **`cursor` が未送信 → API は常に1ページ目を返す → `do...while(cursor)` が無限ループする**

小規模ワークスペース（全ユーザーが1ページ以内）では顕在化しないが、ページネーションが発生する環境で GAS タイムアウトまで無限ループする致命的バグ。

**テスト不備（→ ST-1）**: テストモックが `options.query` を検証せず呼び出し回数のみをカウントしていたため、このバグが検出されなかった。

---

### SR-3 [M]: `create(null)` で TypeError **[optional chaining 導入により修正済み]**

**ファイル**: `SlackResolvers.gs:43-45`

デフォルト引数 `= {}` は `undefined` のみ適用され `null` は通過する。SR-2 の修正（`dictionaries?.users ?? {}`）で optional chaining を導入したことにより、`create(null)` でも `null?.users` → `undefined` → `undefined ?? {}` → `{}` として安全に処理される。

---

### SF-1 [L]: アロー関数引数の括弧（CODING_RULES §4.2 違反） **[修正済み]**

**ファイル**: `SlackFilters.gs:21`

```javascript
// 修正前
const toString = (v) => v == null ? '' : String(v);
// 修正後
const toString = v => v == null ? '' : String(v);
```

CODING_RULES §4.2「アロー関数では引数1つの `()` を省略する」に違反。

---

### SF-2 [L]: `switch` キーワードのスペーシング不一致 **[修正済み]**

**ファイル**: `SlackFilters.gs:231`

```javascript
// 修正前（スペースなし）
switch(c) {
// 修正後（スペースあり・L180 の switch (match) { と統一）
switch (c) {
```

---

### SR-1 [L]: アロー関数引数の括弧（CODING_RULES §4.2 違反） **[修正済み]**

**ファイル**: `SlackResolvers.gs:29, 53, 63`

```javascript
// 修正前
const fallback = (v) => v;
toUserId: (v) => { ... }
toChannelId: (v) => { ... }
// 修正後
const fallback = v => v;
toUserId: v => { ... }
toChannelId: v => { ... }
```

---

### SR-2 [L]: `||` の代わりに `??` が推奨（CODING_RULES §4.2 違反） **[修正済み]**

**ファイル**: `SlackResolvers.gs:44, 45, 55, 65, 111`

CODING_RULES §4.2「`??` 推奨（`||` と違い `0` や `false` をデフォルト値で上書きしない）」に違反。

```javascript
// 修正前
const usersMap = dictionaries.users || {};
return usersMap[s] || fallback(s);
const profile = m.profile || {};

// 修正後
const usersMap = dictionaries?.users ?? {};  // optional chaining で SR-3 も解消
return usersMap[s] ?? fallback(s);
const profile = m.profile ?? {};
```

---

### ST-1 [L]: テストモックがクエリパラメータを未検証 **[修正済み]**

**ファイル**: `SlackResolvers.test.gs`

SR-B1 の根本原因の一つ。2回目の `users.list` 呼び出し時に `options.query?.cursor === 'page2'` であることを検証するアサーションを追加し、回帰を防止。

```javascript
// 追加したアサーション
if (callCountUsers === 2 && options.query?.cursor !== 'page2') {
  throw new Error('Expected cursor=page2 in query on 2nd call, got: ' + JSON.stringify(options.query));
}
```

---

## 5. 修正サマリー

| ID | 重要度 | ファイル | 概要 | ステータス |
|---|---|---|---|---|
| SR-B1 | **H** | SlackResolvers.gs:102, 168 | GET `body` → `query`（無限ループ防止） | **修正済み** |
| SR-3 | **M** | SlackResolvers.gs:44-45 | `create(null)` の null 安全性 | **修正済み** |
| SF-1 | L | SlackFilters.gs:21 | アロー関数括弧 `(v) =>` → `v =>` | **修正済み** |
| SF-2 | L | SlackFilters.gs:231 | `switch(c)` → `switch (c)` | **修正済み** |
| SR-1 | L | SlackResolvers.gs:29, 53, 63 | アロー関数括弧 `(v) =>` → `v =>` | **修正済み** |
| SR-2 | L | SlackResolvers.gs:44, 45, 55, 65, 111 | `\|\|` → `??` 演算子統一 | **修正済み** |
| ST-1 | L | SlackResolvers.test.gs | モック `query.cursor` 検証追加 | **修正済み** |

**要対応 0件。検討事項 T-1 を継続記録。**

---

## 6. 総合所見

`SlackFilters.gs` は純粋関数の集合体として設計・実装ともに高水準であり、今回の修正はスタイル面の軽微な調整に留まる。

`SlackResolvers.gs` では **SR-B1（High）** として分類した致命的バグを発見・修正した。`users.list` および `conversations.list` への GET リクエストで `body` フィールドにページネーションパラメータを渡していたが、`ApiClient` が GET リクエストの `body` を無視するため `cursor` が一切送信されず、大規模ワークスペースで `do...while` ループが無限ループする状態であった。`body: params` → `query: params` への変更により修正済み。このバグがテストで検出されなかった原因（モックが `query.cursor` を検証していなかった）も合わせて修正し、回帰防止のアサーションを追加した。

コーディング規則違反（アロー関数括弧・`??` vs `||`）は全件修正し、CODING_RULES.md との整合性を回復した。

---

---

<a name="第8版"></a>

# 第8版 — PR #7 Range サポート 再レビュー（2026-02-08）

- **対象**: PR #7 (`claude/add-range-support-LrSSl`) — loadFromSheetAsObjects への Range サポート追加
- **差分**: 10コミット / 5ファイル変更（+809 / -459）
- **前回からの改善**: 第3版で指摘した 18件のうち 14件修正済み、2件設計意図クローズ、2件テスト除外

---

## 1. 全体アーキテクチャ総評

### 1.1 設計パターンの一貫性

| パターン | 適用箇所 | 評価 |
|---|---|---|
| IIFE モジュール | HttpCore, ClientHelper, ApiClient, WebhookClient, SlackCore, SlackApiClient, SlackWebhookClient, GSC, LoggerFacade, SlackFilters, resolveSheet, loadFromRangeAsObjects | GAS V8 の `const` スコープ制約に適合。全モジュールで一貫 |
| Transport + Decorator | HttpCore.withRetry, withLogger, withBearerAuth, withGoogleAuth, SlackCore.withRetry | 関心の分離が明確。合成可能で拡張に強い |
| Immutable Builder | ApiClient.extend() | 元クライアントを変更しない。安全な機能積層 |
| Plugin Injection | ClientHelper.use() | 拡張性が高く、サードパーティプラグインにも対応 |
| Facade | LoggerFacade | SLF4J 互換の5レベル。多様なロガー実装を吸収 |
| Factory + Static | WebhookClient, SlackWebhookClient | create() でインスタンス生成、send() で使い捨て呼び出し |
| "切るだけ" | loadFromRangeAsObjects / loadFromSheetAsObjects | 意味推論・型変換を行わない設計原則が徹底 |

**総合評価**: 設計の一貫性は高い。各モジュール間の責任分離が明確であり、共通基盤（HttpCore, LoggerFacade）を通じたコード再利用が効果的に機能している。

---

## 2. モジュール別詳細レビュー

### 2.1 HttpClient.gs

#### HttpCore（L32-238） — 品質: A-

HTTP 通信の共通基盤。Transport パターンで抽象化した fetch インターフェースに Decorator で withRetry・withLogger を積み重ねる設計。

**良い点**:
- `interpretResponse()` でレスポンス解釈とエラー生成を一元化。`HttpError` にステータス・ヘッダー・ボディ・リクエスト情報を全て保持
- `withRetry()` の `RetryExhaustedError` 名前付きエラーにより二重ログ防止（H-1, H-2 の修正成果）
- `hasHeader()` が `Object.keys().some()` を使用しプロトタイプチェーン汚染を回避（M-3 の修正成果）
- GET/HEAD/DELETE リクエストで body が指定された場合、警告ログを出力して無視（RFC 準拠）

**注意点**: `withRetry` と `SlackCore.withRetry` の構造的重複 → 検討事項 T-1

#### ClientHelper（L245-322） — 品質: A

**良い点**:
- `createHttpMethods()` で `options` を先にスプレッドし、明示的な `method`/`endpoint`/`body`/`query` が後置されるため意図しないオーバーライドを防止（M-1 の修正成果）
- `use()` にプラグイン戻り値の型検証を追加。Object 以外は `TypeError` をスロー（L-1 の修正成果）

#### ApiClient（L339-478） — 品質: A

**良い点**:
- `buildUrl()` / `buildQueryString()` が配列パラメータ・null スキップに対応
- `extend()` がヘッダーをクローンし、トランスポートのみを差し替えるイミュータブル設計
- `responseHandler` でレスポンス後処理を設定に集約
- デフォルト HTTP メソッドを `GET` に変更（L-2 の修正成果）

#### WebhookClient（L499-574） — 品質: A

**良い点**:
- `create()` + `send()` の二重インターフェースが使いやすい
- `HttpCore.interpretResponse()` を利用してレスポンス形式を統一
- パラメータ再代入を排除（M-6 の修正成果）

---

### 2.2 SlackClient.gs

#### SlackCore（L27-123） — 品質: B+

**良い点**:
- 429 レスポンスの `Retry-After` ヘッダーを尊重（Slack API の推奨プラクティスに準拠）
- `parseInt(retryAfter, 10) || 1` で NaN 安全性を確保（M-2 の修正成果）
- `RetryExhaustedError` 名前付きエラーで二重ログ防止（H-2 の修正成果）

**注意点**: HttpCore.withRetry との構造的重複 → 検討事項 T-1

#### SlackApiClient（L139-187） — 品質: A

- `slackResponseHandler` で `ok: false` を統一ハンドリング
- カスタムエラー型 `SlackApiError` に `code`, `metadata`, `response` を保持

#### SlackWebhookClient（L213-302） — 品質: A

- `SlackCore.withRetry` で Slack 固有のリトライポリシーを適用
- `body` が生テキスト（`"ok"`）なのは Slack Webhook のレスポンス形式を正確に反映（N-2: クローズ）

---

### 2.3 LoggerFacade.gs — 品質: A

- `resolve()` によるメソッド優先順位チェーンが明確（trace → finest → finer → debug → log 等）
- falsy 入力で null を返し、呼び出し側で `if (log)` の短絡評価が可能
- メソッドが見つからない場合は no-op（`() => {}`）を返し、呼び出し側のガード不要

---

### 2.4 LazyTemplate.gs — 品質: A-

- `{{{expression}}}` 構文でプレースホルダー・フィルター（`|`）・フォールバック（`||`）を簡潔に表現
- コンパイル済み式のキャッシュ（`Map`）で繰り返し評価を最適化
- フォールバック評価は `undefined`, `null`, `''` のみをスキップし `0` や `false` は有効値として扱う
- エクスポート処理が module.exports / window / global の3パターンに対応（H-3 の修正成果）

**注意点**:
- `applyFilters()` が未知のフィルター名を黙殺 → M-5（設計意図によりクローズ）
- `parseStringLiteral()` で `BACKSLASH_PLACEHOLDER`（U+E000 を含む固定文字列）を一時退避に使用。衝突には入力にその完全一致シーケンスが含まれる必要があり、実用上無視できるリスク

---

### 2.5 SlackFilters.gs — 品質: A

（詳細は第9版 §2 を参照）

---

### 2.6 resolveSheet.gs — 品質: A

**良い点**:
- 7種のソース形式（URL, シート名, 配列, オブジェクト3種, Sheet直接）をサポート
- `isUrl`, `getGid`, `getOrCreateSheet`, `throwCreateNotSupported` が IIFE スコープ内に定義（L-3 の修正成果）
- `create: true` オプションで「なければ作成」パターンに対応
- サポート外の型で `TypeError` をスロー（M-4 の修正成果）

---

### 2.7 loadAsObjects.gs（309行） — PR #7 で拡張 — 品質: A

旧 `loadFromSheetAsObjects.gs`（217行）を `loadAsObjects.gs`（309行）にリネームし、`loadFromRangeAsObjects` を新設。`loadFromSheetAsObjects` は委譲ラッパーに変更。

**アーキテクチャ: レイヤー分離（Range コア → Sheet ラッパー）**

```
loadFromRangeAsObjects (IIFE, コアロジック)
  ↑ 委譲
loadFromSheetAsObjects (薄いラッパー: resolveSheet → Range 取得 → 委譲)
```

| 設計観点 | 評価 | 詳細 |
|---|---|---|
| レイヤー分離 | 良好 | Range 操作（コア）と Sheet 解決（ラッパー）が明確に分離 |
| 後方互換性 | 完全維持 | `loadFromSheetAsObjects` の API シグネチャは変更なし |
| 既存パターンとの一貫性 | 良好 | IIFE モジュール、duck typing、型による引数自動判定を踏襲 |

**Duck Typing による Range 判定**:
```javascript
const isRange = source =>
    typeof source?.getA1Notation === 'function'
    && typeof source?.getSheetId !== 'function';
```
GAS の `Range` は `getA1Notation()` を持ち `getSheetId()` を持たない。否定条件 `getSheetId !== 'function'` は将来の GAS API 変更に対する安全マージンとして妥当。

**テストの品質** (`loadAsObjects.test.gs`):
- MockRange を新設し、任意の開始位置（startRow, startColumn）の Range をシミュレート
- Range オブジェクト・Range 文字列・Sheet 委譲の3パスを網羅
- 約40テストで十分なカバレッジ

---

### 2.8 GoogleSearchConsoleApiClient.gs — 品質: A

- `ScriptApp.getOAuthToken()` を毎回動的に取得（トークンの有効期限切れに自動対応）
- `normalizeSiteUrl()` で `sc-domain:` プレフィックスを適切に処理
- GSC 向けの緩やかなリトライ設定（maxRetries: 5, baseDelayMs: 1000ms）
- `withGoogleAuth` は Google API 共通の OAuth デコレータとしてエクスポート（M-7: 設計意図によりクローズ）

---

## 3. 指摘事項

### 前回レビュー（第3版）からの修正状況

| ID | 重要度 | モジュール | 概要 | ステータス |
|---|---|---|---|---|
| H-1 | High | HttpCore.withRetry | リトライ上限時の二重ログ | **修正済み** |
| H-2 | High | SlackCore.withRetry | 文字列マッチによるエラー識別 | **修正済み** |
| H-3 | High | LazyTemplate | strict mode でのエクスポート不成立 | **修正済み** |
| M-1 | Medium | ClientHelper | options によるオーバーライド | **修正済み** |
| M-2 | Medium | SlackCore | Retry-After parseInt NaN 安全性 | **修正済み** |
| M-3 | Medium | HttpCore | hasHeader の hasOwnProperty ガード欠落 | **修正済み** |
| M-4 | Medium | resolveSheet | 最終フォールバックが無効な型を返す | **修正済み** |
| M-5 | Medium | LazyTemplate | applyFilters が未知フィルターを黙殺 | クローズ（設計意図） |
| M-6 | Medium | WebhookClient 他 | パラメータ再代入 | **修正済み** |
| M-7 | Medium | GSC Client | withGoogleAuth のエクスポート | クローズ（設計意図） |
| M-8 | Medium | TestRunner | グローバル可変状態 | 対象外（テストコード） |
| M-9 | Medium | SlackClient.test.gs | slackResponseHandler テスト複製 | **修正済み** |
| L-1 | Low | ClientHelper | use() のプラグイン戻り値型検証なし | **修正済み** |
| L-2 | Low | ApiClient | デフォルトメソッドが POST | **修正済み** |
| L-3 | Low | resolveSheet | 内部関数の毎回再生成 | **修正済み** |
| L-4 | Low | HttpClient.test.gs | assertDeepEqual の JSON.stringify 制約 | **修正済み** |
| L-5 | Low | GSC Client | JSDoc 誤字 | **修正済み** |
| L-6 | Low | SlackClient.test.gs | Retry-After NaN テスト不足 | **修正済み** |

### 第4〜5版 新規指摘

| ID | 重要度 | モジュール | 概要 | ステータス |
|---|---|---|---|---|
| N-1 | — | HttpCore, SlackCore | withRetry の構造的重複（~70% 共通） | 検討事項 T-1 に移行 |
| N-2 | — | SlackWebhookClient | WebhookClient.send とのレスポンス形式不一致 | クローズ（ベストプラクティス） |
| N-3 | Low | ApiClient | extend() で logger が二重ラップされる | **修正済み** |
| N-4 | Low | ApiClient | DELETE リクエストの body 取り扱い | **修正済み** |
| N-5 | Low | ApiClient | createClient 内部の純粋関数が毎回再定義 | **修正済み** |
| N-6 | Low | SlackFilters | slackDate(null) と slackDate(undefined) の非対称挙動 | **修正済み** |
| N-7 | Low | GSC Client | withRetry に logger 未指定（リトライログ不可視） | **修正済み** |

### PR #7 新規指摘

| ID | 重要度 | モジュール | 概要 | ステータス |
|---|---|---|---|---|
| R-1 | **High** | test-runner.js | ファイルリネームに追従していない（テスト実行不能） | **修正済み**（コミット `0162171`） |

---

## 4. 総合所見

前回レビューで指摘した High 3件はすべて修正され、致命的な問題は解消された。特に評価できる点:

- **Transport + Decorator パターン**の一貫した適用により認証・リトライ・ロギングの合成が柔軟かつ安全
- **LoggerFacade** による多様なロガー実装の吸収がライブラリ全体の可搬性を高めている
- **responseHandler パターン**の導入により API 固有のレスポンス処理がクリーンに統合
- **「切るだけ」設計原則**が明確に定義・徹底されている

**PR #7 判定**: マージ可。要対応の指摘事項 0件。
