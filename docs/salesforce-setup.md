# Salesforce 連携セットアップガイド

GAS から Salesforce REST API を `SalesforceAuth` + `SalesforceApiClient` で呼び出すまでの手順をまとめる。

---

## 0. 対象環境・前提

| 項目 | 内容 |
|---|---|
| Salesforce 側 | **Spring '26 以降の External Client App** を前提とする |
| 認証フロー | OAuth 2.0 JWT Bearer Flow (サーバー間連携) |
| GAS 側 | V8 ランタイム |
| ライブラリ | `SalesforceAuth.gs`, `SalesforceApiClient.gs`, および依存(`HttpCore`, `ApiClient`, `LoggerFacade`) |

> **用語**
> - **External Client App**: Spring '26 以降の OAuth アプリ形式(新規作成はこちらが既定)
> - **Connected App**: 従来形式
> - **My Domain URL**: `https://yourcompany.my.salesforce.com` 形式の組織固有 URL

新規実装では External Client App + My Domain URL を必須とする。`login.salesforce.com` / `test.salesforce.com` 固定の構成は本ライブラリでは対応していない。

---

## 1. 鍵ペアと証明書を生成する

本番と Sandbox は**別々の鍵ペア**を使う(漏洩時の被害局所化と、Sandbox refresh 時の事故防止のため)。

```bash
mkdir prod && cd prod

# 1) RSA 秘密鍵を生成
openssl genrsa -out private_key.pem 2048

# 2) 自己署名証明書(Salesforce 側にアップロードする)
openssl req -new -x509 -key private_key.pem -out certificate.crt \
  -days 3650 -subj "/CN=SalesforceJWT_PROD"

# 3) GAS が要求する PKCS#8 形式に変換
openssl pkcs8 -topk8 -nocrypt -in private_key.pem -out private_key_pkcs8.pem

# 4) BEGIN PRIVATE KEY で始まることを確認
head -1 private_key_pkcs8.pem
# → -----BEGIN PRIVATE KEY-----  (← OK)
# → -----BEGIN RSA PRIVATE KEY-----  なら PKCS#1 のまま、再変換が必要
```

Sandbox 用は別ディレクトリ(`sandbox/`) で同じ手順を `SalesforceJWT_SBX` のように CN を変えて実行する。

> **GAS の制約**: `Utilities.computeRsaSha256Signature` は **PKCS#8 形式のみ**を受け付ける。PKCS#1 (`BEGIN RSA PRIVATE KEY`) を渡すと `Invalid argument: key` エラーで落ちる。

---

## 2. Salesforce 側設定

### 2.1 External Client App を作成

1. 設定 → External Client Apps → **新規 External Client App**
2. 基本情報を入力(名前、API 参照名、Contact Email)
3. **OAuth Settings** を有効化
   - Callback URL: 任意(JWT Bearer Flow では使わないが必須)
   - **Use Digital Signatures** にチェックを入れ、`certificate.crt` をアップロード
   - OAuth Scopes:
     - `Manage user data via APIs (api)`
     - `Perform requests at any time (refresh_token, offline_access)`
4. 保存後、**Consumer Key / Consumer Secret** を控える(Consumer Key だけ使用)

### 2.2 OAuth Policy を設定

1. 作成した External Client App → **Policies** → **OAuth Policies**
2. **Permitted Users**: `Admin approved users are pre-authorized`
3. **IP Relaxation**: 環境に合わせて選択(GAS は固定 IP を持たないので通常は緩める)

### 2.3 Integration User を割り当てる

可能なら **Salesforce Integration User License** を使う(API 専用、安価)。利用できなければ通常ユーザー。

| 項目 | 推奨 |
|---|---|
| プロファイル | API Only 系 or 最小権限のカスタムプロファイル |
| 権限 | `API Enabled` + 必要なオブジェクトの CRUD + 必要な FLS のみ |
| Username 命名例 | `integration@yourcompany.com.prod` / `integration@yourcompany.com.sbx` |

External Client App の **Manage Profiles / Permission Sets** で、この Integration User が属するプロファイル/権限セットをアタッチする。

### 2.4 My Domain URL を確認

設定 → My Domain で「現在の My Domain URL」を控える。

```
本番例:    https://yourcompany.my.salesforce.com
Sandbox例: https://yourcompany--sbx.sandbox.my.salesforce.com
```

> **注意**: Lightning URL (`https://yourcompany.lightning.force.com`) は UI 専用で OAuth では使えない。

---

## 3. GAS 側設定

### 3.1 Script Properties に登録

PEM ファイルは複数行のため、**`\n` 区切りの 1 行文字列**にしてからコピーする。

```bash
awk '{printf "%s\\n", $0}' private_key_pkcs8.pem
# → -----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```

スクリプト → プロジェクトの設定 → **スクリプト プロパティ** に以下を登録(命名は自由、本ガイドでは環境サフィックス方式の例)。

| プロパティ名 | 値の例 |
|---|---|
| `SF_CONSUMER_KEY_PROD` | `3MVG9...` |
| `SF_USERNAME_PROD` | `integration@yourcompany.com.prod` |
| `SF_PRIVATE_KEY_PROD` | `-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n` |
| `SF_TOKEN_HOST_PROD` | `https://yourcompany.my.salesforce.com` |
| `SF_CONSUMER_KEY_SBX` | `3MVG9...` |
| `SF_USERNAME_SBX` | `integration@yourcompany.com.sbx` |
| `SF_PRIVATE_KEY_SBX` | `-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n` |
| `SF_TOKEN_HOST_SBX` | `https://yourcompany--sbx.sandbox.my.salesforce.com` |

> **`SF_TOKEN_HOST_*` は必ずホスト部のみ・全て小文字**にする。Salesforce 側のホストは小文字で扱われるため、大文字混じり (`Yourcompany.My.Salesforce.com` 等) で登録すると `app_not_found` 系の調査が困難になる。次の形式は全部 `TypeError` で弾かれる:
>
> ```
> ❌ https://yourcompany.my.salesforce.com/                          ← trailing slash
> ❌ https://yourcompany.my.salesforce.com/services/oauth2/token     ← endpoint 混入
> ❌ https://yourcompany.lightning.force.com                         ← Lightning URL
> ❌ http://yourcompany.my.salesforce.com                            ← http://
> ```

### 3.2 GAS 側で改行を復元する

Script Properties から取り出した秘密鍵は `\n` がリテラルなので、JS 側で改行に戻す:

```javascript
const privateKey = props.getProperty('SF_PRIVATE_KEY_PROD')
                       .replace(/\\n/g, '\n')
                       .trim();
```

### 3.3 Script Properties 運用上の注意

- GAS プロジェクトの**編集権限を持つユーザーは Script Properties を全て参照できる**。編集権限は最小限のユーザーに絞る。
- 本番用と Sandbox 用の鍵ペアは**必ず別々**にする。
- より厳格に管理したい場合は Google Cloud Secret Manager 等への外部化を検討する。
- 証明書の有効期限(`-days` 指定値)が切れる前にローテーションする運用を組む。

---

## 4. Hello World

### 4.1 access token を取得して 1 件 SELECT

```javascript
function helloSalesforce() {
  const props = PropertiesService.getScriptProperties();

  // 1) access token を取得
  const { accessToken, instanceUrl } = SalesforceAuth.getAccessTokenByJwt({
    consumerKey: props.getProperty('SF_CONSUMER_KEY_PROD'),
    username:    props.getProperty('SF_USERNAME_PROD'),
    privateKey:  props.getProperty('SF_PRIVATE_KEY_PROD').replace(/\\n/g, '\n').trim(),
    tokenHost:   props.getProperty('SF_TOKEN_HOST_PROD'),
    logger:      console
  });

  // 2) クライアントを構築
  const sf = SalesforceApiClient.create(instanceUrl, accessToken, {
    apiVersion: 'v60.0',
    logger:     console
  });

  // 3) SOQL を 1 件投げる
  const res = sf.call({
    method: 'GET',
    endpoint: 'query',
    query: { q: 'SELECT Id, Name FROM Account LIMIT 1' }
  });
  console.log(res.body);
}
```

成功すると `{ totalSize: 1, done: true, records: [{ Id: '001...', Name: '...' }] }` のような構造が返る。

### 4.2 Sandbox / 本番を切り替える

環境切り替えは**呼び出し側のコード**で行う(本ライブラリは環境概念を持たない)。下記は 1 例:

```javascript
function getSalesforceClient(env = 'prod') {
  const props  = PropertiesService.getScriptProperties();
  const suffix = env === 'sandbox' ? '_SBX' : '_PROD';

  const { accessToken, instanceUrl } = SalesforceAuth.getAccessTokenByJwt({
    consumerKey: props.getProperty(`SF_CONSUMER_KEY${suffix}`),
    username:    props.getProperty(`SF_USERNAME${suffix}`),
    privateKey:  props.getProperty(`SF_PRIVATE_KEY${suffix}`).replace(/\\n/g, '\n').trim(),
    tokenHost:   props.getProperty(`SF_TOKEN_HOST${suffix}`),
    logger:      console
  });
  return SalesforceApiClient.create(instanceUrl, accessToken, { apiVersion: 'v60.0' });
}
```

### 4.3 access token をキャッシュする(任意)

JWT Bearer Flow 自体は数百ミリ秒で完了するため、**通常は呼び出しごとに取得して問題ない**。高頻度トリガーや大量 API 呼び出しで token endpoint への負荷を減らしたい場合のみ `CacheService` を検討する:

```javascript
function getCachedToken(env = 'prod') {
  const cache    = CacheService.getScriptCache();
  const cacheKey = `SF_TOKEN_${env.toUpperCase()}`;
  const cached   = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  const token = getTokenByEnv(env); // SalesforceAuth.getAccessTokenByJwt を呼ぶ
  cache.put(cacheKey, JSON.stringify(token), 600); // 10 分
  return token;
}
```

> Salesforce の access token は通常 2 時間程度有効だが、組織のセッションポリシーで短縮されている場合がある。長めの TTL にする際はセッションタイムアウト値を確認すること。

---

## 5. トラブルシュート

| 症状 | 原因 | 対処 |
|---|---|---|
| `app_not_found` | `aud` / token endpoint に `login.salesforce.com` 等を使っている。Spring '26 以降の External Client App は My Domain URL が必要 | `tokenHost` に組織の My Domain URL を指定する |
| `user hasn't approved this consumer` | `sub` (= `username` opt) にメールアドレスを指定している。Salesforce Username と異なる場合がある | 設定 → ユーザー → 「ユーザー名」列の正確な値を `username` に渡す |
| `Invalid argument: key` | 秘密鍵が PKCS#1 形式 / 改行が壊れている | PKCS#8 に変換 + Script Properties から取り出した後に `replace(/\\n/g, '\n')` |
| `tokenHost にはホスト部のみを指定してください` | trailing slash / `/services/oauth2/token` / Lightning URL | ホスト部のみに修正 |
| `invalid_grant` | OAuth Policy が `Admin approved users are pre-authorized` になっていない / Integration User にプロファイル / 権限セットが割り当てられていない | External Client App の Policies と Profile/Permission Set 割当を再確認 |

---

## 6. Sandbox リフレッシュ後チェックリスト

Sandbox を refresh すると External Client App や Integration User の設定がリセットされることがある。以下を確認:

```
External Client App
 ├ [ ] アプリの存在確認
 ├ [ ] Consumer Key の再確認 → SF_CONSUMER_KEY_SBX を更新
 ├ [ ] 証明書 (certificate.crt) の再アップロード
 ├ [ ] OAuth Policy「Admin approved users are pre-authorized」を再確認
 └ [ ] プロファイル / 権限セットの再割り当て確認

Integration User
 ├ [ ] Username の確認 → SF_USERNAME_SBX を更新
 │     (refresh 後にサフィックスが変わることがある)
 └ [ ] プロファイル・権限の確認

GAS
 ├ [ ] SF_CONSUMER_KEY_SBX の更新
 ├ [ ] SF_USERNAME_SBX の更新
 ├ [ ] SF_TOKEN_HOST_SBX の確認(My Domain が変わることはあまりないが念のため)
 └ [ ] helloSalesforce 相当のテスト関数を実行して接続確認
```

---

## 7. 参考リンク

- [OAuth 2.0 JWT Bearer Flow for Server-to-Server Integration](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_jwt_flow.htm)
- [New Connected Apps Can No Longer Be Created in Spring '26](https://help.salesforce.com/s/articleView?id=005228017&language=en_US&type=1)
- [Salesforce Integration User License](https://help.salesforce.com/s/articleView?id=platform.integration_user.htm&type=5)
