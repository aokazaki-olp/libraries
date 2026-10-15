/**
 * pluginContracts.test.ts
 *
 * @description プラグインの境界の契約（decode・応答の検査・signal の伝播・戻り値）のテスト
 */

import { describe, expect, it } from 'vitest';
import { SalesforceApiClient } from '../src/SalesforceApiClient.ts';
import { SlackApiClient } from '../src/SlackClient.ts';
import type { FetchOptions, RawResponse } from '../src/httpTypes.ts';
import { SalesforceApiClientPlugins } from '../src/plugins/salesforce.ts';
import { SlackPlugins } from '../src/plugins/slack.ts';
import { makeRawResponse, makeTransport } from './helpers.ts';

const INSTANCE_URL = 'https://x.my.salesforce.com';

const salesforce = (impl: (url: string, options?: FetchOptions) => Promise<RawResponse>) => {
  const transport = makeTransport(impl);
  return { transport, client: SalesforceApiClient.create(INSTANCE_URL, 't', { transport }) };
};

const respond = (body: unknown) => () => Promise.resolve(makeRawResponse({ body }));

interface Account {
  Id: string;
}

const decodeAccount = (row: unknown): Account => {
  const id: unknown = typeof row === 'object' && row !== null ? Reflect.get(row, 'Id') : undefined;
  if (typeof id !== 'string') {
    throw new TypeError('Id が string ではありません');
  }
  return { Id: id };
};

// ============================================================================
// soql
// ============================================================================

describe('soql — decodeRow', () => {
  it('decodeRow を各行に適用する（余分なフィールドは decodeRow の結果に従う）', async () => {
    const { client } = salesforce(
      respond({ totalSize: 1, done: true, records: [{ Id: '001', attributes: {} }] }),
    );
    const sf = client.use(SalesforceApiClientPlugins.soql(decodeAccount));

    const result = await sf.query('SELECT Id FROM Account');

    expect(result.records).toEqual([{ Id: '001' }]);
  });

  it('decodeRow が throw すると query が reject される', async () => {
    const { client } = salesforce(respond({ totalSize: 1, done: true, records: [{ Name: 'x' }] }));
    const sf = client.use(SalesforceApiClientPlugins.soql(decodeAccount));

    await expect(sf.query('SELECT Name FROM Account')).rejects.toThrow(
      'Id が string ではありません',
    );
  });

  it('decodeRow を省略すると行をそのまま返す', async () => {
    const { client } = salesforce(respond({ totalSize: 1, done: true, records: [{ Id: '001' }] }));
    const sf = client.use(SalesforceApiClientPlugins.soql());

    await expect(sf.queryAll('SELECT Id FROM Account')).resolves.toEqual([{ Id: '001' }]);
  });

  it('nextRecordsUrl が null（最終ページ）なら結果に持たせない', async () => {
    const { client } = salesforce(
      respond({ totalSize: 0, done: true, records: [], nextRecordsUrl: null }),
    );
    const sf = client.use(SalesforceApiClientPlugins.soql());

    const result = await sf.query('SELECT Id FROM Account');

    expect(result).toEqual({ totalSize: 0, done: true, records: [] });
  });
});

// ============================================================================
// sobject
// ============================================================================

describe('sobject — 応答の検査と戻り値', () => {
  it('decode を省略すると findById はオブジェクトをそのまま返す', async () => {
    const { client } = salesforce(respond({ Id: '001', Name: 'Acme' }));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    await expect(sf.findById('001')).resolves.toEqual({ Id: '001', Name: 'Acme' });
  });

  it('decode を省略しても、オブジェクトでない応答は Error', async () => {
    const { client } = salesforce(respond('not a record'));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    await expect(sf.findById('001')).rejects.toThrow('レコードの形式でない');
  });

  it('decode を渡すと findById はその結果を返す', async () => {
    const { client } = salesforce(respond({ Id: '001', Name: 'Acme' }));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account', decodeAccount));

    await expect(sf.findById('001')).resolves.toEqual({ Id: '001' });
  });

  it('create は id / success を検査して返す', async () => {
    const { client } = salesforce(respond({ id: '001', success: true, errors: [] }));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    await expect(sf.create({ Name: 'Acme' })).resolves.toEqual({ id: '001', success: true });
  });

  it('create の応答が id を持たなければ Error', async () => {
    const { client } = salesforce(respond({ success: false }));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    await expect(sf.create({ Name: 'Acme' })).rejects.toThrow('レコード作成結果の形式でない');
  });

  it('update / delete は値を返さない（204 No Content）', async () => {
    const { client } = salesforce(respond(null));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    await expect(sf.update('001', { Name: 'B' })).resolves.toBeUndefined();
    await expect(sf.delete('001')).resolves.toBeUndefined();
  });
});

// ============================================================================
// bulk — ジョブ情報の検査
// ============================================================================

describe('bulk — ジョブ情報の検査', () => {
  it('state が既知の値でなければ Error（waitForCompletion が終わらなくなるのを防ぐ）', async () => {
    const { client } = salesforce(respond({ id: 'job001', state: 'Unknown' }));
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.getJob('job001')).rejects.toThrow('ジョブ情報の形式でない');
    await expect(bulk.waitForCompletion('job001', { intervalMs: 1 })).rejects.toThrow(
      'ジョブ情報の形式でない',
    );
  });

  it('id が無ければ Error', async () => {
    const { client } = salesforce(respond({ state: 'JobComplete' }));
    const bulk = SalesforceApiClientPlugins.bulkQuery(client);

    await expect(bulk.getJob('job001')).rejects.toThrow('ジョブ情報の形式でない');
  });

  it('listJobs は records 配列と done を検査する', async () => {
    const { client } = salesforce(respond({ records: 'x', done: true }));
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.listJobs()).rejects.toThrow('ジョブ一覧の形式でない');
  });

  it('listJobs の nextRecordsUrl が null なら結果に持たせない', async () => {
    const { client } = salesforce(
      respond({ records: [{ id: 'j', state: 'Open' }], done: true, nextRecordsUrl: null }),
    );
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.listJobs()).resolves.toEqual({
      records: [{ id: 'j', state: 'Open' }],
      done: true,
    });
  });
});

// ============================================================================
// signal の伝播
// ============================================================================

describe('プラグインのメソッドは callOptions.signal を Transport に渡す', () => {
  const signal = new AbortController().signal;

  it('soql.query / queryAll', async () => {
    const { client, transport } = salesforce(respond({ totalSize: 0, done: true, records: [] }));
    const sf = client.use(SalesforceApiClientPlugins.soql());

    await sf.query('SELECT Id FROM Account', { signal });
    await sf.queryAll('SELECT Id FROM Account', { signal });

    expect(transport.calls.map((call) => call.options?.signal)).toEqual([signal, signal]);
  });

  it('sobject の各メソッド', async () => {
    const { client, transport } = salesforce(respond({ id: '001', success: true }));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    await sf.findById('001', { signal });
    await sf.create({ Name: 'A' }, { signal });
    await sf.update('001', { Name: 'B' }, { signal });
    await sf.delete('001', { signal });

    expect(transport.calls).toHaveLength(4);
    expect(transport.calls.every((call) => call.options?.signal === signal)).toBe(true);
  });

  it('bulkIngest の各メソッド', async () => {
    const { client, transport } = salesforce((url, options) => {
      if (url.endsWith('Results') || url.endsWith('unprocessedrecords')) {
        return Promise.resolve(makeRawResponse({ body: 'Id\n001' }));
      }
      if (url.endsWith('/jobs/ingest') && options?.method === 'GET') {
        return Promise.resolve(makeRawResponse({ body: { records: [], done: true } }));
      }
      return Promise.resolve(makeRawResponse({ body: { id: 'job001', state: 'Open' } }));
    });
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await bulk.createJob({ operation: 'insert', object: 'Account' }, { signal });
    await bulk.upload('job001', 'Id\n001', { signal });
    await bulk.close('job001', { signal });
    await bulk.abort('job001', { signal });
    await bulk.deleteJob('job001', { signal });
    await bulk.getJob('job001', { signal });
    await bulk.listJobs(undefined, { signal });
    await bulk.getSuccessfulResults('job001', { signal });
    await bulk.getFailedResults('job001', { signal });
    await bulk.getUnprocessedRecords('job001', { signal });

    expect(transport.calls).toHaveLength(10);
    expect(transport.calls.every((call) => call.options?.signal === signal)).toBe(true);
  });

  it('bulkQuery の各メソッド', async () => {
    const { client, transport } = salesforce((url, options) => {
      if (url.includes('/results')) {
        return Promise.resolve(makeRawResponse({ body: 'Id\n001' }));
      }
      if (url.endsWith('/jobs/query') && options?.method === 'GET') {
        return Promise.resolve(makeRawResponse({ body: { records: [], done: true } }));
      }
      return Promise.resolve(makeRawResponse({ body: { id: 'q1', state: 'JobComplete' } }));
    });
    const bulk = SalesforceApiClientPlugins.bulkQuery(client);

    await bulk.createJob({ operation: 'query', query: 'SELECT Id FROM Account' }, { signal });
    await bulk.abort('q1', { signal });
    await bulk.deleteJob('q1', { signal });
    await bulk.getJob('q1', { signal });
    await bulk.listJobs(undefined, { signal });
    await bulk.getResults('q1', { signal });
    await bulk.getResultsParallel('q1', { signal });

    expect(transport.calls).toHaveLength(7);
    expect(transport.calls.every((call) => call.options?.signal === signal)).toBe(true);
  });

  it('Slack の chat / reactions', async () => {
    const transport = makeTransport(respond({ ok: true }));
    const slack = SlackApiClient.create('xoxb', { transport })
      .use(SlackPlugins.chat())
      .use(SlackPlugins.reactions());

    await slack.postMessage('C1', 'hi', {}, { signal });
    await slack.postBlocks('C1', [], {}, { signal });
    await slack.update('C1', '1.0', 'hi', {}, { signal });
    await slack.delete('C1', '1.0', { signal });
    await slack.addReaction('C1', '1.0', 'ok', { signal });
    await slack.removeReaction('C1', '1.0', 'ok', { signal });

    expect(transport.calls).toHaveLength(6);
    expect(transport.calls.every((call) => call.options?.signal === signal)).toBe(true);
  });
});

// ============================================================================
// 戻り値・タイムアウト
// ============================================================================

describe('Slack プラグインは応答を返す', () => {
  it('postMessage は ts を含む応答を返す', async () => {
    const transport = makeTransport(respond({ ok: true, channel: 'C1', ts: '123.456' }));
    const slack = SlackApiClient.create('xoxb', { transport }).use(SlackPlugins.chat());

    await expect(slack.postMessage('C1', 'hi')).resolves.toEqual({
      ok: true,
      channel: 'C1',
      ts: '123.456',
    });
  });
});

describe('waitForCompletion の timeoutMs', () => {
  it('ジョブ情報の取得が返ってこなくても timeoutMs で打ち切る', async () => {
    // signal が中断されるまで応答しない Transport
    const { client } = salesforce(
      (_url, options) =>
        new Promise<RawResponse>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.waitForCompletion('job001', { timeoutMs: 50 })).rejects.toThrow(
      'がタイムアウトしました (50ms)',
    );
  });
});

describe('waitForCompletion の待ち時間の設定', () => {
  const job = (state: string) => respond({ id: 'job001', state });

  it.each([
    ['timeoutMs が NaN', { timeoutMs: Number.NaN }],
    ['timeoutMs が負数', { timeoutMs: -1 }],
    ['intervalMs が 0', { intervalMs: 0 }],
    ['intervalMs が NaN', { intervalMs: Number.NaN }],
    ['intervalMs がタイマーの上限超え', { intervalMs: 2 ** 31 }],
  ])('%s は TypeError（API を連打しない・すぐ打ち切らない）', async (_label, options) => {
    const { client, transport } = salesforce(job('InProgress'));
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.waitForCompletion('job001', options)).rejects.toThrow(TypeError);
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    ['Infinity（無期限）', Number.POSITIVE_INFINITY],
    ['小数', 1000.5],
    ['タイマーの上限超え', 3_000_000_000],
  ])('timeoutMs が %s でも取得して完了を返す', async (_label, timeoutMs) => {
    const { client } = salesforce(job('JobComplete'));
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.waitForCompletion('job001', { timeoutMs })).resolves.toMatchObject({
      state: 'JobComplete',
    });
  });

  it('timeoutMs が 0 でも 1 回は取得し、完了していれば返す', async () => {
    const { client, transport } = salesforce(job('JobComplete'));
    const bulk = SalesforceApiClientPlugins.bulkQuery(client);

    await expect(bulk.waitForCompletion('job001', { timeoutMs: 0 })).resolves.toMatchObject({
      state: 'JobComplete',
    });
    expect(transport.calls).toHaveLength(1);
  });

  it('timeoutMs が 0 で未完了なら、1 回取得してタイムアウト', async () => {
    const { client, transport } = salesforce(job('InProgress'));
    const bulk = SalesforceApiClientPlugins.bulkQuery(client);

    await expect(bulk.waitForCompletion('job001', { timeoutMs: 0 })).rejects.toThrow(
      'がタイムアウトしました (0ms)',
    );
    expect(transport.calls).toHaveLength(1);
  });
});

// ============================================================================
// プラグインの合成
// ============================================================================

describe('use() — プラグイン同士のメソッド名の衝突', () => {
  it('既に足したメソッド名を別のプラグインが定義すると TypeError', () => {
    const { client } = salesforce(respond(null));
    const sf = client.use(SalesforceApiClientPlugins.sobject('Account'));

    expect(() => sf.use(SalesforceApiClientPlugins.sobject('Contact'))).toThrow(
      'plugin のメソッド名が既存の plugin と重複しています: findById, create, update, delete',
    );
  });

  it('use(name, fn) でも同じ名前は TypeError', () => {
    const { client } = salesforce(respond(null));
    const sf = client.use('ping', () => () => 'pong');

    expect(() => sf.use('ping', () => () => 'pong')).toThrow(TypeError);
  });

  it('他のプラグインが HTTP メソッド名を上書きしても、プラグインの通信は影響を受けない', async () => {
    const { client, transport } = salesforce(respond({ totalSize: 0, done: true, records: [] }));
    const sf = client
      .use(() => ({ get: () => Promise.reject(new Error('上書きされた get が呼ばれた')) }))
      .use(SalesforceApiClientPlugins.soql());

    await expect(sf.query('SELECT Id FROM Account')).resolves.toEqual({
      totalSize: 0,
      done: true,
      records: [],
    });
    expect(transport.calls[0]?.url).toContain('/query');
  });
});

describe('soql.queryAll — 応答の不整合', () => {
  it('done: false なのに nextRecordsUrl が無いと Error（途中までを全件として返さない）', async () => {
    const { client } = salesforce(respond({ totalSize: 2, done: false, records: [{ Id: '001' }] }));
    const sf = client.use(SalesforceApiClientPlugins.soql());

    await expect(sf.queryAll('SELECT Id FROM Account')).rejects.toThrow(
      'done: false なのに nextRecordsUrl がありません',
    );
  });
});

describe('CSV の取得は Transport が受けた文字列をそのまま返す', () => {
  // 1 列 0 行の CSV は JSON の文字列としても読めてしまう
  const csvResponse =
    (text: string, headers: RawResponse['headers'] = {}) =>
    () =>
      Promise.resolve(makeRawResponse({ body: JSON.parse(text), text, headers }));

  it('bulkIngest の結果 CSV', async () => {
    const { client } = salesforce(csvResponse('"Id"'));
    const bulk = SalesforceApiClientPlugins.bulkIngest(client);

    await expect(bulk.getSuccessfulResults('j1')).resolves.toBe('"Id"');
  });

  it('bulkQuery の結果 CSV と Sforce-Locator', async () => {
    const { client } = salesforce(csvResponse('"Id"', { 'Sforce-Locator': 'LOC1' }));
    const bulk = SalesforceApiClientPlugins.bulkQuery(client);

    await expect(bulk.getResults('q1')).resolves.toEqual({ csv: '"Id"', nextLocator: 'LOC1' });
  });
});

describe('Slack chat — options の signal', () => {
  it('options に signal を入れると TypeError（本文に混ぜて送らない）', async () => {
    const transport = makeTransport(respond({ ok: true }));
    const slack = SlackApiClient.create('xoxb-test', { transport }).use(SlackPlugins.chat());
    const { signal } = new AbortController();

    // @ts-expect-error -- ChatOptions は signal を受けない（callOptions に渡す）
    await expect(slack.postMessage('C1', 'hi', { signal })).rejects.toThrow(TypeError);
    expect(transport.calls).toHaveLength(0);
  });
});
