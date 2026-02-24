'use strict';

/**
 * SlackFilters.gs
 *
 * @description LazyTemplate(遅延評価テンプレートエンジン)用 Slack装飾フィルター群。
 */

// ファイル読み込み順序に依存しない安全な拡張手法
if (typeof LazyTemplate === 'undefined') {
  throw new Error('[SlackFilters] LazyTemplate is not defined. Ensure LazyTemplate.gs is loaded before SlackFilters.gs.');
}

LazyTemplate.Filters = LazyTemplate.Filters || {};

LazyTemplate.Filters.Slack = (() => {

  // ========================================
  // ユーティリティ
  // ========================================
  const toString = v => v == null ? '' : String(v);

  const processList = (v, formatFn) => {
    if (v == null || v === '') {
      return '';
    }
    const lines = Array.isArray(v) ? v : toString(v).split(/\r?\n/);
    return lines.map(formatFn).join('\n');
  };

  // ========================================
  // 装飾系（Mrkdwn）
  // ========================================

  /**
   * [Mrkdwn装飾] 太字化
   * 
   * @param {*} v 値
   * @returns {string} 太字化された文字列、または空文字
   */
  const bold = v => {
    const s = toString(v);
    return s === '' ? '' : `*${s}*`;
  };

  /**
   * [Mrkdwn装飾] 斜体化
   * 
   * @param {*} v 値
   * @returns {string} 斜体化された文字列、または空文字
   */
  const italic = v => {
    const s = toString(v);
    return s === '' ? '' : `_${s}_`;
  };

  /**
   * [Mrkdwn装飾] 取り消し線
   * 
   * @param {*} v 値
   * @returns {string} 取り消し線が付与された文字列、または空文字
   */
  const strike = v => {
    const s = toString(v);
    return s === '' ? '' : `~${s}~`;
  };

  /**
   * [Mrkdwn装飾] インラインコード化
   * 
   * @param {*} v 値
   * @returns {string} インラインコード化された文字列、または空文字
   */
  const code = v => {
    const s = toString(v);
    return s === '' ? '' : `\`${s}\``;
  };

  /**
   * [Mrkdwn装飾] コードブロック化
   * 
   * @param {*} v 値
   * @returns {string} コードブロック化された文字列、または空文字
   */
  const codeBlock = v => {
    const s = toString(v);
    return s === '' ? '' : `\`\`\`\n${s}\n\`\`\``;
  };

  /**
   * [Mrkdwn装飾] 引用化(各行に > を付与)
   * 
   * @param {*} v 値
   * @returns {string} 引用化された文字列、または空文字
   */
  const quote = v => {
    const s = toString(v);
    if (s === '') {
      return '';
    }
    return s.split(/\r?\n/).map(line => `> ${line}`).join('\n');
  };

  // ========================================
  // メンション（参照）系
  // ※ここでは纯粋にIDをラップするのみ。名前解決は行わない
  // ========================================

  /**
   * [メンション] ユーザーIDをメンション記法でラップ
   * 
   * @param {*} v ユーザーID
   * @returns {string} メンション文字列、または空文字
   */
  const mentionUser = v => {
    const s = toString(v);
    return s === '' ? '' : `<@${s}>`;
  };

  /**
   * [メンション] チャンネルIDを参照記法でラップ
   * 
   * @param {*} v チャンネルID
   * @returns {string} チャンネル参照文字列、または空文字
   */
  const mentionChannel = v => {
    const s = toString(v);
    return s === '' ? '' : `<#${s}>`;
  };

  /**
   * [メンション] 特別なメンション（here, everyone など）をラップ
   * 
   * @param {*} v 特別なメンション文字列
   * @returns {string} 特別なメンション文字列、または空文字
   */
  const mentionSpecial = v => {
    const s = toString(v);
    return s === '' ? '' : `<!${s}>`;
  };

  /**
   * [メンション] リンク化
   * 
   * @param {*} v URL
   * @returns {string} リンク文字列、または空文字
   */
  const link = v => {
    const s = toString(v);
    return s === '' ? '' : `<${s}>`;
  };

  /**
   * [メンション] メールリンク化
   * 
   * @param {*} v メールアドレス
   * @returns {string} メールリンク文字列、または空文字
   */
  const mail = v => {
    const s = toString(v);
    return s === '' ? '' : `<mailto:${s}>`;
  };

  // ========================================
  // エスケープ系
  // ========================================
  
  /**
   * [エスケープ] HTML実体参照へのエスケープ
   * 
   * @param {*} v 値
   * @returns {string} HTMLエスケープされた文字列
   */
  const escapeHtml = v => {
    const s = toString(v);
    if (s === '') {
      return '';
    }
    return s.replace(/[&<>"']/g, match => {
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
          return match; // 該当なし（正規表現で制限されている）
      }
    });
  };

  /**
   * [エスケープ] Slack Mrkdwn文脈でのエスケープ
   * （API送信時に意図せず太字や斜体、メンションとして解釈されるのを防ぐ）
   * 
   * @param {*} v 値
   * @returns {string} Mrkdwn用にエスケープされた文字列
   */
  const escapeMrkdwn = v => {
    const s = toString(v);
    if (s === '') {
      return '';
    }
    // Slack固有の特殊文字(&, <, >)をエスケープした上で、装飾記号(*, _, ~, `)をエスケープする
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/([*_~`])/g, '\\$1');
  };

  /**
   * [エスケープ] JSON文字列への埋め込み用エスケープ
   * 
   * @param {*} v 値
   * @returns {string} JSON値として展開可能なエスケープ文字列文字列
   */
  const escapeJson = v => {
    const s = toString(v);
    if (s === '') {
      return '';
    }
    // JSONとして安全な形にエスケープ (\ と " をエスケープし、制御文字等をUnicodeエスケープ)
    return s.replace(/[\u0000-\u001f"\\]/g, match => {
      const c = match.charCodeAt(0);
      switch (c) {
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
          return '\\u' + ('0000' + c.toString(16)).slice(-4);
      }
    });
  };

  /**
   * [エスケープ] Block Kit 送信用の統合エスケープ
   * escapeMrkdwn -> escapeJson を直列実行する。
   * (escapeMrkdwn 内で HTML実体(& < >) のエスケープが済んでいるため、
   * escapeHtml を挟むと二重エスケープが発生するのを防ぐ設計。)
   * 
   * @param {*} v 値
   * @returns {string} Block Kitテンプレート向けに安全に二重エスケープされた文字列
   */
  const escapeBlockKit = v => {
    return escapeJson(escapeMrkdwn(v));
  };


  // ========================================
  // リスト・ユーティリティ系
  // ========================================

  /**
   * [ユーティリティ] 改行コードの正規化(CRLF/CR -> LF)
   * 
   * @param {*} v 値
   * @returns {string} 正規化された文字列
   */
  const newline = v => {
    const s = toString(v);
    return s === '' ? '' : s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  };

  /**
   * [ユーティリティ] 単一行の先頭に `• ` を付与する
   * 
   * @param {*} v 値
   * @returns {string} バレット付与文字列
   */
  const bullet = v => {
    const s = toString(v);
    return s === '' ? '' : `• ${s}`;
  };

  /**
   * [ユーティリティ] 各行の先頭に `• ` を付与して再結合する（Multi対応）
   * 
   * @param {*} v 値または配列
   * @returns {string} 各行にバレット付与された文字列
   */
  const bulletList = v => processList(v, line => `• ${line}`);

  /**
   * [ユーティリティ] 単一行の先頭に `1. ` を付与する
   * 
   * @param {*} v 値
   * @returns {string} 番号付与文字列
   */
  const numbered = v => {
    const s = toString(v);
    return s === '' ? '' : `1. ${s}`;
  };

  /**
   * [ユーティリティ] 各行の先頭に自動連番を付与して再結合する（Multi対応）
   * 
   * @param {*} v 値または配列
   * @returns {string} 各行に連番付与された文字列
   */
  const numberedList = v => {
    if (v == null || v === '') {
      return '';
    }
    const lines = Array.isArray(v) ? v : toString(v).split(/\r?\n/);
    return lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  };

  /**
   * [ユーティリティ] Slack仕様の Unix タイムスタンプ装飾日付
   * 
   * @param {*} v Unix Timestamp
   * @returns {string} SlackネイティブのDate文字列
   */
  const date = v => {
    const s = toString(v);
    return s === '' ? '' : `<!date^${s}^{date} {time}|${s}>`;
  };

  // ========================================
  // エクスポート（純粋関数群のプレーンオブジェクト）
  // ========================================
  return {
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
    date
  };

})();
