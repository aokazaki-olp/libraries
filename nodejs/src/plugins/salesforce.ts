/**
 * plugins/salesforce.ts
 * @description Salesforce REST API 用プラグインセット
 *
 * 使用例:
 *   type Account = { Id: string; Name: string };
 *
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforcePlugins.soql<Account>());
 *   const result = await sf.query('SELECT Id, Name FROM Account LIMIT 10');
 *   // result.records: Account[]
 *
 *   const sf2 = SalesforceApiClient.create(url, token)
 *     .use(SalesforcePlugins.sobject<Account>('Account'));
 *   const acc = await sf2.findById('001...');
 *   // acc: Account
 */

import type { Plugin } from '../ApiClient.js';

// ============================================================================
// 共通型定義
// ============================================================================

export interface SoqlResult<TRow = unknown> {
  records: TRow[];
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
}

// ============================================================================
// soql プラグイン
// ============================================================================

/**
 * SOQL クエリプラグイン
 *
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforcePlugins.soql<Account>());
 *   await sf.query('SELECT Id FROM Account');
 *   await sf.queryAll('SELECT Id FROM Account'); // nextRecordsUrl を自動追跡
 */
const soql = <TRow = unknown>(): Plugin<unknown, {
  /**
   * SOQL クエリを実行する（最大 2000 件）
   * @param soql - SOQL クエリ文字列
   */
  query(soql: string): Promise<SoqlResult<TRow>>;
  /**
   * SOQL クエリを全件取得する（nextRecordsUrl を自動的に辿る）
   * @param soql - SOQL クエリ文字列
   */
  queryAll(soql: string): Promise<TRow[]>;
}> => (client) => ({
  query: (q) =>
    // SF /query は SoqlResult 形式で返すことが SF REST API 仕様で保証される
    client.get('/query', { q }) as Promise<SoqlResult<TRow>>,

  queryAll: async (q) => {
    const records: TRow[] = [];
    let result = await client.get('/query', { q }) as SoqlResult<TRow>;
    records.push(...result.records);
    while (!result.done && result.nextRecordsUrl) {
      // SF が返す nextRecordsUrl は /services/data/vXX.X/query/... の絶対パス形式。
      // ApiClient は baseUrl (/services/data/vXX.X) に endpoint を追記するため、
      // 重複する先頭部分を除去して相対パス (/query/...) に変換する。
      const relPath = result.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+/, '');
      result = await client.get(relPath) as SoqlResult<TRow>;
      records.push(...result.records);
    }
    return records;
  },
});

// ============================================================================
// sobject プラグイン
// ============================================================================

/**
 * sObject CRUD プラグイン
 *
 * @param type - sObject API 名 (例: 'Account', 'Contact')
 * @example
 *   const sf = SalesforceApiClient.create(url, token)
 *     .use(SalesforcePlugins.sobject<Account>('Account'));
 *   const acc = await sf.findById('001...');
 *   await sf.update('001...', { Name: 'New Name' });
 */
const sobject = <TRecord = unknown>(type: string): Plugin<unknown, {
  /**
   * @param id - Salesforce レコード ID (15桁 or 18桁)
   */
  findById(id: string): Promise<TRecord>;
  /**
   * @param data - 作成するレコードのフィールド値
   * @returns 作成されたレコードの id と success フラグ
   */
  create(data: Partial<TRecord>): Promise<{ id: string; success: boolean }>;
  /**
   * @param id - 更新対象のレコード ID
   * @param data - 更新するフィールド値
   */
  update(id: string, data: Partial<TRecord>): Promise<void>;
  /**
   * @param id - 削除対象のレコード ID
   */
  delete(id: string): Promise<void>;
}> => (client) => ({
  findById: (id) =>
    // SF /sobjects/{type}/{id} は TRecord 形式で返すことが SF REST API 仕様で保証される
    client.get(`/sobjects/${type}/${id}`) as Promise<TRecord>,

  create: (data) =>
    client.post(`/sobjects/${type}`, data) as Promise<{ id: string; success: boolean }>,

  update: (id, data) =>
    client.patch(`/sobjects/${type}/${id}`, data) as Promise<void>,

  delete: (id) =>
    client.delete(`/sobjects/${type}/${id}`) as Promise<void>,
});

// ============================================================================
// エクスポート
// ============================================================================

export const SalesforcePlugins = {
  soql,
  sobject,
} as const;
