/**
 * number-plan.ts
 * @description 告示準拠の番号計画定義
 *
 * ソース: 電気通信番号に関する計画（令和元年総務省告示第6号、令和6年12月改正）
 * https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_plan.html
 */

import type { PhoneKind, PhoneMeta } from './types.js';

export interface PlanEntry {
  readonly kind: PhoneKind;
  readonly meta: Readonly<PhoneMeta>;
}

const GEO: Readonly<PhoneMeta> = {
  geographic: true,  billPayer: 'caller', emergencyOk: true,  intlDialable: true,
} as const;

const MOB: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'caller', emergencyOk: true,  intlDialable: true,
} as const;

const IP: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: true,
} as const;

const M2M: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: false,
} as const;

const TOLL_FREE: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'callee', emergencyOk: true,  intlDialable: false,
} as const;

const UNIVERSAL: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'shared', emergencyOk: true,  intlDialable: false,
} as const;

const PREMIUM: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: false,
} as const;

const VOICEMAIL: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'caller', emergencyOk: false, intlDialable: false,
} as const;

const EMERGENCY: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'none',   emergencyOk: false, intlDialable: false,
} as const;

const SPECIAL: Readonly<PhoneMeta> = {
  geographic: false, billPayer: 'none',   emergencyOk: false, intlDialable: false,
} as const;

export const GEOGRAPHIC_ENTRY: PlanEntry = { kind: 'geographic', meta: GEO };

// プレフィックス → PlanEntry。長いキーを先に並べること（classify で先頭から照合する）
export const PREFIX_MAP: ReadonlyMap<string, PlanEntry> = new Map<string, PlanEntry>([
  // 4桁プレフィックス（付加的役務）
  ['0120', { kind: 'toll_free', meta: TOLL_FREE }],
  ['0800', { kind: 'toll_free', meta: TOLL_FREE }],
  ['0570', { kind: 'universal', meta: UNIVERSAL }],
  ['0990', { kind: 'premium',   meta: PREMIUM   }],
  ['0180', { kind: 'voicemail', meta: VOICEMAIL }],
  // 3桁プレフィックス
  ['020', { kind: 'm2m',    meta: M2M }],
  ['050', { kind: 'ip',     meta: IP  }],
  ['060', { kind: 'fmc',    meta: MOB }],
  ['070', { kind: 'mobile', meta: MOB }],
  ['080', { kind: 'mobile', meta: MOB }],
  ['090', { kind: 'mobile', meta: MOB }],
  // 緊急通報（3桁・先頭0なし）
  ['110', { kind: 'emergency', meta: EMERGENCY }],
  ['118', { kind: 'emergency', meta: EMERGENCY }],
  ['119', { kind: 'emergency', meta: EMERGENCY }],
  // 特番（3桁・先頭0なし）
  ['104', { kind: 'special', meta: SPECIAL }],
  ['113', { kind: 'special', meta: SPECIAL }],
  ['115', { kind: 'special', meta: SPECIAL }],
  ['116', { kind: 'special', meta: SPECIAL }],
  ['117', { kind: 'special', meta: SPECIAL }],
  ['171', { kind: 'special', meta: SPECIAL }],
  ['177', { kind: 'special', meta: SPECIAL }],
]);
