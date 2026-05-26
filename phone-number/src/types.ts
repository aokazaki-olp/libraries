/**
 * types.ts
 * @description 公開型定義
 */

export type PhoneKind =
  | 'geographic'   // 0AB〜J 地域電気通信番号
  | 'mobile'       // 070/080/090 携帯電話
  | 'fmc'          // 060 固定移動融合（令和6年12月追加）
  | 'ip'           // 050 IP電話
  | 'm2m'          // 020 M2M専用
  | 'toll_free'    // 0120/0800 着信課金
  | 'universal'    // 0570 全国統一番号
  | 'premium'      // 0990 情報料代理徴収
  | 'voicemail'    // 0180 自動応答
  | 'emergency'    // 110/118/119 緊急通報
  | 'special';     // 104/113/115/116/117/171/177 その他特番

export type BillPayer = 'caller' | 'callee' | 'shared' | 'none';

export interface PhoneMeta {
  geographic:   boolean;
  billPayer:    BillPayer;
  emergencyOk:  boolean;
  intlDialable: boolean;
}

export interface PhoneParts {
  ndc:        string;
  subscriber: string;
}

export type NormalizeResult =
  | { valid: false; raw: string }
  | NormalizedPhone;

export interface NormalizedPhone {
  valid:    true;
  raw:      string;
  national: string;
  e164?:    string;
  kind:     PhoneKind;
  meta:     PhoneMeta;
  parts?:   PhoneParts;
  region?:  string;
}
