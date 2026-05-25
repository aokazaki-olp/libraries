import { GBizInfoApiClient } from '../../nodejs/src/GBizInfoApiClient.js';

export interface HoujinInfo {
  corporate_number: string;
  name: string;
  furigana?: string;
  en_name?: string;
  prefecture_name?: string;
  city_name?: string;
  street_number?: string;
}

type HojinResponse = { 'hojin-infos'?: HoujinInfo[] };

/**
 * gBizINFO API を使った法人名検索クライアントを作成する
 *
 * @param token gBizINFO API トークン
 *              https://info.gbiz.go.jp/hojin/api/overview からアプリ登録して取得
 */
export function createSearcher(token: string) {
  const client = GBizInfoApiClient.create<HojinResponse>(token);

  return {
    /** 法人名（本体名）で検索して候補を返す */
    async byName(name: string, limit = 5): Promise<HoujinInfo[]> {
      const res = await client.get('/hojin', { name, limit });
      return res?.['hojin-infos'] ?? [];
    },

    /** 法人番号で1件照会する */
    async byNumber(corporateNumber: string): Promise<HoujinInfo | null> {
      const res = await client.get(`/hojin/${corporateNumber}`);
      return res?.['hojin-infos']?.[0] ?? null;
    },
  };
}

export type HoujinSearcher = ReturnType<typeof createSearcher>;
