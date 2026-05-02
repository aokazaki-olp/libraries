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

const validOpts = () => ({
  consumerKey: 'CONSUMER_KEY_XXX',
  username: 'user@example.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----'
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
  const { suite, test, assertThrows } = TestRunner;

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
      consumerKey: 'c', username: 'u', privateKey: ''
    }), 'privateKey');
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

  test('token endpoint URL は本番 (login.salesforce.com)', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt(validOpts(), { transport, signer });
    assertEqual(transport.getCalls()[0].url, 'https://login.salesforce.com/services/oauth2/token');
  });

  test('sandbox: true で test.salesforce.com を使う', () => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt({ ...validOpts(), sandbox: true }, { transport, signer });
    assertEqual(transport.getCalls()[0].url, 'https://test.salesforce.com/services/oauth2/token');
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

  const captureJwt = (sandbox = false) => {
    const transport = createFakeTransport({
      status: 200,
      body: { access_token: 'a', instance_url: 'i' }
    });
    const signer = createFakeSigner();
    SalesforceAuth.getAccessTokenByJwt({ ...validOpts(), sandbox }, { transport, signer });
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
    const { claims } = captureJwt(false);
    assertEqual(claims.iss, 'CONSUMER_KEY_XXX');
    assertEqual(claims.sub, 'user@example.com');
    assertEqual(claims.aud, 'https://login.salesforce.com');
    assertTrue(typeof claims.exp === 'number');
  });

  test('claims.aud は sandbox フラグで切り替わる', () => {
    const { claims } = captureJwt(true);
    assertEqual(claims.aud, 'https://test.salesforce.com');
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

  return TestRunner.run();
}
