import { describe, it, expect, beforeEach } from 'vitest';
import { SalesforceApiClient } from '../src/SalesforceApiClient.js';
import { SalesforcePlugins } from '../src/plugins/salesforce.js';
import { ApiClient } from '../src/ApiClient.js';
import type { RawResponse } from '../src/httpTypes.js';
import { mockTransport } from './helpers.js';

// ============================================================================
// withBearerAuth
// ============================================================================

describe('ApiClient.withBearerAuth', () => {
  it('Authorization: Bearer <token> ヘッダーを追加する', async () => {
    const transport = mockTransport();
    const authed = ApiClient.withBearerAuth(transport, 'my-token');
    await authed.fetch('https://example.com', { method: 'GET' });

    const call = transport.calls[0];
    expect(call.options?.headers?.['Authorization']).toBe('Bearer my-token');
  });

  it('既存ヘッダーを上書きしない（Authorization 以外）', async () => {
    const transport = mockTransport();
    const authed = ApiClient.withBearerAuth(transport, 'token');
    await authed.fetch('https://example.com', {
      headers: { 'Accept': 'application/json' },
    });

    const call = transport.calls[0];
    expect(call.options?.headers?.['Accept']).toBe('application/json');
    expect(call.options?.headers?.['Authorization']).toBe('Bearer token');
  });

  it('元の transport を変更しない（イミュータブル）', async () => {
    const transport = mockTransport();
    ApiClient.withBearerAuth(transport, 'token');
    // authed を呼ばずに元の transport を直接呼ぶ
    await transport.fetch('https://example.com');
    expect(transport.calls[0].options?.headers?.['Authorization']).toBeUndefined();
  });
});

// ============================================================================
// createClient — call
// ============================================================================

describe('ApiClient.createClient — call', () => {
  it('GET リクエストを送信する', async () => {
    const transport = mockTransport({ body: { id: 1 } });
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    const result = await client.call({ endpoint: '/users/1', method: 'GET' });
    expect(transport.calls[0].url).toBe('https://api.example.com/users/1');
    expect(transport.calls[0].options?.method).toBe('GET');
    // responseHandler なしは RawResponse をそのまま返す
    expect((result as RawResponse).body).toEqual({ id: 1 });
  });

  it('POST リクエストで body を JSON.stringify して送信する', async () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    await client.call({ endpoint: '/users', method: 'POST', body: { name: 'Alice' } });

    const call = transport.calls[0];
    expect(call.options?.method).toBe('POST');
    expect(call.options?.payload).toBe(JSON.stringify({ name: 'Alice' }));
    expect(call.options?.headers?.['Content-Type']).toContain('application/json');
  });

  it('GET + body は body を無視する（Content-Type も付けない）', async () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    await client.call({ endpoint: '/users', method: 'GET', body: { should: 'be ignored' } });

    const call = transport.calls[0];
    expect(call.options?.payload).toBeUndefined();
    expect(call.options?.headers?.['Content-Type']).toBeUndefined();
  });

  it('responseHandler を経由して値を返す', async () => {
    const transport = mockTransport({ body: { ok: true, data: [1, 2, 3] } });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport,
      responseHandler: (res) => (res.body as { data: number[] }).data,
    });

    const result = await client.call({ endpoint: '/items' });
    expect(result).toEqual([1, 2, 3]);
  });

  it('クエリパラメータを URL に付与する', async () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    await client.call({ endpoint: '/search', query: { q: 'hello', page: 1 } });
    expect(transport.calls[0].url).toBe('https://api.example.com/search?q=hello&page=1');
  });

  it('timeoutMs を FetchOptions に渡す', async () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    await client.call({ endpoint: '/slow', timeoutMs: 5000 });
    expect(transport.calls[0].options?.timeoutMs).toBe(5000);
  });
});

// ============================================================================
// createClient — HTTPメソッドショートカット
// ============================================================================

describe('ApiClient.createClient — HTTPメソッドショートカット', () => {
  let transport: ReturnType<typeof mockTransport>;
  let client: ReturnType<typeof ApiClient.createClient>;

  beforeEach(() => {
    transport = mockTransport({ body: { ok: true } });
    client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });
  });

  it('get() は GET リクエストを送る', async () => {
    await client.get('/users', { page: 1 });
    expect(transport.calls[0].options?.method).toBe('GET');
    expect(transport.calls[0].url).toContain('page=1');
  });

  it('post() は POST リクエストを送る', async () => {
    await client.post('/users', { name: 'Alice' });
    expect(transport.calls[0].options?.method).toBe('POST');
    expect(transport.calls[0].options?.payload).toBe(JSON.stringify({ name: 'Alice' }));
  });

  it('put() は PUT リクエストを送る', async () => {
    await client.put('/users/1', { name: 'Bob' });
    expect(transport.calls[0].options?.method).toBe('PUT');
  });

  it('patch() は PATCH リクエストを送る', async () => {
    await client.patch('/users/1', { name: 'Charlie' });
    expect(transport.calls[0].options?.method).toBe('PATCH');
  });

  it('delete() は DELETE リクエストを送る', async () => {
    await client.delete('/users/1');
    expect(transport.calls[0].options?.method).toBe('DELETE');
  });
});

// ============================================================================
// createClient — extend（イミュータブル）
// ============================================================================

describe('ApiClient.createClient — extend', () => {
  it('extend() は新しいクライアントを返し、元のクライアントを変更しない', async () => {
    const baseTransport = mockTransport({ body: 'base' });
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport: baseTransport });

    let decoratorCalled = false;
    const extended = client.extend((t) => ({
      fetch: async (url, options) => {
        decoratorCalled = true;
        return t.fetch(url, options);
      },
    }));

    // 元のクライアントを使う → デコレータは通らない
    await client.get('/a');
    expect(decoratorCalled).toBe(false);

    // 拡張クライアントを使う → デコレータを通る
    await extended.get('/b');
    expect(decoratorCalled).toBe(true);
  });

  it('extend() は responseHandler を保持する', async () => {
    const transport = mockTransport({ body: { result: 42 } });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport: mockTransport(),
      responseHandler: (res) => (res.body as { result: number }).result,
    });
    const extended = client.extend(() => transport);
    const result = await extended.get('/data');
    expect(result).toBe(42);
  });
});

// ============================================================================
// createClient — use（プラグイン）
// ============================================================================

describe('ApiClient.createClient — use', () => {
  it('use(plugin) でメソッドを追加できる', async () => {
    const transport = mockTransport({ body: { items: [1, 2, 3] } });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport,
      responseHandler: (res) => res.body,
    });

    const extended = client.use((c) => ({
      getItems: () => c.get('/items'),
    }));

    const result = await extended.getItems();
    expect(result).toEqual({ items: [1, 2, 3] });
    expect(transport.calls[0].url).toBe('https://api.example.com/items');
  });

  it('use(name, fn) でシングルメソッドを追加できる', async () => {
    const transport = mockTransport({ body: { total: 42 } });
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport,
      responseHandler: (res) => res.body,
    });

    const extended = client.use('getTotal', (c) => () => c.get('/total'));
    const result = await extended.getTotal();
    expect(result).toEqual({ total: 42 });
  });

  it('use() は連鎖できる', async () => {
    const transport = mockTransport({ body: {} });
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    const extended = client
      .use((c) => ({ methodA: () => c.get('/a') }))
      .use((c) => ({ methodB: () => c.get('/b') }));

    await extended.methodA();
    await extended.methodB();
    expect(transport.calls).toHaveLength(2);
  });

  it('use(plugin) に非オブジェクトを返すと TypeError をスローする', () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({ baseUrl: 'https://api.example.com', transport });

    expect(() =>
      client.use(() => 'not an object' as unknown as object),
    ).toThrow(TypeError);
  });
});

// ============================================================================
// createClient — use() と HTTP メソッド名衝突（回帰防止）
// ============================================================================

describe('ApiClient.createClient — use() plugin が HTTP メソッド名と衝突する場合 plugin が勝つ', () => {
  it('plugin の delete が HTTP delete に上書きされない', async () => {
    const transport = mockTransport({ status: 200, body: null });
    const client = ApiClient.createClient({
      baseUrl: 'https://example.com',
      transport,
      responseHandler: (res) => res.body,
    }).use((c) => ({
      delete: (id: string) => c.delete(`/items/${id}`),
    }));

    await client.delete('abc-123');

    // plugin が優先されれば /items/abc-123 になる（修正前は /abc-123 になりバグる）
    expect(transport.calls[0].url).toContain('/items/abc-123');
  });

  it('plugin の get が HTTP get に上書きされない', async () => {
    const transport = mockTransport({ status: 200, body: null });
    const client = ApiClient.createClient({
      baseUrl: 'https://example.com',
      transport,
      responseHandler: (res) => res.body,
    }).use((c) => ({
      get: (id: string) => c.get(`/items/${id}`),
    }));

    await client.get('xyz-999');

    expect(transport.calls[0].url).toContain('/items/xyz-999');
  });

  it('sobject plugin の delete が正しいエンドポイントを叩く', async () => {
    const transport = mockTransport({ status: 204, body: null });
    const sf = SalesforceApiClient
      .create('https://example.my.salesforce.com', 'token', { transport })
      .use(SalesforcePlugins.sobject('Account'));

    await sf.delete('001xxx');

    expect(transport.calls[0].options?.method).toBe('DELETE');
    expect(transport.calls[0].url).toContain('/sobjects/Account/001xxx');
  });
});

// ============================================================================
// createClient — デフォルトヘッダー
// ============================================================================

describe('ApiClient.createClient — デフォルトヘッダー', () => {
  it('createClient の headers が全リクエストに付与される', async () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport,
      headers: { 'Accept': 'application/json', 'X-Api-Key': 'key123' },
    });

    await client.get('/data');
    const call = transport.calls[0];
    expect(call.options?.headers?.['Accept']).toBe('application/json');
    expect(call.options?.headers?.['X-Api-Key']).toBe('key123');
  });

  it('リクエスト固有のヘッダーはデフォルトヘッダーを上書きする', async () => {
    const transport = mockTransport();
    const client = ApiClient.createClient({
      baseUrl: 'https://api.example.com',
      transport,
      headers: { 'X-Custom': 'default' },
    });

    await client.call({ method: 'GET', headers: { 'X-Custom': 'override' } });
    expect(transport.calls[0].options?.headers?.['X-Custom']).toBe('override');
  });
});
