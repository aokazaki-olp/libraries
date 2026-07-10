# 設計レビュー・コードレビュー（累積版）

> GAS V8 ライブラリ群の設計・コード・コーディング規則適合性を記録する累積レビュードキュメント。
> 各版では対象 PR / コンポーネントの詳細分析を行い、指摘事項の追跡・管理を行う。

---

## レビュー版一覧

| 版 | 対象 | レビュー日 | 新規指摘 | 要対応残 |
|---|---|---|---|---|
| [第12版](#第12版) | PR #29〜#32 — GBizInfo v2 / InvoiceApiClient / Bulk API v2 / use()優先度修正 | 2026-07-10 | H×2, M×1, L×1 | **4件（H×2 は現行 main で再現する既知の不具合）** |
| [第11版](#第11版) | PR #18 — SalesforceApiClient + SalesforceAuth | 2026-05-02 | H×2, M×4, L×4 | **0件** |
| [第10版](#第10版) | PR #17 — GBizInfoApiClient | 2026-05-02 | L×2 | **0件** |
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
| GBizInfo Client | GBizInfoApiClient.gs | **A** | SlackApiClient と同型のミニマル構成。プロトコル層に厳密準拠 |

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

<a name="第10版"></a>

# 第10版 — PR #17 GBizInfoApiClient（2026-05-02）

- **対象**: `GBizInfoApiClient.gs`, `GBizInfoApiClient.test.gs`, `test-runner.js`
- **レビュー範囲**: 設計・コード・PHILOSOPHY 適合性・既存クライアントとの一貫性
- **変更**: 3ファイル / 新規追加 366行・テスト 16件追加（全 540 件緑）

## 1. 設計評価

PHILOSOPHY との整合は厳格。`SlackApiClient` と完全に同型のミニマル構成（プロトコル層のみ・`.use()` でドメイン層を呼び出し側に委譲）。

| 観点 | 評価 |
|---|---|
| §1.2 GASらしさテスト 3 問 | ✅ `create(token, logger)` の 1 行で利用開始 |
| §4.2 エンドポイントは呼び出し側 | ✅ `byCorporateNumber` 等は `.use()` 経由 |
| §4.3 プロトコル/ドメイン線引き | ✅ 認証・リトライ・ロギング・URL 構築のみ |
| §6.3 レスポンス独自ラップ禁止 | ✅ `response => response.body` で素通し |
| §3.2 イミュータブル `extend` | ✅ `ApiClient.createClient → extend → extend` |
| §6.5 5 行以内 | ✅ 初期化 1 行 |

### 認証層の実装方式

- GSC は動的トークン取得（`ScriptApp.getOAuthToken()` を毎リクエスト）が必要なため `withGoogleAuth` decorator 化
- gBizINFO は静的トークンなので `createClient({ headers: { 'X-hojinInfo-api-token': token } })` で十分
- 継ぎ目は壊れていない（`request.headers` で上書き可能）。**判定: 現状で OK**

## 2. 指摘

| ID | 重要度 | 内容 |
|---|---|---|
| GB-1 | L | `MockGBizUrlFetchApp` は `HttpClient.test.gs` / `GoogleSearchConsoleApiClient.test.gs` に続く 3 回目の同型再実装。**Rule of Three (§5.1) 該当**。共通テストヘルパへの抽出を次回検討（本 PR 外） |
| GB-2 | L | [GBizInfoApiClient.test.gs:227](GBizInfoApiClient.test.gs#L227) `assertEqual(true, call.url.endsWith(...))` の引数順序が他テストと逆。挙動は同じだが失敗時メッセージの可読性のため次回統一 |

## 3. 総合判断

Approve 相当。マージ前 must-fix なし。エンドポイント網羅の誘惑を退けた、PHILOSOPHY に忠実な良 PR。

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
- `parseStringLiteral()` で `BACKSLASH_SENTINEL`（`'\uE000__LT_BS__\uE000'`）を一時退避に使用。衝突には入力にその完全一致シーケンスが含まれる必要があり、実用上無視できるリスク

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

---

<a name="第11版"></a>

## 第11版

**対象**: PR #18 — `feat(Salesforce): API クライアント + JWT Bearer Flow 認証ヘルパを追加`
**レビュー日**: 2026-05-02
**ブランチ**: `feature/salesforce-api-client`
**追加ファイル**: `SalesforceApiClient.gs` (67行) / `SalesforceApiClient.test.gs` (233行) / `SalesforceAuth.gs` (125行) / `SalesforceAuth.test.gs` (295行) / `test-runner.js` (+9/-2)

### 1. 総評

`PHILOSOPHY.md` の規律（§4.2 プロトコル層 / §4.3 ドメイン層線引き / §6.5 OAuth 別動線 / §3.1 依存方向 / §3.2 immutable な extend / §6.3 素の JSON）にいずれも適合。`HttpCore` / `ApiClient` の既存の継ぎ目を新規概念ゼロで合成しており、`PHILOSOPHY.md §2.2` の「機能ではなく継ぎ目」を理想的に活用している。マージ可能な品質。ただし下記 H×2 / M×4 を直しておきたい。

### 2. 設計評価

| 観点 | 評価 |
|---|---|
| プロトコル層 / ドメイン層線引き（§4.3） | ✅ SOQL ヘルパや sObject CRUD を生やしていない |
| 初期化の軽さ（§1.2） | ✅ `SalesforceApiClient.create(instanceUrl, accessToken)` の 1 行 |
| OAuth 別動線（§6.5） | ✅ `SalesforceAuth` を別ファイル化、戻り値は素のオブジェクト |
| 依存逆転（§3.1） | ✅ Client ↔ Auth は互いを知らない |
| テスタビリティ | ✅ `getAccessTokenByJwt(opts, deps)` で transport / signer 注入可 |
| イミュータブル合成（§3.2） | ✅ `extend()` を 3 段重ねている |
| エラー戦略（CODING_RULES §5.2） | ✅ 事前条件 `TypeError` / HTTP は `HttpError` |

### 3. 指摘事項

#### SF-H1 [H]: `SalesforceAuth._defaultTransport` シングルトンが logger を初回呼び出しに永久束縛

[SalesforceAuth.gs:38-48](SalesforceAuth.gs#L38-L48)

```javascript
let _defaultTransport = null;
const getDefaultTransport = logger => {
  if (_defaultTransport === null) {
    _defaultTransport = HttpCore.withRetry(HttpCore.createTransport(), {
      maxRetries: DEFAULTS.MAX_RETRIES,
      baseDelayMs: DEFAULTS.BASE_DELAY_MS,
      logger          // ← 初回呼び出し時の logger に永久束縛
    });
  }
  return _defaultTransport;
};
```

2 回目以降の呼び出しで異なる `logger` を渡してもリトライ警告ログが期待先に流れない。GAS は実行ごとにプロセスが死ぬのでキャッシュの利益も薄い。**毎回構築する形に直す**。

#### SF-H2 [H]: `SalesforceAuth` のデフォルト transport に `withLogger` が無い

[SalesforceAuth.gs:41-45](SalesforceAuth.gs#L41-L45)

`SalesforceApiClient.create` は `withRetry` の外側に `withLogger` を被せている [SalesforceApiClient.gs:58-63](SalesforceApiClient.gs#L58-L63) のに対し、`SalesforceAuth` 側は `withRetry` のみ。token 取得の 401 / `invalid_grant` 調査時に可視化されないので、本体クライアントとログ粒度を揃えたい。

#### SF-M1 [M]: `responseHandler` が body のみ返すことが JSDoc に書かれていない

[SalesforceApiClient.gs:27](SalesforceApiClient.gs#L27)

`status` / `headers`（`Sforce-Limit-Info` / `X-Sfdc-Request-Id` 等）は捨てられる暗黙仕様。JSDoc に明記し、必要時は `extend` または独自 `responseHandler` で取得する旨を書く。

#### SF-M2 [M]: decorator 順序の意図がコメント無し

[SalesforceApiClient.gs:57-63](SalesforceApiClient.gs#L57-L63)

合成順は `withLogger(withRetry(withBearerAuth(base)))`。結果として `withLogger` 通過時には `Authorization` ヘッダが**まだ付いていない**ため token がログに流出しない。これは望ましい挙動だが意図的設計か偶然かが読めない。1 行コメントで意図を保全する。

#### SF-M3 [M]: `getAccessTokenByJwt` が `access_token` 欠落時に黙って `undefined` を返す

[SalesforceAuth.gs:118-121](SalesforceAuth.gs#L118-L121)

200 で `body.access_token` が無いケースで `accessToken: undefined` のまま `SalesforceApiClient.create(instanceUrl, undefined)` に渡ると `TypeError` が**遠くで**落ちる。明示エラー化（コスト極小）。

#### SF-M4 [M]: `CONFIG.DEFAULT_*` が options で override 不能

[SalesforceApiClient.gs:21-25](SalesforceApiClient.gs#L21-L25)

`apiVersion` のみ override 可、`MAX_RETRIES` / `BASE_DELAY_MS` は固定。命名と挙動の整合のために `DEFAULT_` プレフィックスを外すか、override パスを通すか統一する。

#### SF-L1 [L]: `apiVersion` の形式チェック無し（`'60.0'` がそのまま URL に乗る）

[SalesforceApiClient.gs:48](SalesforceApiClient.gs#L48)

#### SF-L2 [L]: 利用例 JSDoc に `.use()` パターンが無い

GoogleSearchConsoleApiClient 等と地続きの肌触りのため、`PHILOSOPHY.md §4.2` の `.use()` パターンを 1 例添える。

#### SF-L3 [L]: `signingInput === \`${headerB64}.${claimsB64}\`` の直接検証がテスト未実装

[SalesforceAuth.test.gs:234-247](SalesforceAuth.test.gs#L234-L247) では `signingInput.includes('.')` のみで、JWT 構築ロジックの将来リグレッション検知には弱い。

#### SF-L4 [L]: 生 transport を直叩きする理由がコメント無し

[SalesforceAuth.gs:115-116](SalesforceAuth.gs#L115-L116)

`ApiClient.createClient.call` を経由すると `JSON.stringify(body)` されてしまうため意図的に生 transport を使う設計。コメントで保全。

### 4. コーディング規則適合

- ファイルヘッダー JSDoc（CODING_RULES §2.2）✅
- `TypeError` メッセージ形式（§5.2-A）✅ `'... には ... を指定してください'`
- ブロックスタイル / `forEach` / `var` 不使用（§4.1）✅
- `??` / 分割代入 / デフォルト引数（§4.2）✅

### 5. 判定

**マージ可能**。ただし SF-H1 / SF-H2 / SF-M1 / SF-M3 は merge 前に解消推奨。SF-M2 / SF-M4 / SF-L* は後追いでも可。

---

---

<a name="第12版"></a>

# 第12版 — PR #29〜#32 まとめレビュー（2026-07-10）

- **対象**: PR #29（`feat(gbizinfo): v2 API 対応`）/ PR #30（`feat(invoice): 国税庁インボイス Web-API クライアント`）/ PR #31（`Add Bulk API v2 support`）/ PR #32（`fix(ApiClient): use() plugin 優先度修正`）
- **背景**: 4件とも既に `main` にマージ済みだが、累積 REVIEW.md には未反映だったため遡って一括レビューした。
- **レビュー範囲**: 設計・コード・コーディング規則適合性・テストの実効性（実際に `node test-runner.js` を実行して検証）

---

## 1. 総評

個々の設計は概ね堅実（gBizINFO/Invoice は既存クライアントと同型、Bulk API v2 は CSV ユーティリティを含め作り込みが丁寧）だが、**テスト基盤そのものが壊れている状態で `main` に取り込まれている**のが今回最大の問題。`node test-runner.js` を実行すると全テストスイートが1件も走らずに即クラッシュすることを確認した（下記 P32-H1）。加えて PR #31 で追加された Bulk API v2 の GAS テストスイートが `test-runner.js` に一度も登録されておらず、コミットメッセージ上の「全◯◯テスト pass」はこのスイートを含んでいない（下記 P31-H2）。両方とも**現在の `main` で実際に再現する**、要早急対応の指摘。

## 2. 新規指摘

### P32-H1 [H]: HttpClient.test.gs の新規テストが関数スコープ外に置かれ、テストランナー全体がクラッシュする **[要修正]**

**ファイル**: [HttpClient.test.gs:1511-1548](HttpClient.test.gs#L1511-L1548)（PR #32 で追加）

PR #32 で追加された「plugin と HTTP メソッド名衝突テスト」ブロックが `runEdgeCaseTests` の閉じ `};`（L1509）より後、かつ `runIntegrationTests` の開始（L1554）より前の**トップレベル**に置かれている。

```javascript
const runEdgeCaseTests = () => {
  ...
};                                                    // L1509 で関数終了

  // ─── plugin と HTTP メソッド名衝突テスト ────────────────────────
  suite('ApiClient.use() — HTTP メソッド名衝突');       // L1513 ← トップレベルで即実行される
  test('plugin の delete が HTTP delete に上書きされない', () => { ... });
  test('plugin の get が HTTP get に上書きされない', () => { ... });

const runIntegrationTests = () => { ... };
```

`suite` / `test` は各テスト関数内で `const { suite, test, ... } = TestRunner;` として関数スコープにのみ束縛されており、トップレベルには存在しない。実際に検証したところ、`node test-runner.js` はファイル読み込み時点で以下の例外を出して**全スイートが1件も実行されずに即終了**する。

```
HttpClient.test.gs:1511
  suite('ApiClient.use() — HTTP メソッド名衝突');
  ^
ReferenceError: suite is not defined
```

**影響範囲は Node.js テストランナーに留まらない**: GAS はプロジェクト内の任意の関数を実行する際にトップレベルのコードを評価するため、このテストファイルを本体ライブラリと同一の GAS プロジェクトへ貼り付けている運用（各ファイルヘッダーの「GAS エディタから runXxx() を実行」という記述が前提とする構成）では、**ライブラリ内のどの関数を呼んでも `ReferenceError` でスクリプト全体が起動不能になる**。

**修正方針**: 当該ブロックを `runEdgeCaseTests` 内（L1509 の `};` の手前）に移すか、独立した `const runUseCollisionTests = () => { const { suite, test, assertTrue } = TestRunner; ... };` として切り出して `runUnitTestsOnly()` 等の呼び出し列に追加する。

---

### P31-H2 [H]: SalesforceApiClientPlugins のテストスイートが test-runner.js に未登録 — 一度も実行されていない **[要修正]**

**ファイル**: [test-runner.js](test-runner.js), [SalesforceApiClientPlugins.gs](SalesforceApiClientPlugins.gs), [SalesforceApiClientPlugins.test.gs](SalesforceApiClientPlugins.test.gs)

PR #31 で `SalesforceApiClientPlugins.gs`（Bulk API v2 Ingest/Query + CSV ユーティリティ）と `SalesforceApiClientPlugins.test.gs`（`runAllSalesforceApiClientPluginsTests()` を含む約970行のテストスイート）が追加されたが、`test-runner.js` の `loadAndRun(...)` 読み込みリストにも `suites` 配列にも一切追加されていない。

```javascript
// test-runner.js — ソースファイル読み込み（GBizInfo/Invoice/Salesforce系）
loadAndRun('GBizInfoApiClient.gs');
loadAndRun('InvoiceApiClient.gs');
loadAndRun('SalesforceApiClient.gs');
loadAndRun('SalesforceAuth.gs');
// ← SalesforceApiClientPlugins.gs が抜けている

// suites 配列にも 'SalesforceApiClientPlugins' が存在しない
```

**根本原因**: 第8版 R-1（`test-runner.js` がファイルリネームに追従していない）と同型の「新規ファイル追加時の配線漏れ」。

**影響**: PR #31 のコミットメッセージには「GAS テストスイート」「Node.js テスト（424件全パス）」と記載されているが、GAS 側テスト（`runAllSalesforceApiClientPluginsTests()`）は `node test-runner.js` の実行対象に一度も含まれていない。CSV パーサー（RFC4180 準拠）・`mergeCsvPages`・`waitForCompletion` のポーリング終了判定など、ロジックが複雑で回帰しやすい箇所を含むため、CI 相当のチェックから漏れている状態は看過できない。

**修正方針**: `test-runner.js` に以下を追加する。
```javascript
loadAndRun('SalesforceApiClientPlugins.gs');   // ソース読み込み（SalesforceApiClient.gs の後）
...
loadAndRun('SalesforceApiClientPlugins.test.gs'); // テスト読み込み
...
{ name: 'SalesforceApiClientPlugins', fn: 'runAllSalesforceApiClientPluginsTests()' } // suites 配列
```

---

### P31-M1 [M]: `Utils.recordsToCsv` がヘッダー列を先頭レコードのみから導出する

**ファイル**: [SalesforceApiClientPlugins.gs:215-225](SalesforceApiClientPlugins.gs#L215-L225)

```javascript
recordsToCsv(records) {
  if (!records || records.length === 0) {
    return '';
  }
  const headers = Object.keys(records[0]);   // ← 先頭レコードのキーのみ採用
  ...
}
```

レコードごとにキー集合が異なる場合（例: 一部レコードのみ任意項目を持つ）、`records[0]` に存在しないフィールドは他のレコードに値があっても**無言で CSV から欠落**する。Bulk Ingest のアップロード用データ生成に使われるユーティリティであるため、意図しない列欠落がそのまま Salesforce への書き込み漏れに直結しうる。テスト（`SalesforceApiClientPlugins.test.gs`）にもキー集合が不揃いなケースの検証がない。

**対応案**: 全レコードのキー和集合からヘッダーを構築する（例: `[...new Set(records.flatMap(Object.keys))]`）か、最低限 JSDoc に「ヘッダーは先頭レコードから導出される」旨の制限事項を明記する。

---

### P29/P30-L1 [L]: `opts` という省略変数名が CODING_RULES §3.1 に違反

**ファイル**: [GBizInfoApiClient.gs:46](GBizInfoApiClient.gs#L46), [InvoiceApiClient.gs:56](InvoiceApiClient.gs#L56)

```javascript
const opts = options ?? {};   // ← "options" の省略形
const version = opts.version ?? CONFIG.DEFAULT_VERSION;
```

CODING_RULES §3.1「長い・通常のスコープでは変数名の省略禁止（`options`, not `opts`）」に反する。同じ課題（第2引数 `options` のデフォルト補完 + プロパティ取り出し）を `SalesforceApiClient.gs:60-65` は分割代入で回避している。

```javascript
// SalesforceApiClient.gs の書き方（省略形を作らない）
const {
  apiVersion = CONFIG.DEFAULT_API_VERSION,
  maxRetries = CONFIG.DEFAULT_MAX_RETRIES,
  baseDelayMs = CONFIG.DEFAULT_BASE_DELAY_MS,
  logger
} = options;
```

`GBizInfoApiClient.create` / `InvoiceApiClient.create` は `options` が `undefined` でも動く必要がある（バリデーション前提が `options?.version` 等になる）ため単純な分割代入デフォルト値だけでは足りないが、`const { version = CONFIG.DEFAULT_VERSION, logger } = options ?? {};` のように1行で同じことができ `opts` を作らずに済む。

---

## 3. 観察事項（指摘なし・設計意図として許容）

- **GBizInfoApiClient の破壊的シグネチャ変更**（PR #29）: `create(token, logger)` → `create(token, options)`。コミットメッセージで明示された意図的な破壊的変更であり、GAS 版・Node.js 版で一貫している。ただし、外部の GAS プロジェクトが旧シグネチャのまま `create(token, myLogger)` を呼び続けた場合、`myLogger` は `options` として解釈され `opts.logger` が `undefined` になり、**エラーにならずロガーだけが無言で失われる**。ライブラリ利用者への周知（バージョンノート等）が実施されているかは本レポートの範囲外だが、呼び出し側での気づきにくさは留意点として記録する。
- **InvoiceApiClient の認証 `id` とログ出力の関係**（PR #30）: `withQueryAuth` を最外層デコレータとして適用しているため、内側の `withLogger` は認証 `id` 付きの URL を観測しログに残す。これは PR #30 内のレビュー指摘（INV-M1）で既に把握・コメントで明記済みの既知のトレードオフであり、`InvoiceApiClient.gs` 冒頭の JSDoc にも注意書きがある。新規指摘としては扱わないが、将来ログを外部送信する構成に変更する場合はマスキングの要否を再検討すべき。

---

## 4. コーディング規則適合状況

| 項目 | GBizInfoApiClient | InvoiceApiClient | SalesforceApiClientPlugins | HttpClient (use()優先度修正) |
|---|---|---|---|---|
| ブロックスタイル / `forEach` 不使用 / `var` 不使用（§4.1） | ✅ | ✅ | ✅（PR内で `forEach` → `for...of` 修正済み） | ✅ |
| `??` / オプショナルチェーン（§4.2） | ✅ | ✅ | ✅ | ✅ |
| 変数名の省略禁止（§3.1） | ❌ `opts`（P29/P30-L1） | ❌ `opts`（P29/P30-L1） | ✅ | ✅ |
| `TypeError` メッセージ形式（§5.2-A） | ✅ | ✅ | N/A（型バリデーションなし） | N/A |
| JSDoc `@throws` 網羅 | ✅ | ✅ | ✅（PR内レビューで全メソッドに追加済み） | ✅ |

## 5. 総合判断

**個々の実装の設計品質は良好**（gBizINFO v2 移行・インボイス Web-API 対応・Bulk API v2 の CSV 処理はいずれも既存パターンを踏襲し丁寧に作られている）。しかし **P32-H1（テストランナー/GASプロジェクトのクラッシュ）と P31-H2（Bulk API v2 GAS テスト未実行）は現行 `main` で実際に再現する不具合であり、「テストは通っている」という前提そのものが成立していない状態**。次のアクションとして、まず P32-H1 を最優先で修正して `node test-runner.js` を復旧させ、その後 P31-H2 の配線漏れを直してから Bulk API v2 テストスイートが実際に緑になることを確認することを強く推奨する。P31-M1 / P29/P30-L1 は後続 PR での対応で可。

