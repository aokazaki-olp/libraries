# /use-library — 認定ライブラリ選択スキル

このリポジトリが提供する品質保証済みライブラリ（認定コンポーネント）を
要件に応じて推薦し、使い方のサンプルコードを生成する。

## 認定コンポーネントカタログ

以下はすべて REVIEW.md による品質評価済み（最終評価: 2026-02-25）。

| ライブラリ | ファイル | 品質 | 主な用途 |
|---|---|---|---|
| HttpCore | HttpClient.gs | A- | HTTP通信の基盤。リトライ・ロギング・認証を Decorator で合成 |
| ApiClient | HttpClient.gs | A | REST API クライアントの構築 |
| WebhookClient | HttpClient.gs | A | Webhook 送信 |
| SlackApiClient | SlackClient.gs | A | Slack API 呼び出し |
| SlackWebhookClient | SlackClient.gs | A | Slack への Webhook 送信 |
| LoggerFacade | LoggerFacade.gs | A | SLF4J 互換のロガー。GAS / Node.js 両対応 |
| LazyTemplate | LazyTemplate.gs | A- | テンプレートエンジン。フィルター・フォールバック対応 |
| SlackFilters | SlackFilters.gs | A | Slack mrkdwn 記法の装飾フィルター群 |
| SlackResolvers | SlackResolvers.gs | A | Slack ユーザー名 → ID の解決 |
| resolveSheet | resolveSheet.gs | A | スプレッドシートの柔軟な指定解決 |
| loadFromSheetAsObjects | loadAsObjects.gs | A | スプレッドシート → オブジェクト配列 |
| loadFromRangeAsObjects | loadAsObjects.gs | A | Range 指定でのスプレッドシート読み込み |
| deepFreeze | deepFreeze.gs | — | オブジェクトの再帰的凍結 |

## 実行手順

### Step 1: 要件の把握

引数（`$ARGUMENTS`）から「何を作りたいか」を読み取る。
引数がなければユーザーに「何をしたいか教えてください」と質問する。

### Step 2: 適切なライブラリの選定

要件とカタログを照合し、最適なライブラリを1〜3個選ぶ。

選定の指針:
- Slack への送信 → SlackWebhookClient（Webhook）または SlackApiClient（API）
- REST API 呼び出し → ApiClient
- スプレッドシートの読み込み → loadFromSheetAsObjects / loadFromRangeAsObjects  
- ログ出力が必要 → LoggerFacade を合わせて使う
- Slack メッセージの文字装飾 → SlackFilters + LazyTemplate

### Step 3: 選定理由と品質評価の提示

```
推薦: SlackWebhookClient（HttpClient.gs）
品質評価: A
理由: Slack Webhook 仕様に忠実な設計。SlackCore.withRetry でリトライ対応済み。
      REVIEW.md 第9版で全指摘0件を確認済み。
```

### Step 4: サンプルコードの生成

選定したライブラリを使ったサンプルコードを生成する。
コードは CODING_RULES.md のスタイルに従う。

### Step 5: 制限事項・注意点の提示

REVIEW.md に記載された「設計意図によりクローズした指摘」や
「継続中の検討事項」を要約して提示する。

## 使い方

```
/use-library                              # カタログ一覧を表示
/use-library Slack にメッセージを送りたい  # 要件から推薦
/use-library スプレッドシートを読み込む    # 要件から推薦
/use-library HttpClient.gs               # 特定ライブラリの詳細と使い方
```
