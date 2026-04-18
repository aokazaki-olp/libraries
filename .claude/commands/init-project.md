# /init-project — プロジェクト初期化スキル

新しい GAS ライブラリプロジェクトを、このリポジトリの標準構成で初期化する。

## 実行手順

### Step 1: Tier の確認

引数（`$ARGUMENTS`）から Tier を読み取る（tier1 / tier2 / tier3）。
指定がなければ以下を質問する。

```
プロジェクトの Tier を教えてください。

  tier1: 個人情報・機密情報を扱う、または外部公開システム
  tier2: 社内業務に影響する内部ツール（推奨: ほとんどのケース）
  tier3: 個人の業務効率化・試作品
```

### Step 2: プロジェクト名と概要の確認

```
プロジェクト名と概要を教えてください。
例: 「顧客リスト管理 — スプレッドシートから顧客データを読み込みSlackに通知する」
```

### Step 3: ファイル生成

以下のファイルを生成する。

#### 3-1. CODING_RULES.md

このリポジトリの CODING_RULES.md を雛形として、
プロジェクト名と概要を冒頭に記載したものを生成する。

#### 3-2. REVIEW.md

```markdown
# 設計レビュー・コードレビュー（累積版）

> {プロジェクト名} のコードレビュー記録。

## レビュー版一覧

| 版 | 対象 | レビュー日 | 新規指摘 | 要対応残 |
|---|---|---|---|---|
| （初版レビュー後に記入） | | | | |

---

*レビューを開始するには /review を実行してください。*
```

#### 3-3. .claude/settings.json（Tier に応じた内容）

Tier 1, 2, 3 で異なる内容を生成する（詳細は §4 参照）。

#### 3-4. .claude/commands/（スキルのコピー）

このリポジトリの `.claude/commands/` にある全スキルを、
新プロジェクトにもコピーする。

### Step 4: 完了メッセージ

```
プロジェクト初期化完了:

  生成したファイル:
    CODING_RULES.md
    REVIEW.md
    .claude/settings.json（Tier {N} 設定）
    .claude/commands/review.md
    .claude/commands/use-library.md
    .claude/commands/init-project.md

  次のステップ:
    1. コードを作成または追加する
    2. /review を実行してレビューを受ける
    3. H指摘が0件になったら技術承認者に PR を提出する
```

## 使い方

```
/init-project                  # Tier を質問してから初期化
/init-project tier2            # Tier 2 として初期化
/init-project tier3            # Tier 3 として初期化（最小構成）
```
