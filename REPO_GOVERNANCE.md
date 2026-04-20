# リポジトリ作成統制：テンプレート強制の仕組み

> **付属文書の位置づけ**
> `AI_DRIVEN_DEV_GOVERNANCE.md` の補足。
> 非エンジニアが「統制済みリポジトリのクローンからしかプロジェクトを作れない」
> 仕組みの実現可能性と設計を検討する。

---

## 結論から

**実現できる。** GitHub の組織設定・テンプレートリポジトリ・MCP の3層を組み合わせることで、
「空リポジトリの作成禁止 ＋ テンプレートからの作成のみ許可」を技術的に強制できる。

---

## 問題の構造

```
やりたいこと:
  非エンジニアが新しいプロジェクトを始めるとき
  .claude/settings.json（Harness）
  .claude/commands/（Skills）
  CODING_RULES.md
  REVIEW.md 雛形
  が最初から入った状態でしか始められないようにする

やりたくないこと:
  空のリポジトリを作って、統制なしで自由に始めてしまう
```

---

## 実現の3層構造

### 層1 — GitHub Organization 設定（リポジトリ作成権限の制限）

GitHub Organization の設定で **メンバーのリポジトリ作成を全面禁止** できる。

```
GitHub Organization Settings
  → Member privileges
    → Repository creation
      → ☑ None（メンバーは一切リポジトリを作成できない）
```

この設定を入れた時点で、非エンジニアは GitHub UI・API を問わず
空リポジトリを作成できなくなる。
作成できるのは Organization の Owner または Admin だけになる。

**新しいプロジェクトの申請フロー（この設定下）**:

```
非エンジニア:「新しいプロジェクトを作りたい」
    ↓
Mgr/Tech が GitHub Template からリポジトリを作成して付与する
    ↓
非エンジニアはすでに .claude/ 入りのリポジトリを受け取る
```

**トレードオフ**: Mgr/Tech がボトルネックになる。
Tier 3（個人業務効率化）でも申請が必要になるため、機動性が落ちる。
→ §「Tier別の緩和策」参照。

---

### 層2 — GitHub Template Repository（テンプレート強制）

このリポジトリ（または専用のスターターリポジトリ）を
**GitHub Template Repository** として設定する。

```
リポジトリ Settings → General
  → ☑ Template repository
```

Template として設定されたリポジトリは、
「Use this template」ボタンから新しいリポジトリを生成できる。
生成されたリポジトリには `.claude/` ディレクトリが最初から含まれる。

**通常の git clone との違い**:

| 操作 | 結果 | 統制の有無 |
|---|---|---|
| `git clone` | 元リポジトリのコピー（origin が元のまま） | `.claude/` は入るが、別プロジェクトとしては不適 |
| GitHub Template から作成 | 新しい独立したリポジトリ（履歴なし、新 origin） | `.claude/` が入った状態で新規スタート ✅ |
| 空リポジトリから作成 | `.claude/` なし | 統制なし ❌ |

Template からの作成が「統制入りの正しいスタート」になる。

---

### 層3 — MCP による作成操作の制御（将来の拡張）

GitHub MCP サーバーを組織内でカスタマイズすることで、
**リポジトリ作成の操作自体をMCPレベルで制御**できる。

```javascript
// 組織内カスタム GitHub MCP サーバーの設計イメージ

tools: [
  {
    name: "create_repository",
    description: "新しいリポジトリを作成する",
    // 内部実装: template_repository パラメータなしの呼び出しを拒否
    handler: async (params) => {
      if (!params.template_owner || !params.template_repo) {
        throw new Error(
          "リポジトリはテンプレートから作成する必要があります。" +
          "template_owner と template_repo を指定してください。"
        );
      }
      // 指定されたテンプレートが組織承認済みかチェック
      if (!APPROVED_TEMPLATES.includes(`${params.template_owner}/${params.template_repo}`)) {
        throw new Error("承認済みテンプレートのみ使用できます。");
      }
      // 以降、GitHub API でテンプレートから作成
    }
  }
]
```

Claude が「新しいリポジトリを作って」と指示されても、
MCP を通じた場合は**テンプレート指定なしの作成が技術的に不可能**になる。

---

## 「.claude/ が入った状態」が何を意味するか

テンプレートから作成されたリポジトリには以下が含まれる。

```
新規プロジェクト（テンプレートから作成）
  .claude/
    settings.json    ← Harness（Tier 2 設定）
    commands/
      review.md      ← /review スキル
      use-library.md ← /use-library スキル
      init-project.md← /init-project スキル
  CODING_RULES.md    ← コーディング規約
  REVIEW.md          ← レビュー記録の雛形
```

非エンジニアがこのリポジトリで Claude Code を開いた瞬間、
**Harness の制限と Skills の呼び出しが最初から有効**になっている。
「統制の設定をする」という手順が存在しない。最初から統制された環境にいる。

---

## Tier 別の緩和策

層1の「全面禁止」は Tier 3 には過剰な制限になる場合がある。

| Tier | 推奨する制限 | 緩和策 |
|---|---|---|
| **Tier 1** | 空リポジトリ作成を全面禁止。Mgr/Tech が Template から作成して付与 | なし（厳格運用） |
| **Tier 2** | 同上 | なし |
| **Tier 3** | Template からの作成を「強く推奨」。空リポジトリも技術的には作成可 | 作成後 24 時間以内に `.claude/` がなければ GitHub App が自動プッシュ（後述） |

---

## GitHub App による事後強制（補完策）

層1の禁止設定を入れない場合の代替手段。
GitHub App が `repository.created` イベントを監視し、
`.claude/settings.json` のないリポジトリに自動対応する。

```
リポジトリ作成イベント発火
    ↓
GitHub App が .claude/settings.json の存在を確認
    ↓
存在しない場合:
  オプションA: テンプレートの .claude/ を含む PR を自動作成
              → 作成者がマージするまで main への push を制限
  オプションB: Organization Owner に通知
              → 一定時間後に是正がなければリポジトリをアーカイブ
  オプションC: 作成者に Slack DM で案内を自動送信
```

この GitHub App は比較的シンプルな Node.js アプリとして実装できる。
MCP の研究と並行して検討できる規模感。

---

## 推奨構成（段階的実装）

### フェーズ1（最小構成・即日実装可能）

```
□ このリポジトリを GitHub Template Repository として設定
□ Organization の Repository creation を None に設定
□ 「新しいプロジェクト申請→Mgr/Techが作成→付与」のフローを明文化
```

Mgr/Tech のボトルネックはあるが、統制は完全に機能する。
非エンジニアは最初から .claude/ 入りの環境でしか作業できない。

### フェーズ2（GitHub App による自動化）

```
□ repository.created イベントを監視する GitHub App を実装
□ 未承認テンプレートからの作成を検知して自動対応
□ Tier 3 の申請なし作成を許容しつつ事後に .claude/ を注入
```

### フェーズ3（MCP カスタマイズ）

```
□ 組織内 GitHub MCP サーバーのカスタマイズ
□ create_repository ツールをテンプレート強制版に差し替え
□ Claude 経由のリポジトリ作成が常にテンプレートベースになる
```

---

## 残る抜け穴と対処

| 抜け穴 | 発生条件 | 対処 |
|---|---|---|
| ローカルで `git init` して後で push | GitHub 側の制限を迂回 | Organization の push 先として承認済みリポジトリのみ許可（GitHub Enterprise 機能） |
| 個人アカウントで作成して後で移管 | Organization 外で作業 | 移管時に .claude/ の有無をチェックする GitHub App ルール |
| Template の .claude/ を削除して作業 | 統制ファイルの意図的な除去 | Branch protection + .claude/ の変更を Tech 承認必須にする |
| 別の Organization を使う | 統制外の場所で作業 | 組織ポリシー（利用規約）での対処。技術的な完全防止は困難 |

**重要な認識**: これらの抜け穴はすべて「意図的な迂回」が前提。
悪意のある迂回を完全に防ぐことは技術的に不可能。
この仕組みが防ぐのは「うっかり統制なしで始めてしまう」という **善意の失敗** である。
意図的な違反は組織ポリシーと責任の問題として扱う。

---

*本文書は `AI_DRIVEN_DEV_GOVERNANCE.md` §3（Tier制）および §11（技術強制層）と組み合わせて読む。*
