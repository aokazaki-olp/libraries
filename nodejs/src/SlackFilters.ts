/**
 * SlackFilters.ts
 *
 * @description LazyTemplate用 Slack装飾フィルター群（純粋関数）。
 *
 * LazyTemplate との統合例:
 *   const t = new LazyTemplate('{{{name | bold}}}', SlackFilters);
 *   t.evaluate({ name: 'World' }); // => '*World*'
 */

// ============================================================================
// ユーティリティ
// ============================================================================

// テンプレートに渡る任意の値を String() の既定規則で文字列にするのがフィルターの仕様
// eslint-disable-next-line @typescript-eslint/no-base-to-string -- オブジェクトが [object Object] になるのも仕様どおり
const toString = (v: unknown): string => (v == null ? '' : String(v));

const processList = (v: unknown, formatFn: (line: string) => string): string => {
  if (v == null || v === '') {
    return '';
  }
  const lines = Array.isArray(v) ? v.map(String) : toString(v).split(/\r?\n/);
  return lines.map(formatFn).join('\n');
};

// ============================================================================
// Mrkdwn装飾
// ============================================================================

const bold = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `*${s}*`;
};

const italic = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `_${s}_`;
};

const strike = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `~${s}~`;
};

const code = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `\`${s}\``;
};

const codeBlock = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `\`\`\`\n${s}\n\`\`\``;
};

const quote = (v: unknown): string => {
  const s = toString(v);
  if (s === '') {
    return '';
  }
  return s
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
};

// ============================================================================
// メンション・参照
// ============================================================================

const mentionUser = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `<@${s}>`;
};

const mentionChannel = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `<#${s}>`;
};

const mentionSpecial = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `<!${s}>`;
};

const link = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `<${s}>`;
};

const mail = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `<mailto:${s}>`;
};

// ============================================================================
// エスケープ
// ============================================================================

const escapeHtml = (v: unknown): string => {
  const s = toString(v);
  if (s === '') {
    return '';
  }
  return s.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return match; // 到達しない（正規表現で対象文字が限定されている）
    }
  });
};

const escapeMrkdwn = (v: unknown): string => {
  const s = toString(v);
  if (s === '') {
    return '';
  }
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_~`])/g, '\\$1');
};

const escapeJson = (v: unknown): string => {
  const s = toString(v);
  if (s === '') {
    return '';
  }
  // JSON 文字列でエスケープが必要な制御文字（U+0000〜U+001F）を対象にする
  // eslint-disable-next-line no-control-regex -- 制御文字を検出するのがこの正規表現の目的
  return s.replace(/[\u0000-\u001f"\\]/g, (match) => {
    const code = match.charCodeAt(0);
    switch (code) {
      case 0x08:
        return '\\b';
      case 0x09:
        return '\\t';
      case 0x0a:
        return '\\n';
      case 0x0c:
        return '\\f';
      case 0x0d:
        return '\\r';
      case 0x22:
        return '\\"';
      case 0x5c:
        return '\\\\';
      default:
        return '\\u' + ('0000' + code.toString(16)).slice(-4);
    }
  });
};

/** escapeHtml を含まない設計: escapeMrkdwn が先に & < > を処理するため後から escapeHtml を掛けると二重エスケープになる */
const escapeBlockKit = (v: unknown): string => escapeJson(escapeMrkdwn(v));

// ============================================================================
// リスト・ユーティリティ
// ============================================================================

const newline = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
};

const bullet = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `• ${s}`;
};

const bulletList = (v: unknown): string => processList(v, (line) => `• ${line}`);

const numbered = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `1. ${s}`;
};

const numberedList = (v: unknown): string => {
  if (v == null || v === '') {
    return '';
  }
  const lines = Array.isArray(v) ? v.map(String) : toString(v).split(/\r?\n/);
  return lines.map((line, i) => `${String(i + 1)}. ${line}`).join('\n');
};

/** Slack ネイティブ日時装飾（Unix タイムスタンプ） */
const date = (v: unknown): string => {
  const s = toString(v);
  return s === '' ? '' : `<!date^${s}^{date} {time}|${s}>`;
};

// ============================================================================
// エクスポート
// ============================================================================

export const SlackFilters = {
  bold,
  italic,
  strike,
  code,
  codeBlock,
  quote,
  mentionUser,
  mentionChannel,
  mentionSpecial,
  link,
  mail,
  escapeHtml,
  escapeMrkdwn,
  escapeJson,
  escapeBlockKit,
  newline,
  bullet,
  bulletList,
  numbered,
  numberedList,
  date,
};

export type SlackFilterMap = typeof SlackFilters;
