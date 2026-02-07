'use strict';

/**
 * SlackFilters.test.gs
 *
 * @description SlackFilters のテストスイート
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-07
 *
 * 実行方法:
 *   GAS エディタから runAllSlackFiltersTests() を実行
 */

// ============================================================================
// SlackFilters テスト
// ============================================================================

const runSlackFiltersMrkdwnTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  // ─── Mrkdwn 装飾テスト ────────────────────────────────────────────

  suite('SlackFilters.bold');

  test('通常文字列を太字にする', () => {
    assertEqual(SlackFilters.bold('hello'), '*hello*');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.bold(''), '');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.bold(null), '');
  });

  test('undefined は空文字を返す', () => {
    assertEqual(SlackFilters.bold(undefined), '');
  });

  test('数値を文字列化して太字にする', () => {
    assertEqual(SlackFilters.bold(42), '*42*');
  });

  suite('SlackFilters.italic');

  test('通常文字列をイタリックにする', () => {
    assertEqual(SlackFilters.italic('hello'), '_hello_');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.italic(''), '');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.italic(null), '');
  });

  suite('SlackFilters.strike');

  test('通常文字列に取り消し線を追加する', () => {
    assertEqual(SlackFilters.strike('hello'), '~hello~');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.strike(''), '');
  });

  suite('SlackFilters.code');

  test('通常文字列をインラインコードにする', () => {
    assertEqual(SlackFilters.code('hello'), '`hello`');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.code(''), '');
  });

  suite('SlackFilters.pre');

  test('通常文字列をコードブロックにする', () => {
    assertEqual(SlackFilters.pre('hello'), '```hello```');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.pre(''), '');
  });

  test('複数行をコードブロックにする', () => {
    assertEqual(SlackFilters.pre('line1\nline2'), '```line1\nline2```');
  });
};

const runSlackFiltersEscapeTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  // ─── エスケープテスト ─────────────────────────────────────────────

  suite('SlackFilters.escapeMrkdwn');

  test('& をエスケープする', () => {
    assertEqual(SlackFilters.escapeMrkdwn('a&b'), 'a&amp;b');
  });

  test('< > をエスケープする', () => {
    assertEqual(SlackFilters.escapeMrkdwn('<tag>'), '&lt;tag&gt;');
  });

  test('* _ ~ ` をエスケープする', () => {
    assertEqual(SlackFilters.escapeMrkdwn('*bold* _italic_ ~strike~ `code`'),
      '\\*bold\\* \\_italic\\_ \\~strike\\~ \\`code\\`');
  });

  test('すべての特殊文字を一度にエスケープする', () => {
    const result = SlackFilters.escapeMrkdwn('&<>*_~`');
    assertEqual(result, '&amp;&lt;&gt;\\*\\_\\~\\`');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.escapeMrkdwn(null), '');
  });

  test('特殊文字を含まない文字列はそのまま', () => {
    assertEqual(SlackFilters.escapeMrkdwn('hello world'), 'hello world');
  });

  suite('SlackFilters.escapeHtml');

  test('HTML 特殊文字をエスケープする', () => {
    const result = SlackFilters.escapeHtml('&<>"\'');
    assertEqual(result, '&amp;&lt;&gt;&quot;&#39;');
  });

  test('通常文字列はそのまま', () => {
    assertEqual(SlackFilters.escapeHtml('hello'), 'hello');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.escapeHtml(null), '');
  });

  suite('SlackFilters.escapeJson');

  test('バックスラッシュとダブルクォートをエスケープする', () => {
    assertEqual(SlackFilters.escapeJson('a\\b"c'), 'a\\\\b\\"c');
  });

  test('改行・タブをエスケープする', () => {
    assertEqual(SlackFilters.escapeJson('a\nb\rc\td'), 'a\\nb\\rc\\td');
  });

  test('制御文字を \\uXXXX でエスケープする', () => {
    const result = SlackFilters.escapeJson('\x00\x1f');
    assertEqual(result, '\\u0000\\u001f');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.escapeJson(null), '');
  });

  test('通常文字列はそのまま', () => {
    assertEqual(SlackFilters.escapeJson('hello world'), 'hello world');
  });
};

const runSlackFiltersReferenceTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  // ─── 参照リンクテスト ─────────────────────────────────────────────

  suite('SlackFilters.slackUser');

  test('ユーザーIDを参照形式にする', () => {
    assertEqual(SlackFilters.slackUser('U1234ABCD'), '<@U1234ABCD>');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackUser(''), '');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackUser(null), '');
  });

  suite('SlackFilters.slackChannel');

  test('チャネルIDを参照形式にする', () => {
    assertEqual(SlackFilters.slackChannel('C1234ABCD'), '<#C1234ABCD>');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackChannel(''), '');
  });

  suite('SlackFilters.slackSpecial');

  test('here を特殊リンクにする', () => {
    assertEqual(SlackFilters.slackSpecial('here'), '<!here>');
  });

  test('channel を特殊リンクにする', () => {
    assertEqual(SlackFilters.slackSpecial('channel'), '<!channel>');
  });

  test('everyone を特殊リンクにする', () => {
    assertEqual(SlackFilters.slackSpecial('everyone'), '<!everyone>');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackSpecial(''), '');
  });

  suite('SlackFilters.slackLink');

  test('URL をリンクにする', () => {
    assertEqual(SlackFilters.slackLink('https://example.com'), '<https://example.com>');
  });

  test('ラベル付き URL をリンクにする', () => {
    assertEqual(SlackFilters.slackLink('https://example.com|Example'), '<https://example.com|Example>');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackLink(''), '');
  });

  suite('SlackFilters.slackMail');

  test('メールアドレスを mailto リンクにする', () => {
    assertEqual(SlackFilters.slackMail('user@example.com'), '<mailto:user@example.com>');
  });

  test('ラベル付きメールを mailto リンクにする', () => {
    assertEqual(SlackFilters.slackMail('user@example.com|User Name'), '<mailto:user@example.com|User Name>');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackMail(''), '');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackMail(null), '');
  });
};

const runSlackFiltersDateTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  // ─── 日時テスト ───────────────────────────────────────────────────

  suite('SlackFilters.slackDate');

  test('タイムスタンプを Slack 日時リンクにする', () => {
    const result = SlackFilters.slackDate(1738000000);
    assertEqual(result, '<!date^1738000000^{date_short_time}|1738000000>');
  });

  test('文字列タイムスタンプも変換する', () => {
    const result = SlackFilters.slackDate('1738000000');
    assertEqual(result, '<!date^1738000000^{date_short_time}|1738000000>');
  });

  test('非有限値はそのまま文字列を返す', () => {
    assertEqual(SlackFilters.slackDate('not-a-number'), 'not-a-number');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackDate(null), '');
  });

  test('Infinity はそのまま文字列を返す', () => {
    assertEqual(SlackFilters.slackDate(Infinity), 'Infinity');
  });

  test('小数タイムスタンプは切り捨てられる', () => {
    const result = SlackFilters.slackDate(1738000000.999);
    assertTrue(result.includes('^1738000000^'));
  });

  suite('SlackFilters.slackDateFmt');

  test('カスタムフォーマットを適用する', () => {
    const result = SlackFilters.slackDateFmt('1738000000|{date_long} {time_secs}');
    assertEqual(result, '<!date^1738000000^{date_long} {time_secs}|1738000000>');
  });

  test('パイプなしは slackDate と同じ動作', () => {
    assertEqual(SlackFilters.slackDateFmt(1738000000), SlackFilters.slackDate(1738000000));
  });

  test('非数値タイムスタンプはそのまま文字列を返す', () => {
    assertEqual(SlackFilters.slackDateFmt('abc|{time}'), 'abc|{time}');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackDateFmt(null), '');
  });
};

const runSlackFiltersUtilityTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  // ─── ユーティリティテスト ─────────────────────────────────────────

  suite('SlackFilters.slackTruncate');

  test('40文字以内はそのまま返す', () => {
    assertEqual(SlackFilters.slackTruncate('short'), 'short');
  });

  test('ちょうど40文字はそのまま返す', () => {
    const s = 'a'.repeat(40);
    assertEqual(SlackFilters.slackTruncate(s), s);
  });

  test('41文字以上は39文字+省略記号', () => {
    const s = 'a'.repeat(41);
    const result = SlackFilters.slackTruncate(s);
    assertEqual(result.length, 40);
    assertTrue(result.endsWith('\u2026'));
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackTruncate(null), '');
  });

  suite('SlackFilters.slackNewline');

  test('\\r\\n を \\n に統一する', () => {
    assertEqual(SlackFilters.slackNewline('a\r\nb'), 'a\nb');
  });

  test('\\r を \\n に統一する', () => {
    assertEqual(SlackFilters.slackNewline('a\rb'), 'a\nb');
  });

  test('\\n はそのまま', () => {
    assertEqual(SlackFilters.slackNewline('a\nb'), 'a\nb');
  });

  test('混合改行を統一する', () => {
    assertEqual(SlackFilters.slackNewline('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackNewline(null), '');
  });

  suite('SlackFilters.slackBullet');

  test('文字列をバレットリスト項目にする', () => {
    assertEqual(SlackFilters.slackBullet('item'), '\u2022 item');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackBullet(''), '');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackBullet(null), '');
  });

  suite('SlackFilters.slackNumbered');

  test('パイプなしは 1. を付与する', () => {
    assertEqual(SlackFilters.slackNumbered('task'), '1. task');
  });

  test('パイプ付きは番号を使用する', () => {
    assertEqual(SlackFilters.slackNumbered('3|third task'), '3. third task');
  });

  test('空文字はそのまま返す', () => {
    assertEqual(SlackFilters.slackNumbered(''), '');
  });

  test('null は空文字を返す', () => {
    assertEqual(SlackFilters.slackNumbered(null), '');
  });

  test('数値も文字列化して処理する', () => {
    assertEqual(SlackFilters.slackNumbered(42), '1. 42');
  });
};

const runSlackFiltersEdgeCaseTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  // ─── エッジケーステスト ───────────────────────────────────────────

  suite('SlackFilters エッジケース');

  test('escapeMrkdwn + escapeJson チェーンが安全', () => {
    const mrkdwn = SlackFilters.escapeMrkdwn('*bold* & <tag>');
    const json = SlackFilters.escapeJson(mrkdwn);
    // バックスラッシュが正しくエスケープされること
    assertEqual(json, '\\\\*bold\\\\* &amp; &lt;tag&gt;');
  });

  test('bold に数値 0 を渡すと装飾される', () => {
    assertEqual(SlackFilters.bold(0), '*0*');
  });

  test('bold に false を渡すと装飾される', () => {
    assertEqual(SlackFilters.bold(false), '*false*');
  });

  test('slackMail のパイプが先頭にある場合', () => {
    const result = SlackFilters.slackMail('|label');
    assertEqual(result, '<mailto:|label>');
  });

  test('slackNumbered のパイプが先頭にある場合', () => {
    const result = SlackFilters.slackNumbered('|text');
    assertEqual(result, '. text');
  });

  test('slackTruncate に数値を渡す', () => {
    assertEqual(SlackFilters.slackTruncate(12345), '12345');
  });

  test('escapeJson に空文字を渡す', () => {
    assertEqual(SlackFilters.escapeJson(''), '');
  });

  test('escapeHtml に数値を渡す', () => {
    assertEqual(SlackFilters.escapeHtml(42), '42');
  });

  // ─── LazyTemplate 統合テスト ──────────────────────────────────────

  suite('SlackFilters LazyTemplate 統合');

  test('LazyTemplate から bold フィルターを使用できる', () => {
    const t = new LazyTemplate('{{{name | bold}}}', SlackFilters);
    assertEqual(t.evaluate({ name: 'Alice' }), '*Alice*');
  });

  test('LazyTemplate から複数フィルターをチェーンできる', () => {
    const t = new LazyTemplate('{{{msg | escapeMrkdwn | escapeJson}}}', SlackFilters);
    const result = t.evaluate({ msg: '*bold*' });
    assertEqual(result, '\\\\*bold\\\\*');
  });

  test('LazyTemplate でフォールバックとフィルターを組み合わせる', () => {
    const t = new LazyTemplate('{{{name || "unknown" | bold}}}', SlackFilters);
    assertEqual(t.evaluate({ name: '' }), '*unknown*');
  });
};

// ============================================================================
// メインテストランナー
// ============================================================================

function runAllSlackFiltersTests() {
  TestRunner.reset();

  console.log('Running SlackFilters Mrkdwn tests...');
  runSlackFiltersMrkdwnTests();

  console.log('Running SlackFilters Escape tests...');
  runSlackFiltersEscapeTests();

  console.log('Running SlackFilters Reference tests...');
  runSlackFiltersReferenceTests();

  console.log('Running SlackFilters Date tests...');
  runSlackFiltersDateTests();

  console.log('Running SlackFilters Utility tests...');
  runSlackFiltersUtilityTests();

  console.log('Running SlackFilters Edge Case tests...');
  runSlackFiltersEdgeCaseTests();

  return TestRunner.run();
}
