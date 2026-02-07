# 設計レビュー・コードレビュー（第4版 — 全面再レビュー）

- **対象**: `/home/user/libraries/` 配下の全ソースコード（8ファイル、テストコード除外）
- **レビュー日**: 2026-02-07
- **レビュー範囲**: HttpClient.gs, SlackClient.gs, LoggerFacade.gs, LazyTemplate.gs, SlackFilters.gs, resolveSheet.gs, loadFromSheetAsObjects.gs, GoogleSearchConsoleApiClient.gs

---

## 1. 全体アーキテクチャ総評

### 1.1 設計パターンの一貫性

本ライブラリは GAS V8 ランタイム向けのユーティリティ群であり、以下のパターンが一貫して適用されている。

| パターン | 適用箇所 | 評価 |
|---|---|---|
| IIFE モジュール | HttpCore, ClientHelper, ApiClient, WebhookClient, SlackCore, SlackApiClient, SlackWebhookClient, GSC, LoggerFacade, SlackFilters, resolveSheet, loadFromSheetAsObjects | GAS V8 の `const` スコープ制約に適合。全モジュールで一貫 |
| Transport + Decorator | HttpCore.withRetry, withLogger, withBearerAuth, withGoogleAuth, SlackCore.withRetry | 関心の分離が明確。合成可能で拡張に強い |
| Immutable Builder | ApiClient.extend() | 元クライアントを変更しない。安全な機能積層 |
| Plugin Injection | ClientHelper.use() | 拡張性が高く、サードパーティプラグインにも対応 |
| Facade | LoggerFacade | SLF4J 互換の5レベル。多様なロガー実装を吸収 |
| Factory + Static | WebhookClient, SlackWebhookClient | create() でインスタンス生成、send() で使い捨て呼び出し |
| "切るだけ" | loadFromSheetAsObjects | 意味推論・型変換を行わない設計原則が徹底 |

**総合評価**: 設計の一貫性は高い。各モジュール間の責任分離が明確であり、共通基盤（HttpCore, LoggerFacade）を通じたコード再利用が効果的に機能している。

### 1.2 モジュール依存グラフ

```
LoggerFacade ← HttpCore ← ApiClient ← SlackApiClient
                  ↑            ↑           GoogleSearchConsoleApiClient
                  ↑            ↑
             ClientHelper      WebhookClient ← SlackWebhookClient
                               ↑
                          SlackCore

LazyTemplate ← SlackFilters

resolveSheet ← loadFromSheetAsObjects
```

依存は単方向で循環がない。LoggerFacade が最下層に位置し、HttpCore が HTTP 基盤として全クライアントに共通サービスを提供する構造は健全。

### 1.3 前回レビューからの改善

前回レビュー（第3版）で指摘した18件のうち、14件が修正済み。品質は大幅に向上している。

| 修正済み（14件） | 設計意図クローズ（2件） | テスト除外（2件） |
|---|---|---|
| H-1, H-2, H-3, M-1, M-2, M-3, M-4, M-6, M-9, L-1, L-2, L-3, L-5, L-6 | M-5, M-7 | M-8, L-4 |

---

## 2. モジュール別詳細レビュー

### 2.1 HttpClient.gs（575行）

#### HttpCore（L32-238）

**品質: A-**

HTTP 通信の共通基盤。Transport パターンにより抽象化された fetch インターフェースに、Decorator パターンで withRetry・withLogger を積み重ねる設計。

**良い点**:
- `interpretResponse()` でレスポンス解釈とエラー生成を一元化。カスタムエラー型 `HttpError` にステータス・ヘッダー・ボディ・リクエスト情報を全て保持
- `withRetry()` の `RetryExhaustedError` 名前付きエラーにより、二重ログ防止（H-1, H-2 の修正成果）
- `hasHeader()` が `Object.keys().some()` を使用し、プロトタイプチェーン汚染を回避（M-3 の修正成果）
- `cloneHeaders()` / `mergeHeaders()` が spread で簡潔に実装

**注意点**:
- `withRetry` と `SlackCore.withRetry` の構造的重複 → N-1 参照

#### ClientHelper（L245-322）

**品質: A**

HTTP メソッドショートカットと Plugin Injection の共通ヘルパー。

**良い点**:
- `createHttpMethods()` で `options` を先にスプレッドし、明示的な `method`/`endpoint`/`body`/`query` が後置されるため、意図しないオーバーライドを防止（M-1 の修正成果）
- `use()` にプラグイン戻り値の型検証を追加。Object 以外は `TypeError` をスロー（L-1 の修正成果）
- 文字列 + 関数のショートカット形式 `use('name', client => () => ...)` が DX に優れる

**注意点**:
- `delete` ショートカットが body パラメータを受け付けない → N-4 参照

#### ApiClient（L339-478）

**品質: A**

REST API 用クライアント。`createClient()` + `extend()` によるイミュータブルなデコレータ積層。

**良い点**:
- `buildUrl()` / `buildQueryString()` が配列パラメータ・null スキップに対応
- `extend()` がヘッダーをクローンし、トランスポートのみを差し替えるイミュータブル設計
- `responseHandler` でレスポンス後処理を設定に集約。SlackApiClient・GSC クライアントで活用
- デフォルト HTTP メソッドを `GET` に変更し、汎用クライアントとしての直感性が向上（L-2 の修正成果）
- GET/HEAD リクエストで body が指定された場合、警告ログを出力して無視（堅牢な挙動）

**注意点**:
- `extend()` で logger が二重ラップされる → N-3 参照
- 内部の純粋関数が毎回再定義される → N-5 参照

#### WebhookClient（L499-574）

**品質: A**

Webhook 送信クライアント。シンプルで明確な設計。

**良い点**:
- `create()` + `send()` の二重インターフェースが使いやすい
- `maxRetries: 0` でリトライ無効化、`logger` 指定でロギング有効化の制御が明快
- `HttpCore.interpretResponse()` を利用してレスポンス形式を統一
- パラメータ再代入を排除（`options = {}` デフォルト引数）（M-6 の修正成果）

---

### 2.2 SlackClient.gs（303行）

#### SlackCore（L27-123）

**品質: B+**

Slack 固有の Retry-After ヘッダー対応リトライ。

**良い点**:
- 429 レスポンスの `Retry-After` ヘッダーを尊重（Slack API の推奨プラクティスに準拠）
- `parseInt(retryAfter, 10) || 1` で NaN 安全性を確保（M-2 の修正成果）
- `RetryExhaustedError` 名前付きエラーで二重ログ防止（H-2 の修正成果）

**注意点**:
- HttpCore.withRetry との構造的重複 → N-1 参照

#### SlackApiClient（L139-187）

**品質: A**

Slack Web API クライアント。`ApiClient` の `responseHandler` パターンを活用。

**良い点**:
- `slackResponseHandler` で Slack 固有のエラー（`ok: false`）を統一的にハンドリング
- カスタムエラー型 `SlackApiError` に `code`, `metadata`, `response` を保持
- `extend()` チェーンで認証・リトライ・ロギングを積層する構成が明快

#### SlackWebhookClient（L213-302）

**品質: A-**

Slack Incoming Webhooks クライアント。

**良い点**:
- `SlackCore.withRetry` を使用して Slack 固有のリトライポリシーを適用
- カスタムエラー型 `SlackWebhookError` でステータスとボディを保持
- `maxRetries: 0` でリトライ無効化が可能
- パラメータ再代入を排除（M-6 の修正成果）

**備考**:
- `body` が生テキスト（`"ok"`）なのは Slack Webhook のレスポンス形式を正確に反映（N-2: ベストプラクティスによりクローズ）

---

### 2.3 LoggerFacade.gs（103行）

**品質: A**

SLF4J 互換のロガーファサード。

**良い点**:
- `resolve()` によるメソッド優先順位チェーンが明確（trace → finest → finer → debug → log 等）
- falsy 入力（null, undefined, false, 0, 空文字）で null を返し、呼び出し側で `if (log)` の短絡評価が可能
- メソッドが見つからない場合は no-op（`() => {}`）を返し、呼び出し側のガード不要
- console, GAS Logger, Winston, java.util.logging 等の多様な実装に対応

**コードの健全性**:
- 行数が少なく（103行）、単一責任が徹底されている
- IIFE でスコープを分離し、外部には `createLogger` のみを公開

---

### 2.4 LazyTemplate.gs（663行）

**品質: A-**

ランタイム非依存の遅延評価テンプレートエンジン。

**良い点**:
- `{{{expression}}}` 構文でプレースホルダー、`|` でフィルター、`||` でフォールバックの3機能を簡潔に表現
- コンパイル済み式のキャッシュ（`this.cache = new Map()`）による繰り返し評価の最適化
- `stripWhitespaceWithoutStringLiteral()` で文字列リテラル内の空白を保持しつつ正規化
- プロパティアクセス（ドット記法・ブラケット記法）の完全サポート
- 18個のプリミティブフィルター（文字列操作・数値変換・型変換・JSON）が組み込み済み
- `registerFilter()` で実行時のフィルター追加が可能
- バックスラッシュによるエスケープ機構（`\{{{...}}}` でリテラル出力）
- エクスポート処理が module.exports / window / global の3パターンに対応（H-3 の修正成果）
- フォールバック評価は `undefined`, `null`, `''` のみをスキップし、`0` や `false` は有効値として扱う（明確な仕様）

**注意点**:
- `applyFilters()` が未知のフィルター名を黙殺する → 前回 M-5（未対応、詳細後述）
- `parseStringLiteral()` で Unicode PUA（U+E000）を一時プレースホルダーに使用。入力にこの文字が含まれる場合に誤動作するが、極めて稀なケース

---

### 2.5 SlackFilters.gs（467行）

**品質: A**

Slack Mrkdwn・Block Kit 対応の18個の拡張フィルター。

**良い点**:
- 全フィルターが `v => ...` の統一シグネチャで LazyTemplate と完全互換
- 副作用なしの純関数のみ
- 命名規則が一貫（`escape*`, `slack*`）
- Mrkdwn 装飾フィルター（bold, italic, strike, code, pre）が空文字入力時に空の装飾を生成しない
- `escapeMrkdwn` / `escapeHtml` / `escapeJson` のエスケープ順序が正しい（`&` を最初にエスケープ）
- `escapeJson` が制御文字 U+0000〜U+001F を完全にカバー
- 日時フィルター（slackDate, slackDateFmt）が `Number.isFinite()` で型安全性を確保

**注意点**:
- `slackDate(null)` と `slackDate(undefined)` の非対称挙動 → N-6 参照

---

### 2.6 resolveSheet.gs（221行）

**品質: A**

柔軟なソース指定からシートを解決するユーティリティ。

**良い点**:
- 7種のソース形式（URL, シート名, 配列, オブジェクト3種, Sheet直接）をサポート
- `isUrl`, `getGid`, `getOrCreateSheet`, `throwCreateNotSupported` が IIFE スコープ内に定義され、毎回の再生成を回避（L-3 の修正成果）
- `create: true` オプションで「なければ作成」パターンに対応
- `create` と `index`/`gid` の組み合わせを明示的にエラーとする防御的設計
- サポート外の型で `TypeError` をスロー（M-4 の修正成果）
- Sheet オブジェクトの直接パススルー（`getSheetId` メソッドの存在チェック）

**コードの健全性**:
- 複雑な入力形式の判定ロジックが整理されており、各分岐が明確

---

### 2.7 loadFromSheetAsObjects.gs（217行）

**品質: A**

スプレッドシートからオブジェクト配列への変換。

**良い点**:
- 「切るだけ」の設計原則が徹底（意味推論・型変換・構造の自動補正を一切行わない）
- 引数の型による自動判定（Function, number）で柔軟な呼び出しインターフェース
- `parseSuffix()` による `[]` サフィックスの配列展開と `\[]` のエスケープ
- `setNested()` によるパス配列の深層セット
- `fn` で null/undefined を返すことで列のスキップが可能
- `limit` / `offset` による部分読み込みでメモリ効率を確保

**コードの健全性**:
- 入力バリデーション（型チェック）が各内部関数で徹底
- `resolveSheet` を活用してソース解決を完全に委譲

---

### 2.8 GoogleSearchConsoleApiClient.gs（81行）

**品質: A-**

Google Search Console API クライアント。

**良い点**:
- `ScriptApp.getOAuthToken()` を毎回動的に取得（トークンの有効期限切れに自動対応）
- `normalizeSiteUrl()` で `sc-domain:` プレフィックスを適切に処理（末尾スラッシュを追加しない）
- `gscResponseHandler` で `response.body` のみを返すシンプルなハンドラ
- `ApiClient.createClient()` + `extend()` チェーンで認証・リトライ・ロギングを構成
- GSC 向けの緩やかなリトライ設定（maxRetries: 5, baseDelayMs: 1000ms）

**備考**:
- `withGoogleAuth` は Google API 共通の OAuth デコレータとしてエクスポート。他の Google API クライアント追加時に再利用する前提（M-7: 設計意図によりクローズ）

---

## 3. 指摘事項

### 重要度の定義

| ランク | 意味 |
|---|---|
| **H (High)** | バグまたはデータ損失・予期しない動作に直結する問題 |
| **M (Medium)** | 堅牢性・保守性に影響する問題。修正推奨 |
| **L (Low)** | 改善が望ましいが影響は限定的 |

---

### 前回レビューからの未対応指摘

#### M-5: LazyTemplate.applyFilters — 未知のフィルター名を黙殺（設計意図によりクローズ）

**ファイル**: `LazyTemplate.gs:440-448`
**ステータス**: 対応しない（設計意図）

未知のフィルター名やキー参照のタイポが黙殺される挙動について、以下の理由で現状維持とする。

1. **影響範囲の一貫性**: フィルター名のタイポだけでなく、キー参照のタイポも同様に `undefined` → 空文字として処理される。警告を出すなら全箇所に統一的に適用すべきだが、テンプレート評価のホットパスに警告ログを挟むのは過剰
2. **依存関係の独立性**: LazyTemplate は LoggerFacade に依存しないランタイム非依存モジュールとして設計されている。警告のために LoggerFacade 依存を追加するのは設計方針に反する
3. **「何もしない」の一貫性**: 未知の参照に対して黙って空文字を返す挙動は、テンプレートエンジンとしてのフォールバック動作として合理的

---

#### M-7: GoogleSearchConsoleApiClient — withGoogleAuth のエクスポート（設計意図によりクローズ）

**ファイル**: `GoogleSearchConsoleApiClient.gs:80`
**ステータス**: 対応しない（設計意図）

`withGoogleAuth` は Google 系 API 共通の OAuth デコレータであり、以下の理由で公開を維持する。

1. **再利用性**: Google Analytics, Google Drive 等の Google API クライアントを追加する際に、同じ `withGoogleAuth` デコレータを `extend()` チェーンで利用できる。内部に隠蔽すると各クライアントで同一実装の重複が発生する（N-1 と同種の問題）
2. **暫定的な名前空間**: 現時点では GSC の名前空間に配置しているが、Google API クライアントが増えた際に適切な共通名前空間に移動する前提の暫定措置

---

### 新規指摘

#### N-1: HttpCore.withRetry と SlackCore.withRetry の構造的重複（検討事項）

**ファイル**: `HttpClient.gs:126-187`, `SlackClient.gs:37-120`
**重要度**: **L (Low)** — 検討事項として格下げ

HttpCore.withRetry（62行）と SlackCore.withRetry（84行）は以下のロジックが共通しており、~70% が重複している。

| 共通ロジック | HttpCore | SlackCore |
|---|---|---|
| ループ制御 (`for attempt`) | L142 | L52 |
| 429/5xx ステータス判定 | L147 | L57, L79 |
| `RetryExhaustedError` 名前付きエラー | L153 | L68, L85 |
| catch 内の再スロー判定 | L167 | L99 |
| lastError 管理 | L170 | L103 |
| 指数バックオフ | L131-135 | L41-45 |

**差分**:
- SlackCore は 429 と 5xx を別処理し、429 の場合に `Retry-After` ヘッダーを尊重
- SlackCore は固定 baseDelay = 1000ms（HttpCore は設定可能）

**リスク**: 一方にバグ修正を適用しても、もう一方に適用漏れが発生する（実際に H-1/H-2 の修正時にこのリスクが顕在化した）。

**検討ポイント**:
- `Retry-After` は RFC 7231 Section 7.1.3 で定義された標準ヘッダーであり、Slack 固有ではない。HttpCore.withRetry が本来対応すべき範囲とも言える
- HttpCore に Retry-After 対応を入れれば SlackCore.withRetry の存在意義がほぼなくなり、統合が自然な流れになる
- 一方で strategy パターン（shouldRetry / getDelay の注入）を導入すると設計の複雑度が上がる
- 現状は重複があっても動作に問題はなく、H-1/H-2 修正時のリスクも解消済み

**結論**: 統合の方向性は正しいが、設計の複雑度とのトレードオフがある。新たな API クライアント（Retry-After 対応が必要なもの）を追加するタイミングでの統合が適切

---

#### N-2: SlackWebhookClient.send と WebhookClient.send のレスポンス形式不一致（ベストプラクティスによりクローズ）

**ファイル**: `HttpClient.gs:554-555`, `SlackClient.gs:270-275`
**重要度**: クローズ

| | WebhookClient.send | SlackWebhookClient.send |
|---|---|---|
| レスポンス解釈 | `HttpCore.interpretResponse()` | 自前処理 |
| `body` フィールド | パース済み JSON (`Object`) | 生テキスト (`string`, 通常 `"ok"`) |

Slack Webhook は成功時に `"ok"` のプレーンテキストを返す。`body` に生テキストを格納するのは API の実際のレスポンス形式を正確に反映しており、JSON パースして無理にオブジェクト化しないのがベストプラクティス。エラー処理も `SlackWebhookError`（Slack 固有の文脈情報を持つ）で行うのが適切であり、汎用の `HttpError` にフォールバックすべきでない。

---

#### N-3: ApiClient.extend で logger が二重ラップされる

**ファイル**: `HttpClient.gs:466-472`, `HttpClient.gs:407`
**重要度**: **L (Low)**

```javascript
// extend() (L466-472)
const extend = decorator => createClient({
  baseUrl,
  logger: log,           // ← LoggerFacade.createLogger() の戻り値
  headers: HttpCore.cloneHeaders(headers),
  transport: decorator(transport),
  responseHandler
});

// createClient() 内 (L407)
const log = LoggerFacade.createLogger(config.logger);  // ← 再度ラップ
```

`extend()` が `log`（`LoggerFacade.createLogger()` の戻り値、5メソッドを持つオブジェクト）を渡し、`createClient()` 内部で再度 `LoggerFacade.createLogger()` に渡す。

**動作上の影響**: `LoggerFacade.createLogger()` は渡されたオブジェクトの `trace`/`debug`/`info`/`warn`/`error` メソッドを検出するため、結果は正しい。ただし、`resolve()` が新しいクロージャラッパーを生成するため、`extend()` を N 回呼ぶと呼び出しチェーンが N+1 段になる。

**修正案**: `extend()` で元の `config.logger` を保持して渡す。
```javascript
const extend = decorator => createClient({
  baseUrl,
  logger: config.logger,    // ← 元のロガー実装を渡す
  headers: HttpCore.cloneHeaders(headers),
  transport: decorator(transport),
  responseHandler
});
```

---

#### N-4: delete HTTP メソッドショートカットが body を受け付けない

**ファイル**: `HttpClient.gs:262-263`
**重要度**: **L (Low)**

```javascript
delete: (endpoint, options) =>
  call({ ...options, method: 'DELETE', endpoint })
```

`put`, `patch`, `post` は第2引数に `body` を受け付けるが、`delete` は受け付けない。HTTP 仕様上 DELETE with body は非推奨だが、一部 API（Elasticsearch, GitHub API 等）で使用される。

**緩和**: `call()` で直接 body を指定すれば対応可能。
```javascript
client.call({ method: 'DELETE', endpoint: '/resource', body: { id: 123 } });
```

**修正案（任意）**:
```javascript
delete: (endpoint, body, options) =>
  call({ ...options, method: 'DELETE', endpoint, body })
```

---

#### N-5: ApiClient.createClient 内部の純粋関数が毎回再定義される

**ファイル**: `HttpClient.gs:368-403`
**重要度**: **L (Low)**

`trimRightSlash`, `trimLeftSlash`, `encodeKeyValue`, `buildQueryString`, `buildUrl` が `createClient()` 呼び出しのたびに再定義される。`extend()` が内部で `createClient()` を呼ぶため、典型的な3段 extend チェーン（auth → retry → logger）で5つの関数 × 4回 = 20個の関数オブジェクトが生成される。

**影響**: クライアント生成は通常1回（起動時）のため、実行時パフォーマンスへの影響は無視できる。メモリ使用量も GAS のコンテキストでは問題にならない。

**修正案（任意）**: config に依存しない純粋関数を IIFE スコープ（`ApiClient` の直下）に移動する。
```javascript
const ApiClient = (function () {
  const trimRightSlash = s => String(s).replace(/\/+$/, '');
  const trimLeftSlash = s => String(s).replace(/^\/+/, '');
  const encodeKeyValue = (key, value) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`;

  // ...
  const createClient = config => {
    // trimRightSlash 等を直接参照
  };
})();
```

---

#### N-6: slackDate(null) と slackDate(undefined) の非対称挙動

**ファイル**: `SlackFilters.gs:308-314`
**重要度**: **L (Low)**

```javascript
const slackDate = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return toString(v);
  }
  return `<!date^${Math.floor(n)}^{date_short_time}|${toString(v)}>`;
};
```

| 入力 | `Number(v)` | `isFinite` | 出力 |
|---|---|---|---|
| `null` | `0` | `true` | `<!date^0^{date_short_time}|>` |
| `undefined` | `NaN` | `false` | `""` |

`null` と `undefined` を同等に扱う呼び出し元にとって予期しない挙動になり得る。これは JavaScript の `Number()` の仕様に起因する既知の挙動であり、テスト（SlackFilters.test.gs）で期待値を修正済み。

**修正案（任意）**: null ガードを追加する。
```javascript
const slackDate = v => {
  if (v == null) return '';
  const n = Number(v);
  // ...
};
```

---

## 4. カスタムエラー型の整理

本ライブラリで定義されている4つのカスタムエラー型を整理する。

| エラー名 | 定義箇所 | 付与プロパティ | スロー条件 |
|---|---|---|---|
| `HttpError` | HttpClient.gs:94-101 | `status`, `headers`, `body`, `text`, `request` | HTTP 2xx 以外のレスポンス |
| `RetryExhaustedError` | HttpClient.gs:152-153, SlackClient.gs:67-68 | なし（メッセージのみ） | リトライ回数上限到達（429/5xx） |
| `SlackApiError` | SlackClient.gs:156-161 | `code`, `metadata`, `response` | Slack API レスポンス `ok: false` |
| `SlackWebhookError` | SlackClient.gs:279-283 | `status`, `body` | Slack Webhook 非2xx レスポンス |

全エラーは `Error` を継承し、`e.name` プロパティでカスタム名を設定する GAS V8 互換の方式を採用。`class CustomError extends Error` ではなく `new Error(); e.name = '...'` 方式であるため、`instanceof` での判定はできないが、`e.name === 'HttpError'` での判定は可能。

---

## 5. モジュール別評価サマリー

| モジュール | ファイル | 行数 | 品質 | 主な評価 |
|---|---|---|---|---|
| HttpCore | HttpClient.gs:32-238 | 207 | **A-** | Transport + Decorator の基盤が堅牢。H-1 修正済み。SlackCore との重複（N-1）が改善余地 |
| ClientHelper | HttpClient.gs:245-322 | 78 | **A** | Plugin Injection の設計が良好。型検証も追加済み |
| ApiClient | HttpClient.gs:339-478 | 140 | **A** | Immutable Builder が健全。responseHandler 統合で可読性向上 |
| WebhookClient | HttpClient.gs:499-574 | 76 | **A** | シンプルで明確。問題なし |
| SlackCore | SlackClient.gs:27-123 | 97 | **B+** | Retry-After 対応は適切。HttpCore との重複（N-1）が改善余地 |
| SlackApiClient | SlackClient.gs:139-187 | 49 | **A** | responseHandler パターンで簡潔。問題なし |
| SlackWebhookClient | SlackClient.gs:213-302 | 90 | **A** | 機能的に問題なし。レスポンス形式は Slack Webhook の仕様に忠実 |
| LoggerFacade | LoggerFacade.gs | 103 | **A** | SLF4J 互換の設計が簡潔で明確。問題なし |
| LazyTemplate | LazyTemplate.gs | 663 | **A** | テンプレートエンジンとして高機能。H-3 修正済み。M-5 は設計意図によりクローズ |
| SlackFilters | SlackFilters.gs | 467 | **A** | 純関数のみ。命名規則統一。問題なし |
| resolveSheet | resolveSheet.gs | 221 | **A** | 柔軟な入力対応。M-4, L-3 修正済み。全体的に健全 |
| loadFromSheetAsObjects | loadFromSheetAsObjects.gs | 217 | **A** | 「切るだけ」の設計原則が徹底。型による引数判定も明確 |
| GSC Client | GoogleSearchConsoleApiClient.gs | 81 | **A** | responseHandler 統合で簡潔。withGoogleAuth は Google API 共通デコレータとして公開（設計意図） |

---

## 6. 全指摘事項サマリー

### 前回レビューからの修正状況

| ID | 重要度 | モジュール | 概要 | ステータス |
|---|---|---|---|---|
| H-1 | High | HttpCore.withRetry | リトライ上限時の二重ログ | **修正済み** |
| H-2 | High | SlackCore.withRetry | 文字列マッチによるエラー識別 | **修正済み** |
| H-3 | High | LazyTemplate | strict mode でのエクスポート不成立 | **修正済み** |
| M-1 | Medium | ClientHelper | options によるオーバーライド | **修正済み** |
| M-2 | Medium | SlackCore | Retry-After parseInt NaN 安全性 | **修正済み** |
| M-3 | Medium | HttpCore | hasHeader の hasOwnProperty ガード欠落 | **修正済み** |
| M-4 | Medium | resolveSheet | 最終フォールバックが無効な型を返す | **修正済み** |
| M-5 | Medium | LazyTemplate | applyFilters が未知フィルターを黙殺 | **対応しない（設計意図）** |
| M-6 | Medium | WebhookClient 他 | パラメータ再代入 | **修正済み** |
| M-7 | Medium | GSC Client | withGoogleAuth のエクスポート | **対応しない（設計意図）** |
| M-8 | Medium | TestRunner | グローバル可変状態 | 対象外（テストコード） |
| M-9 | Medium | SlackClient.test.gs | slackResponseHandler テスト複製 | **修正済み** |
| L-1 | Low | ClientHelper | use() のプラグイン戻り値型検証なし | **修正済み** |
| L-2 | Low | ApiClient | デフォルトメソッドが POST | **修正済み** |
| L-3 | Low | resolveSheet | 内部関数の毎回再生成 | **修正済み** |
| L-4 | Low | HttpClient.test.gs | assertDeepEqual の JSON.stringify 制約 | **修正済み** |
| L-5 | Low | GSC Client | JSDoc 誤字 | **修正済み** |
| L-6 | Low | SlackClient.test.gs | Retry-After NaN テスト不足 | **修正済み** |

### 今回の新規指摘

| ID | 重要度 | モジュール | 概要 |
|---|---|---|---|
| N-1 | Low | HttpCore, SlackCore | withRetry の構造的重複（~70% 共通）— 検討事項 |
| N-2 | — | SlackWebhookClient | WebhookClient.send とのレスポンス形式不一致 | ベストプラクティスによりクローズ |
| N-3 | Low | ApiClient | extend() で logger が二重ラップされる | **修正済み** |
| N-4 | Low | ClientHelper | delete ショートカットが body を受け付けない |
| N-5 | Low | ApiClient | createClient 内部の純粋関数が毎回再定義 | **修正済み** |
| N-6 | Low | SlackFilters | slackDate(null) と slackDate(undefined) の非対称挙動 |

### 現在の総計

| 区分 | High | Medium | Low | 合計 |
|---|---|---|---|---|
| 今回新規（残存） | 0 | 0 | 3 (N-1, N-4, N-6) | 3 |
| 修正済み | 0 | 0 | 2 (N-3, N-5) | — |
| クローズ済み | 0 | 2 (M-5, M-7) | 1 (N-2) | — |
| **合計（要対応）** | **0** | **0** | **3** | **3** |

---

## 7. 推奨対応優先順位

### 継続改善（Low）
1. N-1: withRetry 統合 — 新規 API クライアント追加時に検討
2. N-4, N-6: ドキュメントまたは JSDoc での明記

---

## 8. 総合所見

全8ファイル・約2,500行のライブラリとして、設計の一貫性・コード品質ともに高い水準にある。前回レビューで指摘した High 3件はすべて修正され、致命的な問題は解消された。

特に評価できる点:
- **Transport + Decorator パターン**の一貫した適用により、認証・リトライ・ロギングの合成が柔軟かつ安全
- **LoggerFacade** による多様なロガー実装の吸収が、ライブラリ全体の可搬性を高めている
- **responseHandler パターン**の導入により、API 固有のレスポンス処理がクリーンに統合
- **「切るだけ」設計原則**（loadFromSheetAsObjects）が明確に定義・徹底されている
- GAS V8 ランタイムの制約内で、テスタビリティと拡張性のバランスが取れている

残存する指摘は Low 3件のみであり、いずれも機能的な影響は限定的。High・Medium の指摘はすべて解消済みまたは設計意図によりクローズ。N-1（withRetry の重複統一）は新規 API クライアント追加時の検討事項として残す。
