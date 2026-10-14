# ツールチェーンの版

CODING_RULES.md §8.1「固定した版とその理由は `package.json` の隣に書く」に基づく。

| 対象 | 固定 | 理由 |
|---|---|---|
| Node | `>=24.12.0`（`.node-version` は `24.12.0`） | 型注釈除去が stable になった最初の 24 系。`Error.isError` / `using` / ES2025 の API を 24.12.0 で実行して確認済み |
| TypeScript | `~6.0.3` | typescript-eslint の対応範囲が `<6.1.0`。7 系に上げると型情報を使う lint が動かない |
| `@types/node` | `^24` | 実行環境の下限（24.12）より新しい API が型を通らないようにする |
| `tsconfig.json` の `lib` | `ES2025` + `ESNext.Disposable` + `ESNext.Error` | `ESNext` 全体には Node 24 に無い `Temporal` / `Map.getOrInsert` が含まれる |
| `skipLibCheck` | `true` | `node_modules` は借り物（CODING_RULES.md §8.3）。vite の型定義が DOM の `Worker` を参照しており、DOM を外した `lib` では通らない |
