# loadAsObjects

スプレッドシートのデータを JavaScript オブジェクトの配列として読み込むユーティリティです。

---

## 何ができるか

スプレッドシートの **1行目をキー名（ヘッダー）**、**2行目以降をデータ**として扱い、各行をオブジェクトに変換して返します。

```
スプレッドシート:
| name  | age | city  |
|-------|-----|-------|
| Alice | 30  | Tokyo |
| Bob   | 25  | Osaka |

↓ loadFromSheetAsObjects(sheet)

[
  { name: "Alice", age: 30,  city: "Tokyo" },
  { name: "Bob",   age: 25,  city: "Osaka" },
]
```

> **設計思想**: "loader は切るだけ"
> このライブラリは型変換・構造の推測・値の補正を**一切行いません**。
> セルの値はそのまま返します。何をオブジェクトにするかは、ヘッダー名とキーマッパー関数（後述）だけで決まります。

---

## 関数一覧

| 関数 | 対象 |
|------|------|
| `loadFromSheetAsObjects(source, ...)` | シート全体を対象にする場合 |
| `loadFromRangeAsObjects(source, ...)` | 範囲を指定する場合 |

どちらも同じオプション引数（`fn`, `limit`, `offset`）を受け取ります。

---

## 基本的な使い方

### シート全体を読み込む

```javascript
// Sheet オブジェクトを渡す
const data = loadFromSheetAsObjects(sheet);

// シート名で指定（アクティブなスプレッドシートから探す）
const data = loadFromSheetAsObjects('顧客リスト');

// URL で指定
const data = loadFromSheetAsObjects('https://docs.google.com/spreadsheets/d/XXXX/edit#gid=0');
```

### 範囲を指定して読み込む

```javascript
// Range オブジェクト
const data = loadFromRangeAsObjects(sheet.getRange('B2:E20'));

// A1 表記の文字列
const data = loadFromRangeAsObjects('A1:D10');

// 別シートを含む A1 表記
const data = loadFromRangeAsObjects('Sheet2!A1:D10');
```

---

## オプション引数

すべてのオプションは**省略可能**で、**順序を問わず型で自動判定**されます。

```javascript
loadFromSheetAsObjects(source)                    // 全行読み込み
loadFromSheetAsObjects(source, fn)                // キーを変換
loadFromSheetAsObjects(source, limit)             // 上限行数だけ読む
loadFromSheetAsObjects(source, limit, offset)     // スキップしてから読む
loadFromSheetAsObjects(source, fn, limit, offset) // すべて指定
```

> `fn` と `limit`/`offset` は**どの順番で渡しても正しく動作します**。
> `fn` は Function 型、`limit`/`offset` は number 型で区別されます。

---

## キーマッパー（`fn`）

`fn` を渡すと、ヘッダー行のセル値（生キー）をオブジェクトのキーに変換できます。

```javascript
fn(rawKey: string, columnIndex: number): string | string[] | null | undefined
```

| 戻り値 | 動作 |
|--------|------|
| `string` | そのキー名でフラットに設定 |
| `string[]` | ネストしたパスで設定（後述） |
| `null` または `undefined` | その列をスキップ |

### キー名を変換する

```javascript
// ヘッダーをすべて小文字にする
const data = loadFromSheetAsObjects(sheet, key => key.toLowerCase());

// スペースをアンダースコアに置換
const data = loadFromSheetAsObjects(sheet, key => key.replace(/ /g, '_'));
```

### 特定の列を除外する

```javascript
const data = loadFromSheetAsObjects(sheet, key =>
  key === '内部ID' ? null : key
);
```

### ネスト構造を作る

`fn` が配列を返すと、そのパスに値をセットしたネスト済みオブジェクトが作られます。

```javascript
// ヘッダー: "user.name", "user.age", "city"
const data = loadFromSheetAsObjects(sheet, key => key.split('.'));

// 結果:
// { user: { name: "Alice", age: 30 }, city: "Tokyo" }
```

> **注意**: 途中のパスがすでに非オブジェクト値で埋まっている場合は上書きされます。

---

## 配列キー（`[]` サフィックス）

ヘッダー名の末尾に `[]` をつけると、**同名のキーを配列としてまとめます**。

```
スプレッドシート:
| name  | tags[] | tags[] |
|-------|--------|--------|
| Alice | js     | ts     |

↓ loadFromSheetAsObjects(sheet)

[{ name: "Alice", tags: ["js", "ts"] }]
```

### ネストと組み合わせる

```javascript
// ヘッダー: "user.tags[]", "user.tags[]"
const data = loadFromSheetAsObjects(sheet, key => key.split('.'));

// 結果: [{ user: { tags: ["js", "ts"] } }]
```

### `[]` をキー名の一部として扱う（エスケープ）

`[]` を配列指定でなく文字通りのキー名にしたい場合は `\[]` と書きます。

```
ヘッダー: "tags\[]"  → キー名は "tags[]"（配列にならない）
```

---

## 件数制限とオフセット（`limit` / `offset`）

大量データの先頭だけ読みたい場合や、ページングに使えます。

```javascript
// 先頭 100 行だけ読む
const data = loadFromSheetAsObjects(sheet, 100);

// 先頭 10 行をスキップして読む
const data = loadFromSheetAsObjects(sheet, Infinity, 10);

// 10 行スキップして、その後 50 行だけ読む
const data = loadFromSheetAsObjects(sheet, 50, 10);
```

- `limit`: データ行（ヘッダー除く）の最大取得数。デフォルトは `Infinity`（全件）。
- `offset`: ヘッダー直後からスキップするデータ行数。デフォルトは `0`。

---

## `loadFromSheetAsObjects` のソース指定

`loadFromSheetAsObjects` は `resolveSheet` を通じて多様なソース指定をサポートします。

| 形式 | 例 |
|------|----|
| Sheet オブジェクト | `sheet` |
| シート名（文字列） | `'顧客リスト'` |
| URL | `'https://docs.google.com/spreadsheets/d/ID/edit#gid=0'` |
| 配列 `[urlOrId, name]` | `['SPREADSHEET_ID', 'Sheet1']` |
| 配列 `[urlOrId, index]` | `['SPREADSHEET_ID', 0]` |
| オブジェクト | `{ urlOrId: 'ID', name: 'Sheet1' }` |
| オブジェクト（厳密指定） | `{ url: 'URL', index: 0 }` / `{ id: 'ID', name: 'Sheet1' }` |

> **シート選択の優先順位**
> 1. `index` または `name` が指定されていれば優先
> 2. URL に `gid=` パラメータがあればそれで選択
> 3. いずれもなければ最初のシート

---

## エラー

| 状況 | 発生するエラー |
|------|----------------|
| `source` に Range でも文字列でもない値を渡した | `TypeError` |
| シートが見つからない | `Error` |
| `fn` の戻り値が文字列でも配列でもない（`null`/`undefined` 以外） | 結果は未定義 |

---

## 空データの扱い

- ヘッダー行のみ（データ行なし）→ `[]` を返す
- シートが完全に空 → `[]` を返す
- `offset` がデータ行数以上 → `[]` を返す
- `limit` が `0` → `[]` を返す

---

## 型変換について

このライブラリは**型変換を行いません**。スプレッドシートのセル値はそのまま JavaScript の値として返ります。GAS（Google Apps Script）の仕様上、数値は `number`、日付は `Date` オブジェクト、テキストは `string`、空セルは空文字列 `""` として返ります。

数値への変換や日付のフォーマットが必要な場合は、取得後に自分で処理してください。

```javascript
const data = loadFromSheetAsObjects(sheet);
const parsed = data.map(row => ({
  ...row,
  age: Number(row.age),
  createdAt: new Date(row.createdAt),
}));
```

---

## 依存関係

`loadFromSheetAsObjects` は内部で `resolveSheet` を使用します。
`loadFromRangeAsObjects` は `resolveSheet` に依存しません。
