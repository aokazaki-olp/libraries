'use strict';

/**
 * SlackResolvers.gs
 *
 * @description Slackワークスペースの名前解決（名前からIDへの変換）を行うフィルターを生成するファクトリ。
 * 
 * 仕様詳細:
 *   - Slack API (`users.list`, `conversations.list`) から取得した情報を元に辞書を構築。
 *   - その辞書をクロージャ内に保持し、LazyTemplate で使用可能な「純粋関数（フィルター）」を生成・提供する。
 *   - `SlackFilters`（装飾用）と明確に責務を分離し、プログラマブルにチェインさせる（例: `{{{ name | toUserId | mentionUser }}}`）。
 */
const SlackResolvers = (() => {

  // ========================================
  // [内部構築] デフォルトの縮退動作（フェイルセーフ）
  // ========================================
  
  /**
   * 未解決時のフォールバック処理
   * 
   * 辞書に存在しない名前が渡された場合、入力値をそのまま返す。
   * （これにより、後続の `mentionUser` 等に渡った場合に無効なメンション構文 `<@未定義名>` が生成されるが、
   *   情報損失を防ぐための意図的なフェイルセーフ仕様とする。）
   *
   * @param {string} v オリジナル入力値
   * @returns {string} そのままの入力値
   */
  const fallback = (v) => v;

  // ========================================
  // [コアAPI] 基本ファクトリ（提供済みの辞書に基づく生成）
  // ========================================

  /**
   * 解決用辞書（Map）に基づき、フィルター関数群を生成する
   *
   * @param {Object} dictionaries
   * @param {Object} dictionaries.users ユーザー名からユーザーIDへのマッピング辞書
   * @param {Object} dictionaries.channels チャンネル名からチャンネルIDへのマッピング辞書
   * @returns {Object} LazyTemplate に注入可能なフィルター関数群
   */
  const create = (dictionaries = {}) => {
    const usersMap = dictionaries.users || {};
    const channelsMap = dictionaries.channels || {};

    return {
      /**
       * [解決] 名前からユーザーIDへ変換するフィルター
       * @param {*} v 名前（キー）
       * @returns {string} 解決されたユーザーID、または見つからない場合は入力値そのまま
       */
      toUserId: (v) => {
        const s = v == null ? '' : String(v);
        return usersMap[s] || fallback(s);
      },

      /**
       * [解決] 名前からチャンネルIDへ変換するフィルター
       * @param {*} v 名前（キー）
       * @returns {string} 解決されたチャンネルID、または見つからない場合は入力値そのまま
       */
      toChannelId: (v) => {
        const s = v == null ? '' : String(v);
        return channelsMap[s] || fallback(s);
      }
    };
  };

  // ========================================
  // [便利ラッパー] API自動取得に基づくファクトリ
  // ========================================

  /**
   * APIからユーザーリストを取得し、優先順位に基づく網羅的なユーザー辞書を構築する。
   * （ページネーションの cursor 対応により全件を取得）
   * 
   * 優先順位（安全性の高い順。優先度が高いものが最終的に辞書に残る）:
   *   1. profile.email (完全一致)
   *   2. profile.email のローカルパート（@の前）
   *   3. name (username)
   *   4. profile.display_name
   *   5. profile.real_name
   * 
   * ※注意: 同一優先度（例: 2名の表示名が完全に同じ）で衝突した場合、
   * APIレスポンスの後方に現れたユーザーで上書きされる非決定的な挙動となる。
   * 
   * @param {Object} slackClient SlackApiClientのインスタンス
   * @returns {Object} ユーザー名からユーザーIDへのマッピング辞書
   */
  const fetchAndBuildUsersMap = (slackClient) => {
    const map = {};
    let cursor = null;

    do {
      // 削除済みユーザーやBotは除外しない（過去データの復元やBotメンションも考慮）
      const params = { limit: 200 };
      if (cursor) {
        params.cursor = cursor;
      }

      const res = slackClient.call({ endpoint: 'users.list', body: params, method: 'GET' });
      const members = res.members || [];

      for (const m of members) {
        const id = m.id;
        if (!id) {
          continue;
        }

        const profile = m.profile || {};
        
        // 5. real_name (最も優先度低、他の人に上書きされやすい)
        if (profile.real_name) {
          map[profile.real_name] = id;
        }
        
        // 4. display_name
        if (profile.display_name) {
          map[profile.display_name] = id;
        }

        // 3. name (username)
        if (m.name) {
          map[m.name] = id;
        }

        // 2 & 1. email 関連
        if (profile.email) {
          const email = profile.email;
          const localPart = email.split('@')[0];
          
          if (localPart) {
            map[localPart] = id; // メールアドレスの @ より前
          }
          map[email] = id; // 完全一致（最も確実）
        }
      }

      // ページネーション更新
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);

    return map;
  };

  /**
   * APIからチャンネルリストを取得し、チャンネル辞書を構築する。
   * （ページネーションの cursor 対応により全件を取得）
   * 
   * @param {Object} slackClient SlackApiClientのインスタンス
   * @returns {Object} チャンネル名からチャンネルIDへのマッピング辞書
   */
  const fetchAndBuildChannelsMap = (slackClient) => {
    const map = {};
    let cursor = null;

    do {
      // public だけでなく private や mpim も念の為取得可能に設定する
      const params = { 
        limit: 200, 
        types: 'public_channel,private_channel' 
      };
      if (cursor) {
        params.cursor = cursor;
      }

      const res = slackClient.call({ endpoint: 'conversations.list', body: params, method: 'GET' });
      const channels = res.channels || [];

      for (const c of channels) {
        if (c.id && c.name) {
          map[c.name] = c.id;
        }
      }

      // ページネーション更新
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);

    return map;
  };

  /**
   * Web API クライアントを受け取り、内部で自動的に全ユーザー/チャンネルを取得して構築済みのフィルター群を提供する。
   * 
   * ※注意: 
   * - 内部で `users.list` および `conversations.list` を「ページネーションにより全件同期取得」するため、
   *   大規模ワークスペースではAPIコールのコストとGASのタイムアウトに注意が必要。
   * - API呼び出しで発生したエラー（権限不足やリトライ枯渇等）は、本メソッド内でキャッチせず
   *   呼び出し元にそのままスローされる仕様。
   *
   * @param {Object} slackClient SlackApiClientの有効なインスタンス
   * @returns {Object} LazyTemplate に注入可能なフィルター関数群
   * @throws {Error} APIリクエスト失敗時
   */
  const createFromApi = (slackClient) => {
    const users = fetchAndBuildUsersMap(slackClient);
    const channels = fetchAndBuildChannelsMap(slackClient);
    
    return create({ users, channels });
  };

  // ========================================
  // エクスポート
  // ========================================
  return {
    create,
    createFromApi
  };
})();
