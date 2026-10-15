/**
 * plugins/salesforce.ts
 *
 * @description Salesforce REST API 用プラグインセット（soql / sobject）
 *
 * 使用例:
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.soql(decodeAccount)); // decodeAccount: (row: unknown) => Account
 *   const result = await sf.query('SELECT Id, Name FROM Account LIMIT 10');
 *
 * Bulk API v2 は .use() で合成しないので、プラグインではなく SalesforceBulk（../SalesforceBulk.ts）にある。
 */

import type { Plugin } from '../ApiClient.ts';
import type { CallOptions, Decoder } from '../httpTypes.ts';

// ============================================================================
// 共通型定義（REST API）
// ============================================================================

export interface SoqlResult<TRow = unknown> {
  records: TRow[];
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
}

/** soql() が追加するメソッド */
export interface SoqlMethods<TRow> {
  /**
   * SOQL クエリを実行する（1 ページ分。最大 2000 件）
   * @param soql - SOQL クエリ文字列
   * @param callOptions - 中断シグナル等
   * @returns クエリ結果（records は decodeRow を通した値）
   * @throws {Error} 応答が SOQL の結果形式でない場合。decodeRow が投げた例外もそのまま伝わる
   */
  query(soql: string, callOptions?: CallOptions): Promise<SoqlResult<TRow>>;
  /**
   * SOQL クエリを全件取得する（nextRecordsUrl を自動的に辿る）
   * @param soql - SOQL クエリ文字列
   * @param callOptions - 中断シグナル等
   * @returns 全ページのレコード（decodeRow を通した値）
   * @throws {Error} 応答が SOQL の結果形式でない場合、または done: false なのに nextRecordsUrl が
   *   無い場合。decodeRow が投げた例外もそのまま伝わる
   */
  queryAll(soql: string, callOptions?: CallOptions): Promise<TRow[]>;
}

/** sobject() が追加するメソッド */
export interface SobjectMethods<TRecord> {
  /**
   * @param id - Salesforce レコード ID (15桁 or 18桁)
   * @param callOptions - 中断シグナル等
   * @returns レコード（decode を通した値）
   * @throws {Error} decode が投げた例外
   */
  findById(id: string, callOptions?: CallOptions): Promise<TRecord>;
  /**
   * @param data - 作成するレコードのフィールド値
   * @param callOptions - 中断シグナル等
   * @returns 作成されたレコードの id と success フラグ
   * @throws {Error} 応答が id / success を持たない場合
   */
  create(data: Partial<TRecord>, callOptions?: CallOptions): Promise<SobjectCreateResult>;
  /**
   * @param id - 更新対象のレコード ID
   * @param data - 更新するフィールド値
   * @param callOptions - 中断シグナル等
   */
  update(id: string, data: Partial<TRecord>, callOptions?: CallOptions): Promise<void>;
  /**
   * @param id - 削除対象のレコード ID
   * @param callOptions - 中断シグナル等
   */
  delete(id: string, callOptions?: CallOptions): Promise<void>;
}

export interface SobjectCreateResult {
  id: string;
  success: boolean;
}

// ============================================================================
// 内部ヘルパー
// ============================================================================

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** 文字列なら nextRecordsUrl として持たせる（Salesforce は最終ページで null を返す） */
const withNextRecordsUrl = (next: unknown): { nextRecordsUrl?: string } =>
  typeof next === 'string' ? { nextRecordsUrl: next } : {};

/**
 * SOQL 応答のエンベロープ（records / totalSize / done）を検査し、各行を decodeRow に通す
 *
 * @throws {Error} エンベロープの形をしていない場合。decodeRow が投げた例外もそのまま伝わる
 */
const toSoqlResult = <TRow>(body: unknown, decodeRow: Decoder<TRow>): SoqlResult<TRow> => {
  const records: unknown = isObject(body) ? Reflect.get(body, 'records') : undefined;
  const totalSize: unknown = isObject(body) ? Reflect.get(body, 'totalSize') : undefined;
  const done: unknown = isObject(body) ? Reflect.get(body, 'done') : undefined;
  if (!isObject(body) || !Array.isArray(records) || typeof totalSize !== 'number') {
    throw new Error('Salesforce /query が SOQL の結果形式でない応答を返しました', { cause: body });
  }
  if (typeof done !== 'boolean') {
    throw new Error('Salesforce /query が SOQL の結果形式でない応答を返しました', { cause: body });
  }
  return {
    records: records.map((row: unknown) => decodeRow(row)),
    totalSize,
    done,
    ...withNextRecordsUrl(Reflect.get(body, 'nextRecordsUrl')),
  };
};

// ============================================================================
// soql プラグイン
// ============================================================================

const buildSoql =
  <TRow>(decodeRow: Decoder<TRow>): Plugin<unknown, SoqlMethods<TRow>> =>
  (client) => ({
    query: async (soqlQuery, callOptions) =>
      toSoqlResult(
        await client.call({
          method: 'GET',
          endpoint: '/query',
          query: { q: soqlQuery },
          signal: callOptions?.signal,
        }),
        decodeRow,
      ),

    queryAll: async (soqlQuery, callOptions) => {
      const signal = callOptions?.signal;
      const records: TRow[] = [];
      let result = toSoqlResult(
        await client.call({ method: 'GET', endpoint: '/query', query: { q: soqlQuery }, signal }),
        decodeRow,
      );
      records.push(...result.records);
      const visited = new Set<string>();
      while (!result.done) {
        // 無いと途中までの records を全件として返し、同じ URL が続くと終わらない
        if (!result.nextRecordsUrl || visited.has(result.nextRecordsUrl)) {
          throw new Error(
            `SOQL の応答の nextRecordsUrl が不正です (done: false, nextRecordsUrl: ${String(result.nextRecordsUrl)})`,
          );
        }
        visited.add(result.nextRecordsUrl);
        // SF が返す nextRecordsUrl は /services/data/vXX.X/query/... の絶対パス形式。
        // ApiClient は baseUrl (/services/data/vXX.X) に endpoint を追記するため、
        // 重複する先頭部分を除去して相対パス (/query/...) に変換する。
        const nextPath = result.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+/, '');
        result = toSoqlResult(
          await client.call({ method: 'GET', endpoint: nextPath, signal }),
          decodeRow,
        );
        records.push(...result.records);
      }
      return records;
    },
  });

/**
 * SOQL クエリプラグイン
 *
 * 行の型を付けるときは、行を検証して変換する decodeRow を渡す（CODING_RULES.md §2.7）。
 * 省略すると行は unknown のまま返る。
 *
 * @param decodeRow - 各行の検証・変換
 * @returns query / queryAll を追加するプラグイン
 * @throws {TypeError} decodeRow が関数でない場合
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.soql(decodeAccount));
 *   await sf.query('SELECT Id FROM Account');
 *   await sf.queryAll('SELECT Id FROM Account'); // nextRecordsUrl を自動追跡
 */
function soql(): Plugin<unknown, SoqlMethods<unknown>>;
function soql<TRow>(decodeRow: Decoder<TRow>): Plugin<unknown, SoqlMethods<TRow>>;
function soql<TRow>(
  decodeRow?: Decoder<TRow>,
): Plugin<unknown, SoqlMethods<TRow>> | Plugin<unknown, SoqlMethods<unknown>> {
  // 公開 API の境界。誤りをクエリ実行時ではなく作成時に知らせる
  if (decodeRow !== undefined && typeof decodeRow !== 'function') {
    throw new TypeError('decodeRow には関数を指定してください');
  }
  return decodeRow ? buildSoql(decodeRow) : buildSoql((row) => row);
}

// ============================================================================
// sobject プラグイン
// ============================================================================

/** decode 省略時の既定: オブジェクトであることだけを検査する */
const toRecord = (body: unknown): Record<string, unknown> => {
  if (!isObject(body)) {
    throw new Error('Salesforce sObject API がレコードの形式でない応答を返しました', {
      cause: body,
    });
  }
  return Object.fromEntries(Object.entries(body));
};

/** POST /sobjects/{type} の応答（id / success）を検査する */
const toCreateResult = (body: unknown): SobjectCreateResult => {
  const id: unknown = isObject(body) ? Reflect.get(body, 'id') : undefined;
  const success: unknown = isObject(body) ? Reflect.get(body, 'success') : undefined;
  if (typeof id !== 'string' || typeof success !== 'boolean') {
    throw new Error('Salesforce sObject API がレコード作成結果の形式でない応答を返しました', {
      cause: body,
    });
  }
  return { id, success };
};

const buildSobject =
  <TRecord>(type: string, decode: Decoder<TRecord>): Plugin<unknown, SobjectMethods<TRecord>> =>
  (client) => {
    const typePath = encodeURIComponent(type);
    return {
      findById: async (id, callOptions) =>
        decode(
          await client.call({
            method: 'GET',
            endpoint: `/sobjects/${typePath}/${encodeURIComponent(id)}`,
            signal: callOptions?.signal,
          }),
        ),

      create: async (data, callOptions) =>
        toCreateResult(
          await client.call({
            method: 'POST',
            endpoint: `/sobjects/${typePath}`,
            body: data,
            signal: callOptions?.signal,
          }),
        ),

      // PATCH / DELETE は 204 No Content を返すので、戻り値は無い
      update: async (id, data, callOptions) => {
        await client.call({
          method: 'PATCH',
          endpoint: `/sobjects/${typePath}/${encodeURIComponent(id)}`,
          body: data,
          signal: callOptions?.signal,
        });
      },

      delete: async (id, callOptions) => {
        await client.call({
          method: 'DELETE',
          endpoint: `/sobjects/${typePath}/${encodeURIComponent(id)}`,
          signal: callOptions?.signal,
        });
      },
    };
  };

/**
 * sObject CRUD プラグイン
 *
 * レコードの型を付けるときは、レコードを検証して変換する decode を渡す（CODING_RULES.md §2.7）。
 * 省略するとレコードは Record<string, unknown> として返る。
 *
 * @param type - sObject API 名 (例: 'Account', 'Contact')
 * @param decode - レコードの検証・変換
 * @returns findById / create / update / delete を追加するプラグイン
 * @throws {TypeError} type が空文字または string 以外の場合、decode が関数でない場合
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforceApiClientPlugins.sobject('Account', decodeAccount));
 *   const account = await sf.findById('001...');
 *   await sf.update('001...', { Name: 'New Name' });
 *
 *   // 複数の sObject を使うときは名前を付けて足す（同じメソッド名は use() で TypeError になる）
 *   const crm = SalesforceApiClient.create(url, token)
 *     .use('account', SalesforceApiClientPlugins.sobject('Account'))
 *     .use('contact', SalesforceApiClientPlugins.sobject('Contact'));
 *   await crm.contact.findById('003...');
 */
function sobject(type: string): Plugin<unknown, SobjectMethods<Record<string, unknown>>>;
function sobject<TRecord>(
  type: string,
  decode: Decoder<TRecord>,
): Plugin<unknown, SobjectMethods<TRecord>>;
function sobject<TRecord>(
  type: string,
  decode?: Decoder<TRecord>,
):
  | Plugin<unknown, SobjectMethods<TRecord>>
  | Plugin<unknown, SobjectMethods<Record<string, unknown>>> {
  if (typeof type !== 'string' || type === '') {
    throw new TypeError('type には sObject の API 名 (string) を指定してください');
  }
  if (decode !== undefined && typeof decode !== 'function') {
    throw new TypeError('decode には関数を指定してください');
  }
  return decode ? buildSobject(type, decode) : buildSobject(type, toRecord);
}

// ============================================================================
// エクスポート
// ============================================================================

export const SalesforceApiClientPlugins = {
  soql,
  sobject,
} as const;
