'use strict';

/**
 * SalesforceAuth.test.gs
 *
 * @description SalesforceAuth (JWT Bearer Flow) のテストスイート
 *
 * 実行方法:
 *   GAS エディタから runAllSalesforceAuthTests() を実行
 */

// ============================================================================
// テスト用ヘルパ
// ============================================================================

/** base64url 文字列を JSON にデコード */
const decodeBase64UrlJson = (str) => {
  // base64url -> base64 (= パディング復元)
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
};

/** ASCII 文字列をバイト列(数値配列)に変換 */
const stringToBytes = (s) => {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    bytes.push(s.charCodeAt(i));
  }
  return bytes;
};

/** バイト列を base64url 文字列に変換 (パディング除去) */
const bytesToBase64Url = (bytes) =>
  Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Utilities 互換のシグナーモック */
const createFakeSigner = (recordedCalls = []) => ({
  newBlob: (content) => ({
    getBytes: () => stringToBytes(content)
  }),
  base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_'),
  computeRsaSha256Signature: (signingInput, privateKey) => {
    recordedCalls.push({ signingInput, privateKey });
    // テスト用ダミー署名(実署名はしない)
    return stringToBytes('FAKE_SIGNATURE');
  }
});

/** 成功レスポンスを返すフェイクトランスポート */
const createFakeTransport = (responses) => {
  const calls = [];
  let i = 0;
  const list = Array.isArray(responses) ? responses : [responses];
  return {
    fetch: (url, options) => {
      calls.push({ url, options });
      const r = list[Math.min(i, list.length - 1)];
      i++;
      return {
        getResponseCode: () => r.status ?? 200,
        getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}),
        getAllHeaders: () => r.headers ?? {}
      };
    },
    getCalls: () => calls
  };
};

const TEST_TOKEN_HOST = 'https://acme.my.salesforce.com';

const validOpts = () => ({
  consumerKey: 'CONSUMER_KEY_XXX',
  username: 'user@example.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
  tokenHost: TEST_TOKEN_HOST
});

// ============================================================================
// テスト
// ============================================================================

const runSfAuthInterfaceTests = () => {
  const { suite, test, assertTrue } = TestRunner;

  suite('SalesforceAuth インターフェース');

  test('getAccessTokenByJwt が公開されている', () => {
    assertTrue(typeof SalesforceAuth.getAccessTokenByJwt === 'function');
  });
};

const runSfAuthValidationTests = () => {
  const { suite, test, assertThrows, assertEqual } = TestRunner;

  suite('SalesforceAuth.getAccessTokenByJwt バリデーション');

  test('引数なしで TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt(), 'consumerKey');
  });

  test('consumerKey が空文字で TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      consumerKey: '', username: 'u', privateKey: 'k'
    }), 'consumerKey');
  });

  test('username が空文字で TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      consumerKey: 'c', username: '', privateKey: 'k'
    }), 'username');
  });

  test('privateKey が空文字で TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      consumerKey: 'c', username: 'u', privateKey: '', tokenHost: TEST_TOKEN_HOST
    }), 'privateKey');
  });

  test('tokenHost 未指定で TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      consumerKey: 'c', username: 'u', privateKey: 'k'
    }), 'tokenHost');
  });

  test('tokenHost の trailing slash は TypeError で弾かれる', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      ...validOpts(), tokenHost: 'https://acme.my.salesforce.com/'
    }), 'trailing slash');
  });

  test('tokenHost に大文字が含まれると TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      ...validOpts(), tokenHost: 'https://Acme.My.Salesforce.com'
    }), '小文字');
  });

  test('tokenHost に Lightning URL を渡すと TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      ...validOpts(), tokenHost: 'https://acme.lightning.force.com'
    }), 'Lightning');
  });

  test('tokenHost に full endpoint を渡すと TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      ...validOpts(),
      tokenHost: 'https://acme.my.salesforce.com/services/oauth2/token'
    }), 'tokenHost');
  });

  test('tokenHost が http:// だと TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      ...validOpts(),
      tokenHost: 'http://acme.my.salesforce.com'
    }), 'tokenHost');
  });

  test('tokenHost が空文字だと TypeError', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt({
      ...validOpts(),
      tokenHost: ''
    }), 'tokenHost');
  });
};

const runSfAuthSuccessTests = () => {
  const { suite, test, assertEqual } = TestRunner;

  suite('SalesforceAuth.getAccessTokenByJwt 正常系');

  test('access_token と instance_url を返す', () => {
    const transport = createFakeTransport({
      status: 200,
      body: {
        access_token: 'AT_xxx',
        instance_url: 'https://acme.my.salesforce.com',
        token_type: 'Bearer'
      }
    });
    const signer = createFakeSigner();
    const result = SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    assertEqual(result.accessToken, 'AT_xxx');
    assertEqual(result.instanceUrl, 'https://acme.my.salesforce.com');
  });

  test('token endpoint URL は tokenHost + /services/oauth2/token', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    assertEqual(transport.getCalls()[0].url, `${TEST_TOKEN_HOST}/services/oauth2/token`);
  });

  test('Sandbox 用 My Domain URL も使える', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(
      { ...validOpts(), tokenHost: 'https://acme--sbx.sandbox.my.salesforce.com' },
      { transport, signer }
    );
    assertEqual(
      transport.getCalls()[0].url,
      'https://acme--sbx.sandbox.my.salesforce.com/services/oauth2/token'
    );
  });

  test('payload に grant_type と assertion が含まれる', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const payload = transport.getCalls()[0].options.payload;
    assertEqual(payload.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    if (typeof payload.assertion !== 'string' || payload.assertion === '') {
      throw new Error('assertion が空');
    }
  });
};

const runSfAuthJwtStructureTests = () => {
  const { suite, test, assertEqual, assertTrue } = TestRunner;

  suite('SalesforceAuth JWT 構造');

  const captureJwt = (overrides = {}) => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt({ ...validOpts(), ...overrides }, { transport, signer });
    const assertion = transport.getCalls()[0].options.payload.assertion;
    const parts = assertion.split('.');
    return {
      header: decodeBase64UrlJson(parts[0]),
      claims: decodeBase64UrlJson(parts[1]),
      signaturePart: parts[2]
    };
  };

  test('JWT は 3 パート(. 区切り)で構成される', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const assertion = transport.getCalls()[0].options.payload.assertion;
    assertEqual(assertion.split('.').length, 3);
  });

  test('header に alg=RS256 / typ=JWT が含まれる', () => {
    const { header } = captureJwt();
    assertEqual(header.alg, 'RS256');
    assertEqual(header.typ, 'JWT');
  });

  test('claims に iss/sub/aud/exp が含まれる', () => {
    const { claims } = captureJwt();
    assertEqual(claims.iss, 'CONSUMER_KEY_XXX');
    assertEqual(claims.sub, 'user@example.com');
    assertEqual(claims.aud, TEST_TOKEN_HOST);
    assertTrue(typeof claims.exp === 'number');
  });

  test('claims.aud は tokenHost と一致する', () => {
    const { claims } = captureJwt({ tokenHost: 'https://acme--sbx.sandbox.my.salesforce.com' });
    assertEqual(claims.aud, 'https://acme--sbx.sandbox.my.salesforce.com');
  });

  test('exp は now + 180 秒以内', () => {
    const before = Math.floor(Date.now() / 1000);
    const { claims } = captureJwt();
    const after = Math.floor(Date.now() / 1000);
    assertTrue(claims.exp >= before, `exp(${claims.exp}) >= before(${before})`);
    assertTrue(claims.exp <= after + 180, `exp(${claims.exp}) <= after + 180(${after + 180})`);
  });

  test('signer.computeRsaSha256Signature が呼ばれる', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const recorded = [];
    const signer = createFakeSigner(recorded);
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    assertEqual(recorded.length, 1);
    assertEqual(recorded[0].privateKey, validOpts().privateKey);
    // signingInput は header.claims の連結
    assertTrue(recorded[0].signingInput.includes('.'));
  });

  test('signingInput が JWT 先頭 2 パート(header.claims)と完全一致する', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const recorded = [];
    const signer = createFakeSigner(recorded);
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const assertion = transport.getCalls()[0].options.payload.assertion;
    const parts = assertion.split('.');
    assertEqual(recorded[0].signingInput, `${parts[0]}.${parts[1]}`);
  });
};

const runSfAuthErrorTests = () => {
  const { suite, test, assertThrows } = TestRunner;

  suite('SalesforceAuth エラー伝播');

  test('400 で HttpError がスローされる', () => {
    const transport = createFakeTransport({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'user hasn\'t approved this consumer' }
    });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'HTTPエラー 400'
    );
  });

  test('500 で HttpError がスローされる', () => {
    const transport = createFakeTransport({ status: 500, body: 'Internal Server Error' });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'HTTPエラー 500'
    );
  });

  test('200 で access_token が欠落していたら明示的にエラー', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { instance_url: 'https://x' }
    });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'access_token'
    );
  });

  test('エラー時の HttpError.request.body には JWT assertion が含まれない (redacted)', () => {
    const transport = createFakeTransport({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'bad' }
    });
    const signer = createFakeSigner();
    let captured;
    try {
      SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    } catch (e) {
      captured = e;
    }
    if (!captured || captured.name !== 'HttpError') {
      throw new Error('HttpError がスローされていない');
    }
    const loggedBody = captured.request?.body;
    if (!loggedBody || loggedBody.assertion !== '[REDACTED]') {
      throw new Error('assertion が redacted されていない: ' + JSON.stringify(loggedBody));
    }
  });

  test('200 で instance_url が欠落していたら明示的にエラー', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'AT_xxx' }
    });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'instance_url'
    );
  });
};

const runSfAuthEdgeCaseTests = () => {
  const { suite, test, assertEqual, assertTrue, assertThrows } = TestRunner;

  suite('SalesforceAuth エッジケース');

  test('consumerKey が数値だと TypeError', () => {
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt({ consumerKey: 123, username: 'u', privateKey: 'k' }),
      'consumerKey'
    );
  });

  test('username が null だと TypeError', () => {
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt({ consumerKey: 'c', username: null, privateKey: 'k' }),
      'username'
    );
  });

  test('privateKey が undefined だと TypeError', () => {
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt({ consumerKey: 'c', username: 'u', tokenHost: TEST_TOKEN_HOST }),
      'privateKey'
    );
  });

  test('opts が undefined でも TypeError (consumerKey 欠落)', () => {
    assertThrows(() => SalesforceAuth.getAccessTokenByJwt(undefined), 'consumerKey');
  });

  test('fetch options に method=post / muteHttpExceptions=true が指定される', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const opts = transport.getCalls()[0].options;
    assertEqual(opts.method, 'post');
    assertEqual(opts.muteHttpExceptions, true);
  });

  test('payload はオブジェクト形式 (form-urlencoded として GAS 側でエンコードされる)', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const opts = transport.getCalls()[0].options;
    assertTrue(typeof opts.payload === 'object' && !Array.isArray(opts.payload));
    assertTrue(typeof opts.payload.assertion === 'string');
  });

  test('access_token が空文字でもエラー', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: '', instance_url: 'https://x' }
    });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'access_token'
    );
  });

  test('instance_url が空文字でもエラー', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'AT', instance_url: '' }
    });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'instance_url'
    );
  });

  test('access_token が非文字列(数値)でもエラー', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 123, instance_url: 'https://x' }
    });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'access_token'
    );
  });

  test('200 でレスポンスボディが完全に空でも明示的エラー', () => {
    const transport = createFakeTransport({ status: 200, body: {} });
    const signer = createFakeSigner();
    assertThrows(
      () => SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer }),
      'access_token'
    );
  });

  test('JWT exp は now より大きい', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    const before = Math.floor(Date.now() / 1000);
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const assertion = transport.getCalls()[0].options.payload.assertion;
    const claims = decodeBase64UrlJson(assertion.split('.')[1]);
    assertTrue(claims.exp > before, `exp(${claims.exp}) > before(${before})`);
  });

  test('iss はリテラル文字列で渡された値と一致 (URL エンコードされない)', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    const opts = { ...validOpts(), consumerKey: '3MVG9.abc+xyz/== weird' };
    SalesforceAuth.getAccessTokenByJwt(opts, { transport, signer });
    const assertion = transport.getCalls()[0].options.payload.assertion;
    const claims = decodeBase64UrlJson(assertion.split('.')[1]);
    assertEqual(claims.iss, '3MVG9.abc+xyz/== weird');
  });

  test('JWT 各パートに base64url 不正文字 (=, +, /) が含まれない', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    const assertion = transport.getCalls()[0].options.payload.assertion;
    assertTrue(!assertion.includes('='));
    assertTrue(!assertion.includes('+'));
    assertTrue(!assertion.includes('/'));
  });

  test('audience は claims.aud と token URL ホストで一致する', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(
      { ...validOpts(), tokenHost: 'https://acme--sbx.sandbox.my.salesforce.com' },
      { transport, signer }
    );
    const call = transport.getCalls()[0];
    const assertion = call.options.payload.assertion;
    const claims = decodeBase64UrlJson(assertion.split('.')[1]);
    assertTrue(call.url.startsWith(claims.aud), `${call.url} starts with ${claims.aud}`);
  });

  test('token endpoint で 503 が連続するとリトライ上限に達してエラー (デフォルトトランスポート使用)', () => {
    // deps.transport を渡さずデフォルト経路をカバー → UrlFetchApp をモック
    const original = typeof globalThis.UrlFetchApp !== 'undefined' ? globalThis.UrlFetchApp : undefined;
    const calls = [];
    globalThis.UrlFetchApp = {
      fetch: (url, options) => {
        calls.push({ url, options });
        return {
          getResponseCode: () => 503,
          getContentText: () => 'unavailable',
          getAllHeaders: () => ({})
        };
      }
    };
    try {
      const signer = createFakeSigner();
      assertThrows(
        () => SalesforceAuth.getAccessTokenByJwt(
          validOpts(),
          { signer, /* transport omitted on purpose */ }
        ).accessToken && null,
        'リトライ'
      );
      // maxRetries=3 の上、503 リトライ
      assertTrue(calls.length >= 2);
    } finally {
      if (original === undefined) delete globalThis.UrlFetchApp;
      else globalThis.UrlFetchApp = original;
    }
  });

  test('logger を渡しても例外なく動作する', () => {
    const logs = [];
    const logger = {
      log: (...a) => logs.push(a), info: (...a) => logs.push(a),
      warn: (...a) => logs.push(a), error: (...a) => logs.push(a),
      debug: (...a) => logs.push(a)
    };
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    const result = SalesforceAuth.getAccessTokenByJwt(
      { ...validOpts(), logger },
      { transport, signer }
    );
    assertEqual(result.accessToken, 'a');
  });
};

function runAllSalesforceAuthTests() {
  TestRunner.reset();

  console.log('Running SF Auth Interface tests...');
  runSfAuthInterfaceTests();

  console.log('Running SF Auth バリデーション tests...');
  runSfAuthValidationTests();

  console.log('Running SF Auth 正常系 tests...');
  runSfAuthSuccessTests();

  console.log('Running SF Auth JWT 構造 tests...');
  runSfAuthJwtStructureTests();

  console.log('Running SF Auth エラー伝播 tests...');
  runSfAuthErrorTests();

  console.log('Running SF Auth エッジケース tests...');
  runSfAuthEdgeCaseTests();

  return TestRunner.run();
}
