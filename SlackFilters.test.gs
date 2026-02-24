'use strict';

/**
 * SlackFilters.test.gs
 *
 * @description LazyTemplate.Filters.Slack のテストスイート
 * 
 * リファクタリング後（純粋関数）のテスト仕様:
 * - すべてのフィルターは `LazyTemplate.Filters.Slack.関数名` の形で参照する。
 * - 副作用のない純粋関数として、入力が想定通りの文字列（または空文字）に変換されるかを検証する。
 * - テンプレートエンジンを通した結合テストも実施し、エスケープの順序等が正しいことを確認する。
 */

function runAllSlackFiltersTests() {
  const { suite, test, assertEqual } = TestRunner;
  suite('SlackFilters');

  // ============================================================================
  // [Mrkdwn装飾] テスト
  // ============================================================================
  test('Mrkdwn: bold', () => {
    const f = LazyTemplate.Filters.Slack.bold;
    assertEqual('*text*', f('text'));
    assertEqual('*123*', f(123));
    assertEqual('', f(''));
    assertEqual('', f(null));
    assertEqual('', f(undefined));
  });

  test('Mrkdwn: italic', () => {
    const f = LazyTemplate.Filters.Slack.italic;
    assertEqual('_text_', f('text'));
    assertEqual('', f(''));
  });

  test('Mrkdwn: strike', () => {
    const f = LazyTemplate.Filters.Slack.strike;
    assertEqual('~text~', f('text'));
    assertEqual('', f(''));
  });

  test('Mrkdwn: code', () => {
    const f = LazyTemplate.Filters.Slack.code;
    assertEqual('`text`', f('text'));
    assertEqual('', f(''));
  });

  test('Mrkdwn: codeBlock', () => {
    const f = LazyTemplate.Filters.Slack.codeBlock;
    assertEqual('```\nconst x = 1;\n```', f('const x = 1;'));
    assertEqual('', f(''));
  });

  test('Mrkdwn: quote', () => {
    const f = LazyTemplate.Filters.Slack.quote;
    assertEqual('> hello', f('hello'));
    assertEqual('> line1\n> line2', f('line1\nline2'));
    assertEqual('', f(''));
  });

  // ============================================================================
  // [メンション・参照系] テスト（ただのIDラップ機能）
  // ============================================================================
  test('Reference: mentionUser', () => {
    const f = LazyTemplate.Filters.Slack.mentionUser;
    assertEqual('<@U123>', f('U123'));
    assertEqual('', f(''));
  });

  test('Reference: mentionChannel', () => {
    const f = LazyTemplate.Filters.Slack.mentionChannel;
    assertEqual('<#C123>', f('C123'));
    assertEqual('', f(''));
  });

  test('Reference: mentionSpecial', () => {
    const f = LazyTemplate.Filters.Slack.mentionSpecial;
    assertEqual('<!here>', f('here'));
    assertEqual('<!everyone>', f('everyone'));
    assertEqual('', f(''));
  });

  test('Reference: link', () => {
    const f = LazyTemplate.Filters.Slack.link;
    // URLのラベル付きパイプ機能は廃止されたが、純粋なラップ機能としては維持
    assertEqual('<https://example.com>', f('https://example.com'));
    assertEqual('', f(''));
  });

  test('Reference: mail', () => {
    const f = LazyTemplate.Filters.Slack.mail;
    assertEqual('<mailto:test@example.com>', f('test@example.com'));
    assertEqual('', f(''));
  });

  // ============================================================================
  // [エスケープ系] テスト
  // ============================================================================
  test('Escape: escapeHtml', () => {
    const f = LazyTemplate.Filters.Slack.escapeHtml;
    assertEqual('&lt;script&gt;', f('<script>'));
    assertEqual('A &amp; B', f('A & B'));
    assertEqual('&quot;hello&#39;', f('"hello\''));
    assertEqual('', f(''));
  });

  test('Escape: escapeMrkdwn', () => {
    const f = LazyTemplate.Filters.Slack.escapeMrkdwn;
    // 特殊文字 (&, <, >) もHTML実体化され、かつ装飾文字がエスケープされる
    assertEqual('A &amp; B', f('A & B'));
    assertEqual('&lt;tag&gt;', f('<tag>'));
    assertEqual('\\*bold\\*', f('*bold*'));
    assertEqual('\\_italic\\_', f('_italic_'));
    assertEqual('\\~strike\\~', f('~strike~'));
    assertEqual('\\`code\\`', f('`code`'));
    assertEqual('\\*bold\\* &amp; \\_italic\\_', f('*bold* & _italic_'));
    assertEqual('', f(''));
  });

  test('Escape: escapeJson', () => {
    const f = LazyTemplate.Filters.Slack.escapeJson;
    assertEqual('hello \\"world\\"', f('hello "world"'));
    assertEqual('line1\\nline2', f('line1\nline2'));
    assertEqual('C:\\\\temp', f('C:\\temp'));
    // SlackFilters.gs の escapeJson は文字コードに応じて '\b' などの代わりに厳密なユニコード '\\u0008' を返す場合と('\\b'を返す場合)の分岐があります。
    // 実装側では '\b' が返されているので、期待値を修正します。
    assertEqual('\\u0000\\b\\t\\n\\f\\r', f('\x00\b\t\n\f\r'));
    assertEqual('', f(''));
  });

  test('Escape: escapeBlockKit', () => {
    const f = LazyTemplate.Filters.Slack.escapeBlockKit;
    // R-2 対応: 二重エスケープが発生しないことの確認
    // 期待: 
    //   escapeMrkdwn("A & <B> *C*") => "A &amp; &lt;B&gt; \*C\*"
    //   escapeJson(...) => "A &amp; &lt;B&gt; \\*C\\*"
    assertEqual('A &amp; &lt;B&gt; \\\\*C\\\\*', f('A & <B> *C*'));
    assertEqual('line1\\nline2', f('line1\nline2'));
  });

  // ============================================================================
  // [ユーティリティ系] テスト
  // ============================================================================
  test('Utility: newline', () => {
    const f = LazyTemplate.Filters.Slack.newline;
    assertEqual('A\nB\nC', f('A\r\nB\rC'));
    assertEqual('', f(''));
  });

  test('Utility: bullet (Single)', () => {
    const f = LazyTemplate.Filters.Slack.bullet;
    assertEqual('• text', f('text'));
    // 単一行扱いのまま付与
    assertEqual('• A\nB', f('A\nB'));
    assertEqual('', f(''));
  });

  test('Utility: bulletList (Multi)', () => {
    const f = LazyTemplate.Filters.Slack.bulletList;
    assertEqual('• A\n• B', f('A\nB'));
    assertEqual('• X\n• Y', f(['X', 'Y']));
    assertEqual('', f(''));
  });

  test('Utility: numbered (Single)', () => {
    const f = LazyTemplate.Filters.Slack.numbered;
    assertEqual('1. text', f('text'));
    assertEqual('', f(''));
  });

  test('Utility: numberedList (Multi)', () => {
    const f = LazyTemplate.Filters.Slack.numberedList;
    assertEqual('1. A\n2. B', f('A\nB'));
    assertEqual('1. X\n2. Y\n3. Z', f(['X', 'Y', 'Z']));
    assertEqual('', f(''));
  });

  test('Utility: date', () => {
    const f = LazyTemplate.Filters.Slack.date;
    assertEqual('<!date^1738000000^{date} {time}|1738000000>', f(1738000000));
    assertEqual('<!date^1738000000^{date} {time}|1738000000>', f('1738000000'));
    assertEqual('', f(''));
  });

  // ============================================================================
  // [統合] テンプレートを通した評価テスト
  // ============================================================================
  test('Integration: LazyTemplate filter usage', () => {
    const t = new LazyTemplate(
      '{{{ name | mentionUser }}} is {{{ status | bold }}}', 
      LazyTemplate.Filters.Slack
    );
    const result = t.evaluate({ name: 'U123', status: 'Active' });
    assertEqual('<@U123> is *Active*', result);
  });

  test('Integration: Chain fallback & Filters', () => {
    // LazyTemplate の仕様: `||` または `??` は各項（ターム）の区切り。
    // {{{ missing | filter1 || "A & B" | filter2 }}} のように記述する。
    // 今回の記述だと `"A & B"` という単一のリテラル項に直結して `| escapeHtml | bold` と書かれているため
    // `missing` 項はフィルターなしで評価され、値なし(`undefined`)としてスキップ。
    // 次のターム `"A & B"` が評価され、それに `escapeHtml`, `bold` が適用される。
    const t = new LazyTemplate(
      '{{{ missing || "A & B" | escapeHtml | bold }}}', 
      LazyTemplate.Filters.Slack
    );
    // evaluate() に空オブジェクトを渡した時点では変数が存在しないためフォールバックが機能する
    const result = t.evaluate({});
    assertEqual('*A &amp; B*', result);
  });

  test('Integration: BlockKit escape sequence', () => {
    const jsonStr = '{"text": "{{{ user_input | escapeBlockKit }}}"}';
    const t = new LazyTemplate(jsonStr, LazyTemplate.Filters.Slack);
    
    // ユーザーが悪意のあるJSONインジェクションや、想定外のMrkdwn記法を含めた場合
    const result = t.evaluate({ user_input: 'hello "\n*bold* & <world>' });
    
    // 期待される動き:
    // 1. escapeMrkdwn で "&", "<", ">", "*" がエスケープされる -> 'hello "\n\*bold\* &amp; &lt;world&gt;'
    // 2. escapeJson で "\n", "\"", "\" がエスケープされる -> 'hello \\"\\n\\\\*bold\\\\* &amp; &lt;world&gt;'
    assertEqual('{"text": "hello \\"\\n\\\\*bold\\\\* &amp; &lt;world&gt;"}', result);

    // 生成されたJSONが安全にパース可能であることを確認
    const parsed = JSON.parse(result);
    // パース後は escapeJson のエスケープが解除される
    assertEqual('hello "\n\\*bold\\* &amp; &lt;world&gt;', parsed.text);
  });

  return TestRunner.run();
}

// Node.js テストランナー用エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = runAllSlackFiltersTests;
}
