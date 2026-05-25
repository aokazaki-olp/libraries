#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import type { HoujinSearcher } from '../lib/houjinSearch.js';

const require = createRequire(import.meta.url);

type NormalizeResult = {
  raw: string;
  normalized: string;
  matchKey: string;
  baseName: string;
  legalName: string | null;
  legalPosition: string;
  kind: string | null;
};

const { normalize } = require('../lib/normalizer.js') as { normalize: (name: string) => NormalizeResult };
const { toCommonForm } = require('../lib/kanjiNormalize.js') as { toCommonForm: (name: string) => string };

// ── CSV ユーティリティ ─────────────────────────────────────────────────────

function csvField(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function csvRow(fields: (string | null | undefined)[]): string {
  return fields.map(csvField).join(',');
}

// ── readline を Promise化 ──────────────────────────────────────────────────

async function readLines(): Promise<string[]> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) {
    const raw = line.trim();
    if (raw) lines.push(raw);
  }
  return lines;
}

// ── メイン ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // gBizINFO 検索（GBIZINFO_TOKEN が設定されている場合のみ有効）
  let searcher: HoujinSearcher | null = null;
  const token = process.env.GBIZINFO_TOKEN;
  if (token) {
    const { createSearcher } = await import('../lib/houjinSearch.js');
    searcher = createSearcher(token);
  }

  const HEADERS_BASE = ['raw', 'normalized_std', 'normalized_common', 'matchKey', 'baseName', 'legalName', 'legalPosition', 'kind'];
  const HEADERS = searcher
    ? [...HEADERS_BASE, 'gbiz_corporate_number', 'gbiz_name', 'gbiz_furigana']
    : HEADERS_BASE;

  const lines = await readLines();

  process.stdout.write(csvRow(HEADERS) + '\n');

  // gBizINFO API のレート制限に配慮して並列数を制限
  const CONCURRENCY = 3;
  for (let i = 0; i < lines.length; i += CONCURRENCY) {
    const batch = lines.slice(i, i + CONCURRENCY);

    const rows = await Promise.all(batch.map(async (raw) => {
      const r = normalize(raw);
      const fields: (string | null | undefined)[] = [
        r.raw,
        r.normalized,
        toCommonForm(r.normalized),
        r.matchKey,
        r.baseName,
        r.legalName,
        r.legalPosition,
        r.kind,
      ];

      if (searcher) {
        try {
          const hits = await searcher.byName(r.baseName, 1);
          const hit = hits[0] ?? null;
          fields.push(hit?.corporate_number, hit?.name, hit?.furigana);
        } catch {
          fields.push(undefined, undefined, undefined);
        }
      }

      return fields;
    }));

    for (const row of rows) {
      process.stdout.write(csvRow(row) + '\n');
    }
  }
}

main().catch(err => {
  process.stderr.write((err as Error).message + '\n');
  process.exit(1);
});
