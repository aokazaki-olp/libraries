# コーディング規約 (CODING_RULES.md) — Node.js / TypeScript

> このドキュメントは Node.js/TypeScript プロジェクトのコーディング規則を定義します。
> GAS版 (`../CODING_RULES.md`) の思想を継承しつつ、TypeScript・ESM・async/await の文化を積極的に採用します。

---

## 1. 基本思想 (Philosophy)

GAS版から引き継ぐ二本柱を TypeScript の文脈で再定義します。

1. **型による堅牢性**: TypeScript の型システムをJavaのインターフェース・ジェネリクス的な発想で活用する。型は仕様書であり、コンパイラをペアプログラマーとして使う。
2. **TS/ES 文化の積極活用**: 型推論・Utility Types・async/await・ESM など、TypeScript/ES のイディオムを積極的に採用し、冗長な記述を避ける。

**重要**: TypeScript の型はコンパイル時のみ有効。外部入力（APIレスポンス・設定値等）は**型があってもランタイムガードを残す**。

迷った場合は「**可読性**」と「**実行時の堅牢性**」を優先する（GAS版と同じ）。

---

## 2. モジュール構造とファイル構成

### 2.1 モジュールパターン

GAS版の IIFE パターンは **ES Modules の `export` に置き換える**。

| GAS版 | Node.js/TS版 |
|---|---|
| `const X = (() => { ... })();` | `export const X = { ... }` |
| `function name() {}` (グローバル) | `export function name() {}` |

```typescript
// ✅ ES Modules
export const HttpCore = {
  createTransport,
  withRetry,
  withLogger,
};

// ❌ IIFE（Node.js/TSでは不要）
const HttpCore = (() => { ... })();
```

### 2.2 ファイルヘッダー

`'use strict'` は ESM では不要のため記載しない。ヘッダーは GAS 版と同様にシンプルに。

```typescript
/**
 * HttpClient.ts
 * @description HTTP通信の共通基盤（Transport・デコレータ・ユーティリティ）
 */
```

---

## 3. 命名規則 (Naming Conventions)

### 3.1 変数・定数命名

GAS版の規則を継承しつつ、TypeScript の型命名を追加する。

| スコープ / 役割 | 命名規則 | 詳細・例 |
|---|---|---|
| **「真の定数」** | `UPPER_SNAKE_CASE` | `const MAX_RETRY_COUNT = 5;` |
| **「定数オブジェクト」** | `UPPER_SNAKE_CASE` + `as const` | `const CONFIG = { ... } as const;`（`Object.freeze` の代わり） |
| **「再代入不可な変数」** | `camelCase` | `const currentUser = auth.getUser();` |
| **型・インターフェース** | `PascalCase` | `interface Transport`, `type HttpMethod` |
| **型パラメータ（ジェネリクス）** | `T`, `TResult`, `TOptions` 等 | 単純な場合は `T`、意味が必要な場合は `TXxx` |
| 短いスコープ（1〜3行） | **1文字変数 (推奨)** | `k`, `v`, `e`, `n` |
| 通常スコープ | **省略禁止** | `options` (not `opts`) |

### 3.2 `as const` vs `Object.freeze`

Node.js/TS では `as const` を優先する（コンパイル時の型情報が得られるため）。

```typescript
// ✅ as const（TypeScriptイディオム）
const CONFIG = {
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_BASE_DELAY_MS: 500,
} as const;

// △ Object.freeze（ランタイム凍結は必要な場合のみ）
```

---

## 4. 型システムの規則

### 4.1 必須事項

| 対象 | ルール | 詳細 |
|---|---|---|
| **`tsconfig`** | **`"strict": true` 必須** | 全ての厳格チェックを有効にする。これなしの TypeScript は型チェックが緩く意味が薄い。 |
| **`any`** | **使用禁止** | 外部データは `unknown` で受け、型ガードで絞る。やむを得ない場合は `// eslint-disable-next-line @typescript-eslint/no-explicit-any` とコメントで意図を明示。 |
| **`as`（型キャスト）** | **原則禁止** | fail-fast バリデーションで弾いていれば `as` は不要なはず。使う場合はコメントで理由を明示。 |
| **`!`（非nullアサーション）** | **原則禁止** | `?.` や事前チェックで対処する。 |
| **公開関数の戻り値型** | **明示必須** | `export` する関数・メソッドは戻り値型を必ず書く。内部実装は推論に任せてよい。 |

### 4.2 `interface` vs `type` の使い分け

| 用途 | 使うもの | 理由 |
|---|---|---|
| **公開APIの契約** | `interface` | Java のインターフェース的な発想。拡張・実装を想定。 |
| **Union 型** | `type` | `type HttpMethod = 'GET' \| 'POST' \| ...` |
| **Utility Types の組み合わせ** | `type` | `type Options = Partial<Config> & { logger?: Logger }` |
| **関数型** | `type` | `type Filter = (v: unknown) => unknown` |

```typescript
// 公開契約 → interface
export interface Transport {
  fetch(url: string, options: FetchOptions): Promise<RawResponse>;
}

// Union・内部表現 → type
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

### 4.3 外部データの扱い

APIレスポンス・JSON.parse 等の外部データは `unknown` で受け、型ガードで絞る。

```typescript
// ✅ unknown + 型ガード
const body: unknown = JSON.parse(text);
if (typeof body === 'object' && body !== null && 'access_token' in body) {
  // ここでは body.access_token にアクセス可能
}

// ❌ any（型チェックを完全に無効化）
const body: any = JSON.parse(text);
```

### 4.4 `enum` の禁止

TypeScript の `enum` は使用しない。GAS版の `Object.freeze` 思想を `as const` で継続する。

```typescript
// ✅ as const + Union型
const HTTP_STATUS = {
  OK: 200,
  TOO_MANY_REQUESTS: 429,
} as const;
type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];

// ❌ enum（ランタイム挙動が紛らわしい）
enum HttpStatus { OK = 200 }
```

---

## 5. 構文・スタイル規則

### 5.1 GAS版から継承する必須事項

以下は変更なく継承する。

| 対象 | ルール |
|---|---|
| **ブロックスタイル** | 必須 `{ ... }` + 改行（アロー関数の単一式は除く） |
| `forEach` | **使用禁止**。`for...of` を使う（`await` が使えるため特に重要） |
| `var` | **使用禁止** |
| **`switch` の `default`** | **必須** |
| **`switch` の `break`/`return`** | **必須** |
| **Yoda 条件** | **使用禁止** |

### 5.2 async/await 規則

| 対象 | ルール | 詳細 |
|---|---|---|
| **非同期関数** | `async/await` に統一 | `Promise.then()` チェーンは使わない |
| **`Promise` の直接 `return`** | `await` 不要な場合は省略可 | `return transport.fetch(...)` で十分な場合に `await` を足さない |
| **並列実行** | `Promise.all` を使う | 独立した非同期処理は逐次にしない |
| **エラーハンドリング** | `try/catch` で明示的に | Promise を握りつぶさない |

```typescript
// ✅ async/await
const call = async (request: RequestOptions): Promise<unknown> => {
  const response = await transport.fetch(url, options);
  return responseHandler(response);
};

// ✅ 並列実行
const [users, channels] = await Promise.all([
  fetchUsers(client),
  fetchChannels(client),
]);

// ❌ .then() チェーン
transport.fetch(url, options).then(response => { ... });
```

### 5.3 GAS版から継承する推奨事項

以下は変更なく継承する。

| 対象 | アクション |
|---|---|
| **`== null`** | null/undefined 一括チェックに積極活用 |
| **Null 合体演算子 `??`** | 推奨 |
| **オプショナルチェーン `?.`** | 推奨 |
| **分割代入** | 推奨 |
| **デフォルト引数** | 推奨 |
| **スプレッド構文** | 推奨 |
| **アロー関数** | 積極活用 |
| **一時変数の排除** | 推奨 |

---

## 6. エラー戦略と TSDoc

### 6.1 公開関数の TSDoc 必須項目

型情報は TypeScript の型定義で表現するため、`@param` の型注釈は不要。以下を記述する。

- `@param` — 引数の**意味・制約**（型は型定義側に書く）
- `@returns` — 戻り値の意味
- `@throws` — 例外を送出する場合
- 設計上の制限事項（該当する場合）

```typescript
/**
 * Salesforce API クライアントを作成する
 *
 * @param instanceUrl - 組織固有の My Domain URL (例: https://yourorg.my.salesforce.com)
 * @param accessToken - OAuth access_token
 * @param options - オプション設定
 * @returns クライアント
 * @throws {TypeError} instanceUrl / accessToken が空文字の場合
 */
export const create = (
  instanceUrl: string,
  accessToken: string,
  options: CreateOptions = {}
): SalesforceClient => { ... };
```

### 6.2 エラーの投げ分け

GAS版と同じ方針を継承する。

#### [A] 型バリデーションエラー (`TypeError`)
関数冒頭の fail-fast バリデーション用。**型があってもランタイムガードは省略しない**。

```typescript
if (!instanceUrl) {
  throw new TypeError('instanceUrl には空でない string を指定してください');
}
```

#### [B] ドメインエラー (`Error`)
API通信の失敗・期待するリソースが見つからない等、業務ロジック上のエラー用。

```typescript
throw new Error('Salesforce token response に access_token が含まれません');
```

#### [C] カスタムエラークラス
HTTP エラー等、エラーに追加情報を持たせたい場合。

```typescript
class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
```

---

## 7. ライブラリ設計の規則

このプロジェクトは**薄い汎用ライブラリ**として設計する。業務ロジック（SOQL クエリ・Block Kit 構築等）はプラグイン層に委ね、コアに混入させない。

### 7.1 公開APIの境界

`index.ts` を唯一のエントリーポイントとして、利用者に見せる型・値を明示的に制御する。

```typescript
// index.ts — 公開するものだけを列挙する
export { SalesforceApiClient } from './clients/SalesforceApiClient.js';
export { SlackApiClient, SlackWebhookClient } from './clients/SlackClient.js';
export type { BaseClient, Plugin, Logger } from './core/httpTypes.js';

// 内部実装は export しない
// HttpCore, ApiClient.createClient, withBearerAuth 等
```

### 7.2 Logger はインターフェースで公開する

`logger: unknown` は使わない。`Logger` インターフェースを公開し、利用者が実装を理解できるようにする。

```typescript
// ✅ インターフェースで契約する
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// console は構造的部分型として自動的に合う
SalesforceApiClient.create(url, token, { logger: console });
```

`LoggerFacade` は内部実装（アダプタ）として非公開のまま維持する。

### 7.3 ジェネリクスを利用者まで届ける

`unknown` を公開APIの戻り値に漏らさない。型パラメータをファクトリメソッドまで引き上げる。

```typescript
// ❌ unknown が利用者に漏れる
const sf = SalesforceApiClient.create(url, token);
const result = await sf.get('/query'); // result: unknown

// ✅ 型パラメータをファクトリで確定させる
const sf = SalesforceApiClient.create<SoqlResult>(url, token);
const result = await sf.get('/query'); // result: SoqlResult
```

### 7.4 依存の方向を一方向に保つ

```
plugins/ → core/（型のみ）
clients/ → core/
plugins/ は clients/ を import しない
clients/ は plugins/ を import しない
```

横断的な依存が生じた場合は設計を見直す。

### 7.5 型で証明できない箇所はコメントで明示する

TypeScript の型システムで表現できない保証（スプレッド合成・`as unknown as` 等）は、なぜ安全かをコメントで説明する。

```typescript
// スプレッド合成は型システムで証明不能: additionalMethods ∪ HttpMethods
client = { ...additionalMethods, ...httpMethods, call, extend, use } as unknown as BaseClient<TResponse, TMethods>;
```

---

## 8. プラグインシステムの規則

### 8.1 Plugin 型

プラグインは `Plugin` 型として一級市民で定義する。クラスは使わない。

```typescript
// core/httpTypes.ts
export type Plugin<TResponse, TNew extends object> =
  (client: BaseClient<TResponse>) => TNew;
```

### 8.2 Plugin は純粋関数

プラグインはステートレスな純粋関数とする。副作用・外部依存を持たない。

```typescript
// ✅ 純粋関数
const greetPlugin: Plugin<unknown, { greet(): string }> =
  (_client) => ({ greet: () => 'hello' });

// ✅ 設定を受け取る場合はファクトリ（プラグインを返す関数）
const timeoutPlugin = (ms: number): Plugin<unknown, { withTimeout(): ... }> =>
  (client) => ({ ... });

// 使い方は統一される
client.use(greetPlugin);
client.use(timeoutPlugin(3000));
```

### 8.3 Plugin セットの設計

関連するプラグインをまとめる場合は `as const` + `satisfies` でプラグインセットとして提供する。

```typescript
// plugins/salesforce.ts

// ジェネリクスで型を利用者まで届ける
const soql = <TRow = unknown>(): Plugin<unknown, {
  query(soql: string): Promise<{ records: TRow[]; totalSize: number; done: boolean }>;
}> => (client) => ({
  query: (soql) => client.get('/query', { q: soql }) as Promise<...>,
});

const sobject = <TRecord = unknown>(type: string): Plugin<unknown, {
  findById(id: string): Promise<TRecord>;
  create(data: Partial<TRecord>): Promise<{ id: string }>;
  update(id: string, data: Partial<TRecord>): Promise<void>;
  delete(id: string): Promise<void>;
}> => (client) => ({ ... });

// satisfies でプラグインセットの形を検証しつつ型推論を保つ
export const SalesforcePlugins = { soql, sobject } satisfies
  Record<string, (...args: never[]) => Plugin<unknown, object>>;
```

利用例:

```typescript
type Account = { Id: string; Name: string };

const sf = SalesforceApiClient.create(url, token)
  .use(SalesforcePlugins.soql<Account>())
  .use(SalesforcePlugins.sobject<Account>('Account'));

const res = await sf.query('SELECT Id, Name FROM Account');
// res.records: Account[]  ← 型が付く
```

### 8.4 プラグインセットと疎結合

プラグインセット（`plugins/`）は `core/` の型のみに依存し、`clients/` を import しない。
API クライアント固有の知識（エンドポイントパス等）はプラグイン内に閉じ込め、コアに漏らさない。

```typescript
// ✅ plugins/salesforce.ts
import type { BaseClient, Plugin } from '../core/httpTypes.js'; // core のみ

// ❌ clients/ を import してはいけない
import { SalesforceApiClient } from '../clients/SalesforceApiClient.js';
```

### 8.5 `as` キャストはプラグイン内に閉じ込める

`client.get()` の戻り値は `TResponse`（場合によっては `unknown`）。これをドメイン型に変換するための `as` キャストはプラグイン実装の内部に留め、利用者には型付きの結果のみを公開する。

```typescript
// プラグイン内部で as を閉じ込める（コメントで理由を明示する）
query: (soql) =>
  // BaseClient<unknown> の get 戻り値を SoqlResult<TRow> にキャスト
  // SF /query エンドポイントは必ずこの形を返すことが SF API 仕様で保証される
  client.get('/query', { q: soql }) as Promise<SoqlResult<TRow>>,
```
