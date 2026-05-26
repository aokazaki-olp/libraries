/**
 * ndc.ts
 * @description 市外局番 → 地域情報マッピング（総務省「電気通信番号指定状況」より）
 *
 * 完全版は `npm run build:dict` で scripts/build-ndc.ts から再生成できます。
 * このファイルは主要局番のみ収録しています。未収録の局番は parts/region が undefined になります。
 */

export interface NdcEntry {
  region:   string;
  localLen: number;
}

// キー: 先頭0を含む市外局番（例: "03", "045", "0138"）
export const NDC_MAP: Readonly<Record<string, NdcEntry>> = {
  // 2桁 (localLen: 4)
  '03':   { region: '東京都',                                    localLen: 4 },
  '06':   { region: '大阪府（大阪市等）',                         localLen: 4 },
  // 3桁 — 北海道・東北 (localLen: 3)
  '011':  { region: '北海道（札幌市）',                           localLen: 3 },
  '017':  { region: '青森県（青森市）',                           localLen: 3 },
  '018':  { region: '秋田県（秋田市）',                           localLen: 3 },
  '019':  { region: '岩手県（盛岡市）',                           localLen: 3 },
  '022':  { region: '宮城県（仙台市）',                           localLen: 3 },
  '023':  { region: '山形県（山形市）',                           localLen: 3 },
  '024':  { region: '福島県（郡山市等）',                         localLen: 3 },
  // 3桁 — 関東・甲信越 (localLen: 3)
  '025':  { region: '新潟県（新潟市）',                           localLen: 3 },
  '026':  { region: '長野県（長野市）',                           localLen: 3 },
  '027':  { region: '群馬県（前橋市・高崎市）',                   localLen: 3 },
  '028':  { region: '栃木県（宇都宮市）',                         localLen: 3 },
  '029':  { region: '茨城県（水戸市）',                           localLen: 3 },
  '042':  { region: '東京都（多摩地区）',                         localLen: 3 },
  '043':  { region: '千葉県（千葉市）',                           localLen: 3 },
  '044':  { region: '神奈川県（川崎市）',                         localLen: 3 },
  '045':  { region: '神奈川県（横浜市）',                         localLen: 3 },
  '046':  { region: '神奈川県（小田原市・厚木市等）',             localLen: 3 },
  '047':  { region: '千葉県（船橋市等）',                         localLen: 3 },
  '048':  { region: '埼玉県（さいたま市）',                       localLen: 3 },
  '049':  { region: '埼玉県（川越市等）',                         localLen: 3 },
  // 3桁 — 東海・北陸 (localLen: 3)
  '052':  { region: '愛知県（名古屋市）',                         localLen: 3 },
  '053':  { region: '静岡県（浜松市）',                           localLen: 3 },
  '054':  { region: '静岡県（静岡市）',                           localLen: 3 },
  '055':  { region: '山梨県（甲府市等）',                         localLen: 3 },
  '058':  { region: '岐阜県（岐阜市）',                           localLen: 3 },
  '059':  { region: '三重県（津市）',                             localLen: 3 },
  '076':  { region: '石川県（金沢市）',                           localLen: 3 },
  '077':  { region: '滋賀県（大津市）',                           localLen: 3 },
  // 3桁 — 近畿 (localLen: 3)
  '072':  { region: '大阪府（北摂・北河内等）',                   localLen: 3 },
  '073':  { region: '和歌山県（和歌山市）',                       localLen: 3 },
  '075':  { region: '京都府（京都市）',                           localLen: 3 },
  '078':  { region: '兵庫県（神戸市）',                           localLen: 3 },
  '079':  { region: '兵庫県（姫路市等）',                         localLen: 3 },
  // 3桁 — 中国・四国 (localLen: 3)
  '082':  { region: '広島県（広島市）',                           localLen: 3 },
  '083':  { region: '山口県（山口市）',                           localLen: 3 },
  '084':  { region: '広島県（福山市）',                           localLen: 3 },
  '086':  { region: '岡山県（岡山市）',                           localLen: 3 },
  '087':  { region: '香川県（高松市）',                           localLen: 3 },
  '088':  { region: '徳島県（徳島市）・高知県（高知市）',         localLen: 3 },
  '089':  { region: '愛媛県（松山市）',                           localLen: 3 },
  // 3桁 — 九州・沖縄 (localLen: 3)
  '092':  { region: '福岡県（福岡市）',                           localLen: 3 },
  '093':  { region: '福岡県（北九州市）',                         localLen: 3 },
  '095':  { region: '長崎県（長崎市）',                           localLen: 3 },
  '096':  { region: '熊本県（熊本市）',                           localLen: 3 },
  '097':  { region: '大分県（大分市）',                           localLen: 3 },
  '098':  { region: '沖縄県（那覇市等）',                         localLen: 3 },
  '099':  { region: '鹿児島県（鹿児島市）',                       localLen: 3 },
  // 4桁 — 北海道（主要都市）(localLen: 2)
  '0138': { region: '北海道（函館市）',                           localLen: 2 },
  '0143': { region: '北海道（室蘭市）',                           localLen: 2 },
  '0144': { region: '北海道（苫小牧市）',                         localLen: 2 },
  '0154': { region: '北海道（釧路市）',                           localLen: 2 },
  '0155': { region: '北海道（帯広市）',                           localLen: 2 },
  '0157': { region: '北海道（北見市）',                           localLen: 2 },
  '0162': { region: '北海道（稚内市）',                           localLen: 2 },
  '0166': { region: '北海道（旭川市）',                           localLen: 2 },
  // 4桁 — 東北（主要都市）(localLen: 2)
  '0172': { region: '青森県（弘前市）',                           localLen: 2 },
  '0176': { region: '青森県（八戸市）',                           localLen: 2 },
  '0191': { region: '岩手県（一関市）',                           localLen: 2 },
  '0193': { region: '岩手県（釜石市）',                           localLen: 2 },
  '0197': { region: '岩手県（奥州市）',                           localLen: 2 },
  '0225': { region: '宮城県（石巻市）',                           localLen: 2 },
  '0229': { region: '宮城県（大崎市）',                           localLen: 2 },
} as const;
