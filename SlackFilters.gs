'use strict';

/**
 * SlackFilters
 * 
 * @description Slack Mrkdwn・Block Kit対応の拡張フィルターセット（LazyTemplate用）
 * @version 1.0.0
 * @author Arihiro OKAZAKI
 * @created 2026-02-01
 * 
 * 設計思想:
 *   - すべてのフィルターは LazyTemplate.PRIMITIVE_FILTERS と同じシグネチャ (v => ...) を遵守
 *   - Mrkdwn装飾フィルターは文字列テンプレートで使用する前提で設計
 *   - エスケープフィルターは escapeXXX の命名規則を統一
 *   - Block Kit JSONテンプレートにも安全に使える（JSON文字列中のエスケープも考慮）
 *   - 副効果なし・純関数のみ
 * 
 * 対応カテゴリ:
 *   [Mrkdwn装飾]     bold, italic, strike, code, pre
 *   [エスケープ]      escapeMrkdwn, escapeHtml, escapeJson
 *   [参照リンク]      slackUser, slackChannel, slackSpecial, slackLink, slackMail
 *   [日時]           slackDate, slackDateFmt
 *   [ユーティリティ]  slackTruncate, slackNewline, slackBullet, slackNumbered
 * 
 * 使用例:
 *   // 文字列テンプレート
 *   const t = new LazyTemplate('{{{name | bold}}} さん', SlackFilters);
 *   t.evaluate({ name: 'Alice' });  // => "*Alice* さん"
 * 
 *   // Block Kit JSONテンプレート（escapeJson を末尾に適用）
 *   const t = new LazyTemplate('{"text": "{{{msg | escapeMrkdwn | escapeJson}}}"}', SlackFilters);
 *   t.evaluate({ msg: 'hello *world*' });  // => '{"text": "hello \\*world\\*"}'
 */
const SlackFilters = (function () {

  // ========================================
  // [内部] 共通ユーティリティ
  // ========================================

  /**
   * 値を文字列に正規化（null/undefinedは空文字）
   * 
   * @param {*} v 値
   * @returns {string} 文字列化された値
   */
  const toString = v => v == null ? '' : String(v);

  // ========================================
  // [Mrkdwn装飾] フィルター
  // ========================================
  // Slack Mrkdwn の装飾記法をラップする。
  // 入力が空文字の場合は装飾しない（空の **** を生成しないように）。

  /**
   * [Mrkdwn装飾] 太字
   * Mrkdwn: *text*
   * 
   * @param {*} v 値
   * @returns {string} 太字装飾された文字列、または空文字の場合はそのまま
   */
  const bold = v => {
    const s = toString(v);
    return s === '' ? '' : `*${s}*`;
  };

  /**
   * [Mrkdwn装飾] イタリック
   * Mrkdwn: _text_
   * 
   * @param {*} v 値
   * @returns {string} イタリック装飾された文字列、または空文字の場合はそのまま
   */
  const italic = v => {
    const s = toString(v);
    return s === '' ? '' : `_${s}_`;
  };

  /**
   * [Mrkdwn装飾] 取り消し線
   * Mrkdwn: ~text~
   * 
   * @param {*} v 値
   * @returns {string} 取り消し線装飾された文字列、または空文字の場合はそのまま
   */
  const strike = v => {
    const s = toString(v);
    return s === '' ? '' : `~${s}~`;
  };

  /**
   * [Mrkdwn装飾] インラインコード
   * Mrkdwn: `text`
   * 
   * @param {*} v 値
   * @returns {string} インラインコード装飾された文字列、または空文字の場合はそのまま
   */
  const code = v => {
    const s = toString(v);
    return s === '' ? '' : '`' + s + '`';
  };

  /**
   * [Mrkdwn装飾] コードブロック
   * Mrkdwn: ```text```
   * 言語指定には対応しない（Slack Mrkdwnでは標準記法ではないため）。
   * 
   * @param {*} v 値
   * @returns {string} コードブロック装飾された文字列、または空文字の場合はそのまま
   */
  const pre = v => {
    const s = toString(v);
    return s === '' ? '' : '```' + s + '```';
  };

  // ========================================
  // [エスケープ] フィルター
  // ========================================
  // 命名規則: escapeXXX
  // Mrkdwn装飾・HTML・JSONの各コンテキストに対応。
  // Block Kit JSONテンプレートで使う際は escapeJson を末尾に適用する。

  /**
   * [エスケープ] Slack Mrkdwnの特殊文字をエスケープ
   * 
   * エスケープ対象の文字:
   *   & → &amp;    < → &lt;    > → &gt;
   *   * → \*       _ → \_      ~ → \~
   *   ` → \`
   * 
   * @param {*} v 値
   * @returns {string} エスケープされた文字列
   */
  const escapeMrkdwn = v => {
    const s = toString(v);
    // & は最初にエスケープ（他のエスケープと衝突しないように）
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`');
  };

  /**
   * [エスケープ] HTML特殊文字をエスケープ
   * Block Kit の text オブジェクトでも & < > はエスケープが必要。
   * 
   * エスケープ対象の文字:
   *   & → &amp;    < → &lt;    > → &gt;    " → &quot;    ' → &#39;
   * 
   * @param {*} v 値
   * @returns {string} エスケープされた文字列
   */
  const escapeHtml = v => {
    const s = toString(v);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /**
   * [エスケープ] JSON文字列中の特殊文字をエスケープ
   * Block Kit JSONテンプレートの "..." の中に値を埋め込む際に使用。
   * 
   * エスケープ対象の文字:
   *   \ → \\    " → \"
   *   \n → \\n    \r → \\r    \t → \\t
   *   U+0000〜U+001F の残り制御文字 → \\uXXXX
   * 
   * @param {*} v 値
   * @returns {string} JSON文字列中に安全に埋め込める文字列
   */
  const escapeJson = v => {
    const s = toString(v);
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      // 残り制御文字 U+0000〜U+001F を \uXXXX で吸収
      .replace(/[\u0000-\u001f]/g, c =>
        '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
      );
  };

  // ========================================
  // [参照リンク] フィルター
  // ========================================
  // Slack の <@U...>・<#C...>・<mailto:...> 記法に変換する。
  // これらは Mrkdwn の装飾記法とは異なる「特殊リンク記法」であり、
  // Block Kit の mrkdwn: true テキスト中でも有効に動作する。

  /**
   * [参照リンク] ユーザーID → <@U...> 参照
   * 
   * @param {*} v ユーザーID（例: "U1234ABCD"）
   * @returns {string} Slack ユーザー参照文字列
   */
  const slackUser = v => {
    const s = toString(v);
    return s === '' ? '' : `<@${s}>`;
  };

  /**
   * [参照リンク] チャネルID → <#C...> 参照
   * 
   * @param {*} v チャネルID（例: "C1234ABCD"）
   * @returns {string} Slack チャネル参照文字列
   */
  const slackChannel = v => {
    const s = toString(v);
    return s === '' ? '' : `<#${s}>`;
  };

  /**
   * [参照リンク] 特殊キーワード → Slack 特殊リンク
   * 
   * サポートするキーワード:
   *   "here"    → <!here>
   *   "channel" → <!channel>
   *   "everyone"→ <!everyone>
   * 
   * 上記以外の値はそのまま <!value> としてラップされる。
   * 
   * @param {*} v キーワード文字列
   * @returns {string} Slack 特殊リンク文字列
   */
  const slackSpecial = v => {
    const s = toString(v);
    return s === '' ? '' : `<!${s}>`;
  };

  /**
   * [参照リンク] URL → Slack リンク
   * 
   * ラベル無し: <url>
   * ラベル付き: <url|label>
   * 
   * ただし、このフィルターは値そのものをURLとして <...> でラップするだけ。
   * ラベル付きの場合は "url|label" の形で渡すこと。
   * 
   * @param {*} v URL文字列（または "url|label" 形式）
   * @returns {string} Slack リンク文字列
   */
  const slackLink = v => {
    const s = toString(v);
    return s === '' ? '' : `<${s}>`;
  };

  /**
   * [参照リンク] メールアドレス → <mailto:...> リンク
   * 
   * ラベル無し: <mailto:addr>
   * ラベル付き: <mailto:addr|label>
   * 
   * 値に "|" が含まれる場合、その左側をアドレス、右側をラベルとして扱う。
   * 
   * @param {*} v メールアドレス文字列（または "addr|label" 形式）
   * @returns {string} Slack メールリンク文字列
   */
  const slackMail = v => {
    const s = toString(v);
    if (s === '') {
      return '';
    }
    const pipeIdx = s.indexOf('|');
    if (pipeIdx === -1) {
      return `<mailto:${s}>`;
    }
    const addr  = s.slice(0, pipeIdx);
    const label = s.slice(pipeIdx + 1);
    return `<mailto:${addr}|${label}>`;
  };

  // ========================================
  // [日時] フィルター
  // ========================================
  // Slack の <! date> 記法を生成する。
  // この記法は受信側のタイムゾーンで自動変換される。
  //
  // 入力値の期待:
  //   - Number: Unix タイムスタンプ（秒単位）をそのまま使用
  //   - その他: Number() で変換を試みる
  //
  // Slack date トークン（一部）:
  //   {date_short}       → 2026/01/28
  //   {date}             → January 28th, 2026
  //   {date_long}        → January 28th, 2026
  //   {time}             → 14:30
  //   {time_secs}        → 14:30:00
  //   {date_short_time} → 2026/01/28 14:30
  //
  // フォールバック文字列はSlack APIが日時を解釈できない場合に表示される。

  /**
   * [日時] Unix タイムスタンプ → Slack 日時リンク（デフォルトフォーマット）
   * フォーマット: {date_short_time}
   * 
   * @param {*} v Unix タイムスタンプ（秒単位）
   * @returns {string} Slack 日時リンク文字列、または変換失敗時は元の文字列
   */
  const slackDate = v => {
    if (v == null) return '';
    const n = Number(v);
    if (!Number.isFinite(n)) {
      return toString(v);
    }
    return `<!date^${Math.floor(n)}^{date_short_time}|${toString(v)}>`;
  };

  /**
   * [日時] Unix タイムスタンプ → Slack 日時リンク（フォーマット指定版）
   * 
   * 入力値の形式: "timestamp|format"
   *   timestamp : Unix タイムスタンプ（秒単位）
   *   format    : Slack date トークン文字列（例: "{date_short} {time}"）
   * 
   * "|" が含まれない場合は slackDate と同じデフォルトフォーマットにフォールバックする。
   * 
   * 利用例:
   *   {{{ts | slackDateFmt}}}
   *   データ: { ts: "1738000000|{date_long} {time_secs}" }
   *   → <!date^1738000000^{date_long} {time_secs}|1738000000>
   * 
   * @param {*} v "timestamp|format" 文字列
   * @returns {string} Slack 日時リンク文字列、または変換失敗時は元の文字列
   */
  const slackDateFmt = v => {
    if (v == null) return '';
    const s = toString(v);
    const pipeIdx = s.indexOf('|');

    // "|" なし → slackDate と同一動作
    if (pipeIdx === -1) {
      return slackDate(v);
    }

    const rawTs = s.slice(0, pipeIdx);
    const fmt   = s.slice(pipeIdx + 1);
    const n     = Number(rawTs);

    if (!Number.isFinite(n)) {
      return s;
    }
    return `<!date^${Math.floor(n)}^${fmt}|${rawTs}>`;
  };

  // ========================================
  // [ユーティリティ] フィルター
  // ========================================

  /**
   * [ユーティリティ] 文字列を指定長以内に切り詰め（末尾に省略記号を付与）
   * 
   * 省略記号は "…"（U+2026、単一文字）を使用。
   * 指定長以内であればそのまま返す。
   * 
   * ※ 引数を受け取れないため、省略記数は固定値（40文字）としている。
   *   それ以外の長さが必要な場合は registerFilter で別途カスタム実装を登録してください。
   * 
   * @param {*} v 値
   * @returns {string} 40文字以内に切り詰めた文字列
   */
  const slackTruncate = v => {
    const s = toString(v);
    const max = 40;
    return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
  };

  /**
   * [ユーティリティ] 改行を Slack の改行(\n)に正規化
   * \r\n や \r を \n に統一する。
   * 
   * @param {*} v 値
   * @returns {string} 改行が \n に統一された文字列
   */
  const slackNewline = v => {
    const s = toString(v);
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  };

  /**
   * [ユーティリティ] Slack Mrkdwn のバレットリスト項目に変換
   * 先頭に "• " を付加する。
   * 
   * @param {*} v 値
   * @returns {string} バレットリスト項目の文字列、または空文字の場合はそのまま
   */
  const slackBullet = v => {
    const s = toString(v);
    return s === '' ? '' : `\u2022 ${s}`;
  };

  /**
   * [ユーティリティ] Slack Mrkdwn の番号付きリスト項目に変換
   * 
   * 入力値の形式: "n|text"
   *   n    : 番号（任意の数値または文字列）
   *   text : リスト項目の本文
   * 
   * "|" が含まれない場合は番号として "1" を固定で付与する。
   * 
   * 利用例:
   *   {{{item | slackNumbered}}}
   *   データ: { item: "3|三番目のタスク" }
   *   → "3. 三番目のタスク"
   * 
   * @param {*} v "n|text" 文字列
   * @returns {string} 番号付きリスト項目の文字列、または空文字の場合はそのまま
   */
  const slackNumbered = v => {
    const s = toString(v);
    if (s === '') {
      return '';
    }
    const pipeIdx = s.indexOf('|');
    if (pipeIdx === -1) {
      return `1. ${s}`;
    }
    const num  = s.slice(0, pipeIdx);
    const text = s.slice(pipeIdx + 1);
    return `${num}. ${text}`;
  };

  // ========================================
  // エクスポート
  // ========================================
  // LazyTemplate のコンストラクタの第2引数（filters オブジェクト）として渡す。
  //
  // 使い方:
  //   const t = new LazyTemplate(templateStr, SlackFilters);

  return {
    // Mrkdwn装飾
    bold,
    italic,
    strike,
    code,
    pre,

    // エスケープ
    escapeMrkdwn,
    escapeHtml,
    escapeJson,

    // 参照リンク
    slackUser,
    slackChannel,
    slackSpecial,
    slackLink,
    slackMail,

    // 日時
    slackDate,
    slackDateFmt,

    // ユーティリティ
    slackTruncate,
    slackNewline,
    slackBullet,
    slackNumbered
  };
})();
