# Agent Directives

- すべてのユーザー向け出力を日本語で書くこと。
- Always respond in Japanese（日本語）.

## コーディング規約

@CODING_RULES.md
@PLUGIN_SYSTEM_RULES.md

規約本体の正本は `aokazaki-olp/coding-rules`。ここにあるのはコピーで、直接編集しない。

- 取り込み元: `coding-rules` の `develop`（`2b2689d`）の `nodejs/CODING_RULES.md` / `nodejs/PLUGIN_SYSTEM_RULES.md`

## 完了報告の前に

`npm run check`（lint・format の検査・typecheck・test・build）を通す。通らないまま完了と報告しない。

Node は `.node-version`（24.12 以上）で実行する。
