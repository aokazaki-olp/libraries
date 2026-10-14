/**
 * plugins/slack.ts
 *
 * @description Slack Web API 用プラグインセット
 *
 * 使用例:
 *   const slack = SlackApiClient.create(token)
 *     .use(SlackPlugins.chat());
 *   await slack.postMessage('C123456', 'Hello!');
 *   await slack.postBlocks('C123456', [{ type: 'section', text: { type: 'mrkdwn', text: '*Bold*' } }]);
 */

import type { Plugin } from '../ApiClient.ts';
import type { CallOptions } from '../httpTypes.ts';

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

/** chat() が追加するメソッド。戻り値は Slack Web API の応答（ts 等）を検証せずに返す */
export interface SlackChatMethods {
  /**
   * テキストメッセージを送信する
   * @param channel - 送信先チャンネル ID
   * @param text - メッセージテキスト
   * @param options - 追加オプション（blocks, thread_ts 等）
   * @param callOptions - 中断シグナル等
   * @returns Slack の応答（ok / channel / ts / message）
   * @throws {SlackApiError} Slack が ok:false を返した場合
   */
  postMessage(
    channel: string,
    text: string,
    options?: ChatOptions,
    callOptions?: CallOptions,
  ): Promise<unknown>;
  /**
   * Block Kit メッセージを送信する
   * @param channel - 送信先チャンネル ID
   * @param blocks - Block Kit ブロック配列
   * @param options - 追加オプション（text, thread_ts 等）
   * @param callOptions - 中断シグナル等
   * @returns Slack の応答（ok / channel / ts / message）
   * @throws {SlackApiError} Slack が ok:false を返した場合
   */
  postBlocks(
    channel: string,
    blocks: SlackBlock[],
    options?: ChatOptions,
    callOptions?: CallOptions,
  ): Promise<unknown>;
  /**
   * 既存メッセージを更新する
   * @param channel - チャンネル ID
   * @param ts - 更新対象メッセージのタイムスタンプ
   * @param text - 新しいテキスト
   * @param options - 追加オプション
   * @param callOptions - 中断シグナル等
   * @returns Slack の応答
   * @throws {SlackApiError} Slack が ok:false を返した場合
   */
  update(
    channel: string,
    ts: string,
    text: string,
    options?: ChatOptions,
    callOptions?: CallOptions,
  ): Promise<unknown>;
  /**
   * メッセージを削除する
   * @param channel - チャンネル ID
   * @param ts - 削除対象メッセージのタイムスタンプ
   * @param callOptions - 中断シグナル等
   * @returns Slack の応答
   * @throws {SlackApiError} Slack が ok:false を返した場合
   */
  delete(channel: string, ts: string, callOptions?: CallOptions): Promise<unknown>;
}

/** reactions() が追加するメソッド。戻り値は Slack Web API の応答を検証せずに返す */
export interface SlackReactionMethods {
  /**
   * リアクションを追加する
   * @param channel - チャンネル ID
   * @param timestamp - 対象メッセージのタイムスタンプ
   * @param name - 絵文字名（コロンなし）
   * @param callOptions - 中断シグナル等
   * @returns Slack の応答
   * @throws {SlackApiError} Slack が ok:false を返した場合
   */
  addReaction(
    channel: string,
    timestamp: string,
    name: string,
    callOptions?: CallOptions,
  ): Promise<unknown>;
  /**
   * リアクションを削除する
   * @param channel - チャンネル ID
   * @param timestamp - 対象メッセージのタイムスタンプ
   * @param name - 絵文字名（コロンなし）
   * @param callOptions - 中断シグナル等
   * @returns Slack の応答
   * @throws {SlackApiError} Slack が ok:false を返した場合
   */
  removeReaction(
    channel: string,
    timestamp: string,
    name: string,
    callOptions?: CallOptions,
  ): Promise<unknown>;
}

// ============================================================================
// chat プラグイン
// ============================================================================

/**
 * Slack チャットメッセージ操作プラグイン（chat.* API）
 *
 * @returns postMessage / postBlocks / update / delete を追加するプラグイン
 * @example
 *   const slack = SlackApiClient.create(token).use(SlackPlugins.chat());
 *   await slack.postMessage('C123456', 'Hello!');
 */
const chat = (): Plugin<unknown, SlackChatMethods> => (client) => ({
  postMessage: (channel, text, options = {}, callOptions) =>
    client.post(
      '/chat.postMessage',
      { channel, text, ...options },
      { signal: callOptions?.signal },
    ),

  postBlocks: (channel, blocks, options = {}, callOptions) =>
    client.post(
      '/chat.postMessage',
      { channel, blocks, ...options },
      { signal: callOptions?.signal },
    ),

  update: (channel, ts, text, options = {}, callOptions) =>
    client.post('/chat.update', { channel, ts, text, ...options }, { signal: callOptions?.signal }),

  delete: (channel, ts, callOptions) =>
    client.post('/chat.delete', { channel, ts }, { signal: callOptions?.signal }),
});

// ============================================================================
// reactions プラグイン
// ============================================================================

/**
 * Slack リアクション操作プラグイン（reactions.* API）
 *
 * @returns addReaction / removeReaction を追加するプラグイン
 * @example
 *   const slack = SlackApiClient.create(token).use(SlackPlugins.reactions());
 *   await slack.addReaction('C123456', '1234567890.123456', 'thumbsup');
 */
const reactions = (): Plugin<unknown, SlackReactionMethods> => (client) => ({
  addReaction: (channel, timestamp, name, callOptions) =>
    client.post('/reactions.add', { channel, timestamp, name }, { signal: callOptions?.signal }),

  removeReaction: (channel, timestamp, name, callOptions) =>
    client.post('/reactions.remove', { channel, timestamp, name }, { signal: callOptions?.signal }),
});

// ============================================================================
// エクスポート
// ============================================================================

export const SlackPlugins = {
  chat,
  reactions,
} as const;
