/**
 * plugins/slack.ts
 * @description Slack Web API 用プラグインセット
 *
 * 使用例:
 *   const slack = SlackApiClient.create(token)
 *     .use(SlackPlugins.chat());
 *   await slack.postMessage('C123456', 'Hello!');
 *   await slack.postBlocks('C123456', [{ type: 'section', text: { type: 'mrkdwn', text: '*Bold*' } }]);
 */

import type { Plugin } from '../ApiClient.js';

// ============================================================================
// 共通型定義
// ============================================================================

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface ChatOptions {
  blocks?: SlackBlock[];
  attachments?: unknown[];
  thread_ts?: string;
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  [key: string]: unknown;
}

// ============================================================================
// chat プラグイン
// ============================================================================

/**
 * Slack チャットメッセージ操作プラグイン（chat.* API）
 *
 * @example
 *   const slack = SlackApiClient.create(token).use(SlackPlugins.chat());
 *   await slack.postMessage('C123456', 'Hello!');
 */
const chat = (): Plugin<unknown, {
  /**
   * テキストメッセージを送信する
   * @param channel - 送信先チャンネル ID
   * @param text - メッセージテキスト
   * @param options - 追加オプション（blocks, thread_ts 等）
   */
  postMessage(channel: string, text: string, options?: ChatOptions): Promise<void>;
  /**
   * Block Kit メッセージを送信する
   * @param channel - 送信先チャンネル ID
   * @param blocks - Block Kit ブロック配列
   * @param options - 追加オプション（text, thread_ts 等）
   */
  postBlocks(channel: string, blocks: SlackBlock[], options?: ChatOptions): Promise<void>;
  /**
   * 既存メッセージを更新する
   * @param channel - チャンネル ID
   * @param ts - 更新対象メッセージのタイムスタンプ
   * @param text - 新しいテキスト
   * @param options - 追加オプション
   */
  update(channel: string, ts: string, text: string, options?: ChatOptions): Promise<void>;
  /**
   * メッセージを削除する
   * @param channel - チャンネル ID
   * @param ts - 削除対象メッセージのタイムスタンプ
   */
  delete(channel: string, ts: string): Promise<void>;
}> => (client) => ({
  postMessage: (channel, text, options = {}) =>
    // Slack /chat.postMessage はメッセージ送信 API（Slack Web API 仕様）
    client.post('/chat.postMessage', { channel, text, ...options }) as Promise<void>,

  postBlocks: (channel, blocks, options = {}) =>
    // Slack Web API: 応答本文を使わないため Promise<void> に確定
    client.post('/chat.postMessage', { channel, blocks, ...options }) as Promise<void>,

  update: (channel, ts, text, options = {}) =>
    // Slack Web API: 応答本文を使わないため Promise<void> に確定
    client.post('/chat.update', { channel, ts, text, ...options }) as Promise<void>,

  delete: (channel, ts) =>
    // Slack Web API: 応答本文を使わないため Promise<void> に確定
    client.post('/chat.delete', { channel, ts }) as Promise<void>,
});

// ============================================================================
// reactions プラグイン
// ============================================================================

/**
 * Slack リアクション操作プラグイン（reactions.* API）
 *
 * @example
 *   const slack = SlackApiClient.create(token).use(SlackPlugins.reactions());
 *   await slack.addReaction('C123456', '1234567890.123456', 'thumbsup');
 */
const reactions = (): Plugin<unknown, {
  /**
   * リアクションを追加する
   * @param channel - チャンネル ID
   * @param timestamp - 対象メッセージのタイムスタンプ
   * @param name - 絵文字名（コロンなし）
   */
  addReaction(channel: string, timestamp: string, name: string): Promise<void>;
  /**
   * リアクションを削除する
   * @param channel - チャンネル ID
   * @param timestamp - 対象メッセージのタイムスタンプ
   * @param name - 絵文字名（コロンなし）
   */
  removeReaction(channel: string, timestamp: string, name: string): Promise<void>;
}> => (client) => ({
  addReaction: (channel, timestamp, name) =>
    // Slack Web API: 応答本文を使わないため Promise<void> に確定
    client.post('/reactions.add', { channel, timestamp, name }) as Promise<void>,

  removeReaction: (channel, timestamp, name) =>
    // Slack Web API: 応答本文を使わないため Promise<void> に確定
    client.post('/reactions.remove', { channel, timestamp, name }) as Promise<void>,
});

// ============================================================================
// エクスポート
// ============================================================================

export const SlackPlugins = {
  chat,
  reactions,
} as const;
