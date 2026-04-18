# Skills・Harness・MCP 基礎研究ガイド

> あなたが「統制下の自由」を実現するAI駆動開発プロセスの確立に向けて
> これから基礎研究を進めるための地図。
> このリポジトリ自体が最初の実験場として機能するよう設計されている。

---

## このリポジトリでの現在の実装状況

```
.claude/
  settings.json          ← Harness 設定（Tier 2 相当）
  commands/
    review.md            ← /review スキル
    use-library.md       ← /use-library スキル
    init-project.md      ← /init-project スキル
```

これらは「プロトタイプ」であり、基礎研究を通じて改善していく素材である。

---

## 研究テーマ1：Skills（スキル）

### 理解すべき核心

スキルとは「Claude への指示文をファイルとして保存したもの」に過ぎない。
しかし **「保存して再利用できる」** という点が組織統制において決定的に重要。

```
スキルなし:  Claude に毎回「CODING_RULES.md を読んでレビューして H/M/L で分類して...」と指示
スキルあり:  /review と打つだけで同じ指示が常に同じ品質で実行される
```

### 研究課題

```
[ ] スキルファイルのフォーマット仕様を確認する
    - $ARGUMENTS はどう渡されるか
    - ファイル名とコマンド名の対応規則
    - サブディレクトリは使えるか（例: .claude/commands/tier2/review.md）

[ ] /review スキルを実際に呼び出して動作確認する
    - 出力が REVIEW.md の標準フォーマットに合致しているか
    - 引数なし・あり両方を試す

[ ] スキルのスコープを確認する
    - プロジェクトローカル（.claude/commands/）と
      グローバル（~/.claude/commands/）の使い分けは？
    - 組織全体でスキルを共有する方法は？

[ ] スキルの限界を確認する
    - スキル実行中にエラーが起きた場合の挙動
    - 長大な手順をスキルに書いた場合の信頼性
    - スキルを呼び出すスキル（スキルの合成）は可能か
```

### 実験手順（このリポジトリで）

```bash
# 1. /review を実際に呼んでみる
#    Claude Code のセッションで:
#    /review HttpClient.gs

# 2. 出力された REVIEW.md の差分を確認
git diff REVIEW.md

# 3. フォーマットが崩れていれば .claude/commands/review.md を調整
```

### 改善すべき点（現在のプロトタイプの既知の弱点）

- `/review` スキルは手順を文章で書いているが、AIが解釈を誤る余地がある
  → より宣言的なフォーマット（テーブル・チェックリスト）の方が安定するか検証が必要
- `$ARGUMENTS` の扱いが未検証
- スキルの出力品質が Claude のモデルバージョンに依存する問題への対処法

---

## 研究テーマ2：Harness（ハーネス）

### 理解すべき核心

Harness とは Claude Code の実行環境を統制する設定ファイル群の総称。
`settings.json` と hooks の組み合わせが核心。

```
settings.json の役割:
  - allowedTools: Claude が使えるツールを制限
  - permissions: さらに細かくコマンドレベルで制限
  - hooks: 操作の前後に自動チェックを挟む
```

現在の `.claude/settings.json` はこのリポジトリに置いてあるので
実際に Claude Code を使いながら挙動を確認できる。

### 研究課題

```
[ ] 権限設定の動作確認
    - deny に入れたコマンドを Claude が実行しようとしたとき何が起きるか
    - エラーメッセージはユーザーにどう見えるか
    - 「拒否されたことを Claude はユーザーに伝えるか」

[ ] フックの実装パターン
    - PreToolUse: 実行前チェックの書き方
    - PostToolUse: 実行後ログ・通知の書き方
    - Stop: セッション終了時の後処理の書き方
    - フックが失敗（exit 1）したとき Claude はどう振る舞うか

[ ] 設定ファイルのスコープ
    - プロジェクトローカル (.claude/settings.json) と
      グローバル (~/.claude/settings.json) の優先順位
    - Tier ごとに settings.json を分ける最良の方法

[ ] Harness の限界を確認する
    - Claude がツールを使わず「自分で実行せずユーザーに指示する」形で
      制限を迂回することはできるか
    - hooks のシェルスクリプトが複雑になったとき保守性はどうなるか
```

### 実験手順（このリポジトリで）

```bash
# 1. deny に入っているコマンドを Claude に頼んでみる
#    「このファイルを rm -rf してください」と指示

# 2. git push origin main を Claude に頼んでみる（Hookが発動するはず）

# 3. セッションを終了して Stop フックの動作を確認する

# 4. hooks のログが正しく記録されているか確認
git log --oneline -5
```

### 現在のプロトタイプの既知の弱点

```
[ ] hooks のシェルスクリプトが環境依存になっている
    → macOS / Linux / Windows での動作差異の検証が必要

[ ] PreToolUse フックの $CLAUDE_TOOL_INPUT_COMMAND 変数の仕様が要確認
    → 変数名が正しいか、エスケープが必要か

[ ] main/master への直接 push を防ぐ hooks が
    本当に機能するか実機検証が必要

[ ] データ分類チェック（個人情報の検出）は
    現在のプロトタイプには含まれていない
    → 正規表現によるパターンマッチで実装可能か検討が必要
```

---

## 研究テーマ3：MCP（Model Context Protocol）

### 理解すべき核心

MCP は「Claude が外部システムを操作するためのプラグイン仕様」。

```
Claude ─── MCP クライアント ─── MCP サーバー ─── 外部システム
                                  ↑
                          アクセス制御・ログがここに集中する
```

このリポジトリでは GitHub MCP がすでに使われている（`mcp__github__*` ツール群）。
それが「MCP の組織統制的な意味」を実際に示している。

### GitHub MCP から学べること

```
□ アクセス範囲の制限: aokazaki-olp/libraries のみ操作可能
  → 「どのリポジトリを許可するか」を設定で制御できる
  → 権限のないリポジトリへの操作はツール呼び出し自体が拒否される

□ 操作のログ: MCPを通じた操作は GitHub のイベントログに残る
  → 誰がいつ何をしたかの証跡が外部システム側に自動的に記録される

□ 構造化されたアクセス: raw な git push ではなく PR・マージという形式
  → アドホックな操作を排除し、承認フロー付きの操作のみを提供
```

### 研究課題

```
[ ] MCP サーバーの立て方の基礎を理解する
    - 最小構成の MCP サーバーを Node.js で実装してみる
    - ツール定義（name / description / inputSchema）の書き方

[ ] 組織内 MCP の設計を考える
    - 「認定ライブラリ参照 MCP」: このリポジトリの REVIEW.md から
      品質評価を返すだけの最小 MCP
    - 「スプレッドシート読み込み MCP」: loadFromSheetAsObjects を
      MCP ツールとしてラップしたもの（非エンジニアが使いやすいインターフェース）

[ ] MCP によるデータ分類の実装可能性
    - 社内DB MCP で個人情報カラムを自動マスクする実装
    - Claude がデータを要求したとき MCP サーバーがフィルタリングする

[ ] MCP の認証・認可
    - MCP サーバー自体に誰がアクセスできるかを制限する方法
    - 組織の認証基盤（SSO等）と MCP を統合する方法
```

### 最初に作るべき MCP（研究の出発点）

最小構成として「認定ライブラリ情報 MCP」を作ることを推薦する。

```javascript
// server.js（最小構成の例）
// このリポジトリの REVIEW.md を読んで品質情報を返す MCP

tools: [
  {
    name: "get_certified_libraries",
    description: "このプロジェクトで使用可能な品質評価済みライブラリの一覧を返す",
    inputSchema: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "何を作りたいか（例: Slack送信, スプレッドシート読み込み）"
        }
      }
    }
  },
  {
    name: "get_library_review",
    description: "特定ライブラリの品質評価詳細を返す",
    inputSchema: {
      type: "object",
      properties: {
        library_name: { type: "string" }
      },
      required: ["library_name"]
    }
  }
]
```

これが動けば:
- Claude が `get_certified_libraries("Slack送信")` を呼ぶ
- MCP サーバーが REVIEW.md を解析して SlackWebhookClient を返す
- Claude がその品質評価を踏まえてコードを生成する

という `/use-library` スキルの「MCP版」が実現する。

---

## 研究の優先順位と順序

```
Week 1-2: Skills の動作確認
  → /review を実際にこのリポジトリで動かし、出力の品質を評価
  → スキルファイルの仕様理解

Week 3-4: Harness の動作確認
  → settings.json の各設定が実際にどう機能するか実験
  → hooks の動作確認（特に PreToolUse）

Week 5-6: Skills + Harness の連携
  → スキルを呼んだときに Harness の制限が正しく機能するか
  → 「/review → 修正 → /review → PR作成」の完全サイクルを Harness 下で動かす

Week 7-8: MCP の入門
  → 最小構成の MCP サーバーを立てる（認定ライブラリ情報 MCP）
  → Claude が MCP ツールを呼び出す様子を観察

Month 3: 統合
  → Skills + Harness + MCP の組み合わせで
    「非エンジニアが /review を叩くだけで完全なレビューサイクルが回る」
    プロトタイプを構築
```

---

## 研究の記録方法

研究の気づき・発見・失敗はこのリポジトリに記録する。

```
RESEARCH_LOG.md  ← 日付付きの気づきメモ
.claude/commands/ ← スキルの改善版を随時コミット
.claude/settings.json ← Harness 設定の改善版を随時コミット
```

Git のコミット履歴が「研究の歩み」そのものになる。
このリポジトリのコミットログが開発の実証ケースになったのと同じように。

---

## この研究が解決しようとしている問いの整理

```
Q1: 非エンジニアが Claude に「好き勝手に頼む」状態で、
    なぜ品質が担保できるのか？
    → Skills がプロセスを代行するから

Q2: 非エンジニアが「やってはいけないこと」をしてしまうのを
    どう防ぐか？
    → Harness が技術的に不可能にするから

Q3: 組織のシステムへの接続をどう安全にコントロールするか？
    → MCP がゲートウェイとして仲介するから

Q4: これらを「守れ」と言わずに、自然に機能させるには？
    → 設定ファイルとしてリポジトリに含め、使うだけで統制が適用されるから
```

---

*この研究ガイドは研究の進捗に応じて更新する。*
*発見した仕様の誤りや改善点は随時コミットして記録する。*
