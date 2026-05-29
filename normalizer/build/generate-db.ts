/**
 * generate-db.ts
 * @description MJ縮退マップ JSON から character_variants.db を生成する
 *
 * 使用方法:
 *   tsx build/generate-db.ts [jsonPath]
 *   jsonPath 省略時: build/mj-source/MJShrinkMap.json
 *
 * データ取得先:
 *   https://moji.or.jp/mojikiban/map/
 *   「MJ縮退マップ」の JSON ファイルをダウンロードして build/mj-source/ に配置する
 *
 * MJShrinkMap.json の想定構造:
 *   [
 *     {
 *       "MJ番号": "MJ000001",
 *       "実装したUCS": "齋",       // 旧字体・異体字（variant）
 *       "縮退先": [
 *         {
 *           "UCS": "斎",           // 通用字体（canonical）
 *           "一意": true           // true のものを優先採用
 *         }
 *       ]
 *     },
 *     ...
 *   ]
 */

import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DEFAULT_JSON_PATH = join(__dirname, 'mj-source', 'MJShrinkMap.json');
const OUTPUT_DB_PATH = join(ROOT, 'data', 'character_variants.db');

// ────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────

interface ShrinkTarget {
  UCS: string;
  一意?: boolean;
  理由?: string;
}

interface MJEntry {
  MJ番号: string;
  実装したUCS?: string;
  縮退先?: ShrinkTarget[];
}

interface VariantRow {
  variant: string;
  canonical: string;
}

// ────────────────────────────────────────────────────
// パース
// ────────────────────────────────────────────────────

/**
 * U+XXXX 形式の文字列を実際の Unicode 文字に変換する
 * すでに文字の場合はそのまま返す
 */
const resolveUcs = (value: string): string => {
  const trimmed = value.trim();
  if (/^U\+[0-9A-Fa-f]{4,6}$/.test(trimmed)) {
    return String.fromCodePoint(parseInt(trimmed.slice(2), 16));
  }
  return trimmed;
};

/**
 * 私用領域 (Private Use Area) の文字を除外する
 * U+E000〜F8FF, U+F0000〜FFFFF, U+100000〜10FFFF
 */
const isPrivateUse = (char: string): boolean => {
  const cp = char.codePointAt(0) ?? 0;
  return (cp >= 0xE000 && cp <= 0xF8FF)
    || (cp >= 0xF0000 && cp <= 0xFFFFF)
    || (cp >= 0x100000 && cp <= 0x10FFFF);
};

/**
 * MJShrinkMap JSON からマッピング行を抽出する
 */
const extractRows = (entries: MJEntry[]): VariantRow[] => {
  const rows: VariantRow[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const variantRaw = entry['実装したUCS'];
    if (!variantRaw || !entry['縮退先']?.length) {
      continue;
    }

    const variant = resolveUcs(variantRaw);
    if (!variant || isPrivateUse(variant)) {
      continue;
    }

    // 一意フラグが true のものを優先、なければ先頭を採用
    const target = entry['縮退先'].find(t => t['一意'] === true)
      ?? entry['縮退先'][0];

    if (!target?.UCS) {
      continue;
    }

    const canonical = resolveUcs(target.UCS);
    if (!canonical || isPrivateUse(canonical)) {
      continue;
    }

    // 自己参照（variant === canonical）は除外
    if (variant === canonical) {
      continue;
    }

    if (!seen.has(variant)) {
      seen.add(variant);
      rows.push({ variant, canonical });
    }
  }

  return rows;
};

// ────────────────────────────────────────────────────
// DB 生成
// ────────────────────────────────────────────────────

const createDb = (rows: VariantRow[]): void => {
  const dataDir = dirname(OUTPUT_DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new DatabaseSync(OUTPUT_DB_PATH);

  db.exec(`
    DROP TABLE IF EXISTS character_variants;
    CREATE TABLE character_variants (
      variant   TEXT PRIMARY KEY,
      canonical TEXT NOT NULL,
      source    TEXT NOT NULL DEFAULT 'MJ'
    );
    CREATE INDEX idx_variant ON character_variants(variant);
  `);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO character_variants (variant, canonical) VALUES (?, ?)'
  );

  db.exec('BEGIN');
  for (const row of rows) {
    insert.run(row.variant, row.canonical);
  }
  db.exec('COMMIT');

  db.close();
};

// ────────────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const jsonPath = process.argv[2] ?? DEFAULT_JSON_PATH;

  if (!existsSync(jsonPath)) {
    console.error(`[ERROR] ファイルが見つかりません: ${jsonPath}`);
    console.error('MJ縮退マップ JSON を https://moji.or.jp/mojikiban/map/ からダウンロードして');
    console.error(`build/mj-source/ に配置してください`);
    process.exit(1);
  }

  console.log(`[INFO] 読み込み: ${jsonPath}`);
  const raw = await readFile(jsonPath, 'utf-8');

  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    console.error('[ERROR] JSON パース失敗:', e);
    process.exit(1);
  }

  if (!Array.isArray(entries)) {
    console.error('[ERROR] JSON の構造が想定と異なります（配列であることを期待）');
    console.error('実際の型:', typeof entries);
    process.exit(1);
  }

  const rows = extractRows(entries as MJEntry[]);
  console.log(`[INFO] 抽出: ${rows.length} 件のマッピング`);

  createDb(rows);
  console.log(`[INFO] 生成完了: ${OUTPUT_DB_PATH}`);
};

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});
