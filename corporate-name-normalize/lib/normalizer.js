'use strict';

const { LEGAL_ENTITY_DEFINITIONS } = require('./corporateSuffixes');

// ── 1. 前処理 ──────────────────────────────────────────────────────────────

function preNormalize(name) {
  if (!name || typeof name !== 'string') return '';

  let s = name;
  s = s.normalize('NFKC');
  s = s.toUpperCase();
  // 全角スペース・不可視文字を含む空白を除去
  s = s.replace(/[\s　 ​﻿]+/g, '');
  // 全角括弧→半角（NKFCで変換されない環境の保険）
  s = s.replace(/（/g, '(').replace(/）/g, ')');
  // 中黒・ドット系統一
  s = s.replace(/[・･．。]/g, '.');

  return s;
}

// ── 2. エイリアスマップ構築 ─────────────────────────────────────────────────

function buildAliasMap() {
  const entries = [];

  for (const def of LEGAL_ENTITY_DEFINITIONS) {
    entries.push({ alias: def.canonical.toUpperCase(), canonical: def.canonical, kind: def.kind });
    for (const alias of def.aliases) {
      entries.push({ alias: alias.toUpperCase(), canonical: def.canonical, kind: def.kind });
    }
  }

  // 長いエイリアスを先にマッチさせる（greedy優先）
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
}

const ALIAS_ENTRIES = buildAliasMap();

// ── 3. 法人格の検出と除去 ───────────────────────────────────────────────────

function extractLegalEntity(normalizedName) {
  const upper = normalizedName;

  for (const entry of ALIAS_ENTRIES) {
    const alias = entry.alias;

    if (upper.startsWith(alias)) {
      const base = normalizedName.slice(alias.length);
      if (base.length > 0) {
        return { legalName: entry.canonical, baseName: base, kind: entry.kind, position: 'pre' };
      }
    }

    if (upper.endsWith(alias)) {
      const base = normalizedName.slice(0, normalizedName.length - alias.length);
      if (base.length > 0) {
        return { legalName: entry.canonical, baseName: base, kind: entry.kind, position: 'post' };
      }
    }
  }

  return { legalName: null, baseName: normalizedName, kind: null, position: 'none' };
}

// ── 4. 名寄せキー生成 ──────────────────────────────────────────────────────

function buildMatchKey(baseName) {
  return baseName.replace(/[.\-_,;:!?'"]/g, '');
}

// ── 5. メインAPI ───────────────────────────────────────────────────────────

/**
 * 法人名を正規化する
 * @param {string} rawName
 * @returns {{ raw, normalized, matchKey, baseName, legalName, legalPosition, kind }}
 */
function normalize(rawName) {
  const preNormed = preNormalize(rawName);
  const extracted = extractLegalEntity(preNormed);

  // 法人格を前置スタイルに統一して再組み立て
  const normalized = extracted.legalName
    ? extracted.legalName + extracted.baseName
    : preNormed;

  return {
    raw: rawName,
    normalized,
    matchKey: buildMatchKey(extracted.baseName),
    baseName: extracted.baseName,
    legalName: extracted.legalName,
    legalPosition: extracted.position,
    kind: extracted.kind,
  };
}

/**
 * 2つの法人名が同一企業を指すか判定する
 * @param {string} nameA
 * @param {string} nameB
 * @returns {{ isSame: boolean, confidence: string, detail: object }}
 */
function isSameCompany(nameA, nameB) {
  const a = normalize(nameA);
  const b = normalize(nameB);

  // レベル1: 正規化名が完全一致
  if (a.normalized === b.normalized) {
    return { isSame: true, confidence: 'exact', detail: { a, b } };
  }

  // レベル2: matchKey が一致（法人格の有無・記号差を吸収）
  if (a.matchKey && b.matchKey && a.matchKey === b.matchKey) {
    // 両方に法人格があり、かつ種別が異なる場合は別法人
    if (a.legalName && b.legalName && a.legalName !== b.legalName) {
      return { isSame: false, confidence: 'no_match', detail: { a, b } };
    }
    return { isSame: true, confidence: 'key_match', detail: { a, b } };
  }

  return { isSame: false, confidence: 'no_match', detail: { a, b } };
}

module.exports = { normalize, isSameCompany, preNormalize, extractLegalEntity };
