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
