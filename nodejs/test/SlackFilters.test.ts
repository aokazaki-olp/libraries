import { describe, it, expect } from 'vitest';
import { SlackFilters } from '../src/SlackFilters.js';
import { LazyTemplate } from '../src/LazyTemplate.js';

// ============================================================================
// Mrkdwn装飾
// ============================================================================

describe('SlackFilters — Mrkdwn装飾', () => {
  it.each([
    ['bold', SlackFilters.bold, 'text', '*text*'],
    ['italic', SlackFilters.italic, 'text', '_text_'],
    ['strike', SlackFilters.strike, 'text', '~text~'],
    ['code', SlackFilters.code, 'text', '`text`'],
  ] as [string, (v: unknown) => string, string, string][])(
    '%s("text") => "%s"',
    (_name, fn, input, expected) => {
      expect(fn(input)).toBe(expected);
    },
  );

  it('bold — 数値も文字列化して装飾', () => {
    expect(SlackFilters.bold(123)).toBe('*123*');
  });

  it.each([SlackFilters.bold, SlackFilters.italic, SlackFilters.strike, SlackFilters.code])(
    '空文字/null/undefined → 空文字を返す',
    fn => {
      expect(fn('')).toBe('');
      expect(fn(null)).toBe('');
      expect(fn(undefined)).toBe('');
    },
  );

  it('codeBlock — 改行付きで囲む', () => {
    expect(SlackFilters.codeBlock('const x = 1;')).toBe('```\nconst x = 1;\n```');
  });

  it('codeBlock — 空文字 → 空文字', () => {
    expect(SlackFilters.codeBlock('')).toBe('');
  });

  it('quote — 単一行', () => {
    expect(SlackFilters.quote('hello')).toBe('> hello');
  });

  it('quote — 複数行を各行に >  付与', () => {
    expect(SlackFilters.quote('line1\nline2')).toBe('> line1\n> line2');
  });

  it('quote — CRLF も改行として扱う', () => {
    expect(SlackFilters.quote('a\r\nb')).toBe('> a\n> b');
  });
});

// ============================================================================
// メンション・参照
// ============================================================================

describe('SlackFilters — メンション・参照', () => {
  it('mentionUser — <@ID>', () => {
    expect(SlackFilters.mentionUser('U12345')).toBe('<@U12345>');
  });

  it('mentionChannel — <#ID>', () => {
    expect(SlackFilters.mentionChannel('C12345')).toBe('<#C12345>');
  });

  it('mentionSpecial — <!here>', () => {
    expect(SlackFilters.mentionSpecial('here')).toBe('<!here>');
  });

  it('link — <URL>', () => {
    expect(SlackFilters.link('https://example.com')).toBe('<https://example.com>');
  });

  it('mail — <mailto:address>', () => {
    expect(SlackFilters.mail('user@example.com')).toBe('<mailto:user@example.com>');
  });

  it.each([
    SlackFilters.mentionUser,
    SlackFilters.mentionChannel,
    SlackFilters.mentionSpecial,
    SlackFilters.link,
    SlackFilters.mail,
  ])('空文字/null → 空文字', fn => {
    expect(fn('')).toBe('');
    expect(fn(null)).toBe('');
  });
});

// ============================================================================
// エスケープ
// ============================================================================

describe('SlackFilters — escapeHtml', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(SlackFilters.escapeHtml(input)).toBe(expected);
  });

  it('複合文字列をまとめてエスケープ', () => {
    expect(SlackFilters.escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('空文字 → 空文字', () => {
    expect(SlackFilters.escapeHtml('')).toBe('');
  });
});

describe('SlackFilters — escapeMrkdwn', () => {
  it.each(['*', '_', '~', '`'])('"%s" をエスケープする', ch => {
    expect(SlackFilters.escapeMrkdwn(ch)).toBe(`\\${ch}`);
  });

  it('& < > も HTML エンティティ化する', () => {
    const result = SlackFilters.escapeMrkdwn('1 & 2 < 3 > 0');
    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });

  it('複合: Mrkdwn + HTML 特殊文字', () => {
    const result = SlackFilters.escapeMrkdwn('*bold* & <script>');
    expect(result).toBe('\\*bold\\* &amp; &lt;script&gt;');
  });

  it('空文字 → 空文字', () => {
    expect(SlackFilters.escapeMrkdwn('')).toBe('');
  });
});

describe('SlackFilters — escapeJson', () => {
  it('ダブルクォートをエスケープ', () => {
    expect(SlackFilters.escapeJson('"quoted"')).toBe('\\"quoted\\"');
  });

  it('バックスラッシュをエスケープ', () => {
    expect(SlackFilters.escapeJson('back\\slash')).toBe('back\\\\slash');
  });

  it('改行文字を \\n に変換', () => {
    expect(SlackFilters.escapeJson('line1\nline2')).toBe('line1\\nline2');
  });

  it('タブを \\t に変換', () => {
    expect(SlackFilters.escapeJson('a\tb')).toBe('a\\tb');
  });
});

describe('SlackFilters — escapeBlockKit', () => {
  it('escapeMrkdwn → escapeJson の順で適用', () => {
    // *bold* → \*bold\* (escapeMrkdwn) → \\*bold\\* (escapeJson でバックスラッシュを2重化)
    const result = SlackFilters.escapeBlockKit('*bold*');
    expect(result).toBe('\\\\*bold\\\\*');
  });

  it('& は &amp; になる（Mrkdwn）、JSON上は変化なし', () => {
    expect(SlackFilters.escapeBlockKit('a & b')).toBe('a &amp; b');
  });
});

// ============================================================================
// リスト・ユーティリティ
// ============================================================================

describe('SlackFilters — newline', () => {
  it('CRLF → LF に正規化', () => {
    expect(SlackFilters.newline('a\r\nb')).toBe('a\nb');
  });

  it('CR → LF に正規化', () => {
    expect(SlackFilters.newline('a\rb')).toBe('a\nb');
  });

  it('空文字 → 空文字', () => {
    expect(SlackFilters.newline('')).toBe('');
  });
});

describe('SlackFilters — bullet / bulletList', () => {
  it('bullet — 単一行にバレット付与', () => {
    expect(SlackFilters.bullet('item')).toBe('• item');
  });

  it('bulletList — 配列の各要素にバレット付与', () => {
    expect(SlackFilters.bulletList(['a', 'b', 'c'])).toBe('• a\n• b\n• c');
  });

  it('bulletList — 複数行文字列の各行にバレット付与', () => {
    expect(SlackFilters.bulletList('a\nb\nc')).toBe('• a\n• b\n• c');
  });

  it('bulletList — null → 空文字', () => {
    expect(SlackFilters.bulletList(null)).toBe('');
  });
});

describe('SlackFilters — numbered / numberedList', () => {
  it('numbered — 単一行に "1. " 付与', () => {
    expect(SlackFilters.numbered('item')).toBe('1. item');
  });

  it('numberedList — 配列の各要素に自動連番', () => {
    expect(SlackFilters.numberedList(['a', 'b', 'c'])).toBe('1. a\n2. b\n3. c');
  });

  it('numberedList — 複数行文字列に自動連番', () => {
    expect(SlackFilters.numberedList('x\ny')).toBe('1. x\n2. y');
  });

  it('numberedList — null → 空文字', () => {
    expect(SlackFilters.numberedList(null)).toBe('');
  });
});

describe('SlackFilters — date', () => {
  it('Unix タイムスタンプを Slack ネイティブ日時記法に変換', () => {
    expect(SlackFilters.date(1700000000)).toBe(
      '<!date^1700000000^{date} {time}|1700000000>',
    );
  });

  it('空文字 → 空文字', () => {
    expect(SlackFilters.date('')).toBe('');
  });
});

// ============================================================================
// LazyTemplate との統合
// ============================================================================

describe('SlackFilters — LazyTemplate統合', () => {
  it('bold フィルターがテンプレートで使える', () => {
    const t = new LazyTemplate('{{{name | bold}}}', SlackFilters);
    expect(t.evaluate({ name: 'World' })).toBe('*World*');
  });

  it('bulletList フィルターがテンプレートで使える', () => {
    const t = new LazyTemplate('{{{items | bulletList}}}', SlackFilters);
    expect(t.evaluate({ items: ['a', 'b'] })).toBe('• a\n• b');
  });

  it('複数フィルターのチェーン（bold | code）', () => {
    const t = new LazyTemplate('{{{name | bold | code}}}', SlackFilters);
    // bold('World') = '*World*', code('*World*') = '`*World*`'
    expect(t.evaluate({ name: 'World' })).toBe('`*World*`');
  });

  it('静的 evaluate でも SlackFilters が使える', () => {
    const result = LazyTemplate.evaluate('{{{msg | italic}}}', { msg: 'hello' }, SlackFilters);
    expect(result).toBe('_hello_');
  });
});
