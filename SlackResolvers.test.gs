'use strict';

/**
 * SlackResolvers.test.gs
 *
 * @description SlackResolvers (Slackワークスペース名前解決ファクトリ) のテストスイート
 */

function runAllSlackResolversTests() {
  const { suite, test, assertEqual } = TestRunner;
  suite('SlackResolvers');

  // ============================================================================
  // [基本ファクトリ] 辞書提供によるフィルター生成テスト
  // ============================================================================
  test('create(): 辞書に基づいた基本名前解決とフェイルセーフ', () => {
    const dicts = {
      users: { "Alice": "U123" },
      channels: { "general": "C123" }
    };
    
    const filters = SlackResolvers.create(dicts);
    
    // 正常解決
    assertEqual('U123', filters.toUserId('Alice'));
    assertEqual('C123', filters.toChannelId('general'));

    // 未登録（フェイルセーフ動作: 入力そのまま）
    assertEqual('Bob', filters.toUserId('Bob'));
    assertEqual('random', filters.toChannelId('random'));
    
    // 異常値
    assertEqual('', filters.toUserId(null));
    assertEqual('123', filters.toUserId(123)); // String化される
  });

  // ============================================================================
  // [便利ラッパー] API取得と辞書構築系の結合モックテスト
  // ============================================================================
  test('createFromApi(): APIデータ取得とキー優先度の検証', () => {
    // ページネーションと優先度（email > local > name > display_name > real_name）を検証するためのモックデータ
    
    let callCountUsers = 0;
    let callCountChannels = 0;

    const mockSlackClient = {
      call: (options) => {
        if (options.endpoint === 'users.list') {
          callCountUsers++;
          // 1ページ目
          if (callCountUsers === 1) {
            return {
              ok: true,
              members: [
                {
                  id: "U001",
                  name: "alice_username",
                  profile: {
                    real_name: "Alice Smith (Real)",
                    display_name: "Alice",
                    email: "alice@example.com"
                  }
                },
                {
                  id: "U002",
                  name: "bob_username",
                  profile: {
                    // display_name のみ
                    display_name: "Bob"
                  }
                },
                {
                   // 同一名称衝突テスト
                   id: "U003_LATER",
                   name: "conflict_user",
                   profile: { display_name: "Alice" }
                }
              ],
              response_metadata: { next_cursor: "page2" }
            };
          }
          // 2ページ目
          else {
            return {
              ok: true,
              members: [
                {
                  id: "U004",
                  name: "charlie",
                  profile: {} // name のみ
                }
              ],
              response_metadata: {}
            };
          }
        }
        else if (options.endpoint === 'conversations.list') {
          callCountChannels++;
          return {
            ok: true,
            channels: [
              { id: "C001", name: "general" }
            ]
          };
        }
        throw new Error('Unexpected endpoint: ' + options.endpoint);
      }
    };

    // テスト実行
    const filters = SlackResolvers.createFromApi(mockSlackClient);

    // APIが正しく複数回呼ばれたか
    assertEqual(2, callCountUsers);
    assertEqual(1, callCountChannels);

    // [U001: Alice の優先度検証]
    // 優先度 1: email
    assertEqual('U001', filters.toUserId('alice@example.com'));
    // 優先度 2: local part
    assertEqual('U001', filters.toUserId('alice')); // local part による一致
    // 優先度 3: name
    assertEqual('U001', filters.toUserId('alice_username'));
    // 優先度 5: real_name
    assertEqual('U001', filters.toUserId('Alice Smith (Real)'));

    // [同一優先度の衝突（非決定性の検証）]
    // U001のdisplay_nameも "Alice", U003_LATERのdisplay_nameも "Alice"。
    // APIレスポンスの後に出てくるものが辞書を上書きするため U003_LATER になる。
    // ※JSDoc仕様にある非決定的挙動の確認
    assertEqual('U003_LATER', filters.toUserId('Alice'));

    // [U002: Bob (display_nameのみ)]
    assertEqual('U002', filters.toUserId('Bob'));

    // [U004: Charlie (2ページ目の要素)]
    assertEqual('U004', filters.toUserId('charlie'));

    // [C001: Channel]
    assertEqual('C001', filters.toChannelId('general'));
  });

  // ============================================================================
  // [結合] テンプレート評価テスト (Filters + Resolvers のチェイン)
  // ============================================================================
  test('Integration: LazyTemplate filter chain', () => {
    // 装飾用SlackFilters と 解決用SlackResolvers のマージ
    const resolvers = SlackResolvers.create({
      users: { "bob": "U567" },
      channels: { "dev": "C999" }
    });
    const combinedFilters = Object.assign({}, LazyTemplate.Filters.Slack, resolvers);

    // 解決(toUserId) して 装飾(mentionUser) される
    const tUser = new LazyTemplate('{{{ target | toUserId | mentionUser }}}', combinedFilters);
    assertEqual('<@U567>', tUser.evaluate({ target: 'bob' }));

    // 未登録ユーザーのフェイルセーフ挙動（入力そのまま出力され、結果無効なメンション記法になる）
    assertEqual('<@unknown_user>', tUser.evaluate({ target: 'unknown_user' }));

    // チャンネルと通常テキストの共存
    const tChan = new LazyTemplate('Notice: {{{ ch | toChannelId | mentionChannel }}} を見てね', combinedFilters);
    assertEqual('Notice: <#C999> を見てね', tChan.evaluate({ ch: 'dev' }));
  });

  return TestRunner.run();
}

// Node.js テストランナー用エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = runAllSlackResolversTests;
}
