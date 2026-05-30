#!/usr/bin/env node
/**
 * normalize-csv.ts
 * CSV内の名前・ふりがな列を正規化し、NormalizeResult の全フィールドを右側に追加して出力する
 *
 * 使い方:
 *   npx tsx src/normalize-csv.ts [オプション] [input.csv]
 *   cat input.csv | npx tsx src/normalize-csv.ts [オプション]
 *
 * オプション:
 *   --name <col>    名前列（ヘッダー名 or 0始まりインデックス、デフォルト: 最右列）
 *   --kana <col>    ふりがな列（ヘッダー名 or 0始まりインデックス、省略可）
 *   -o <file>       出力先ファイル（省略時: stdout）
 *   --db <path>     character_variants.db の絶対パス
 *   --no-header     ヘッダー行なし
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { Normalizer } from '../../normalizer/src/normalize.js';
import type { NormalizeResult } from '../../normalizer/src/types.js';

// ────────────────────────────────────────────────────
// 引数パース
// ────────────────────────────────────────────────────

interface CliArgs {
  inputFile?: string;
  nameCol?: string;
  kanaCol?: string;
  outputFile?: string;
  dbPath?: string;
  noHeader: boolean;
}

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = { noHeader: false };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if ((arg === '--name' || arg === '--kana' || arg === '-o' || arg === '--db') && i + 1 < argv.length) {
      const val = argv[++i];
      if (arg === '--name') args.nameCol = val;
      else if (arg === '--kana') args.kanaCol = val;
      else if (arg === '-o') args.outputFile = val;
      else args.dbPath = val;
    } else if (arg === '--no-header') {
      args.noHeader = true;
    } else if (!arg.startsWith('-')) {
      args.inputFile = arg;
    }
    i++;
  }
  return args;
};

// ────────────────────────────────────────────────────
// 列解決
// ────────────────────────────────────────────────────

const resolveColIndex = (spec: string, headers: string[]): number => {
  const n = Number(spec);
  if (!isNaN(n) && Number.isInteger(n)) {
    if (n < 0 || n >= headers.length) {
      throw new Error(`列インデックス ${n} が範囲外です（列数: ${headers.length}）`);
    }
    return n;
  }
  const idx = headers.indexOf(spec);
  if (idx === -1) {
    throw new Error(`列 "${spec}" が見つかりません`);
  }
  return idx;
};

// ────────────────────────────────────────────────────
// NormalizeResult → 配列変換
// ────────────────────────────────────────────────────

const NORM_FIELDS_BASE = [
  'norm.raw', 'norm.canonical', 'norm.name', 'norm.legalName',
  'norm.legalPosition', 'norm.kind', 'norm.matchKey', 'norm.matchKeyKanji', 'norm.ambiguous',
] as const;

const NORM_FIELDS_KANA = ['norm.kana', 'norm.kanaMatchKey'] as const;

const resultToValues = (r: NormalizeResult, withKana: boolean): string[] => {
  const values = [
    r.raw,
    r.canonical,
    r.name,
    r.legalName ?? '',
    r.legalPosition ?? '',
    r.kind ?? '',
    r.matchKey,
    r.matchKeyKanji,
    String(r.ambiguous),
  ];
  if (withKana) {
    values.push(r.kana ?? '', r.kanaMatchKey ?? '');
  }
  return values;
};

// ────────────────────────────────────────────────────
// メイン
// ────────────────────────────────────────────────────

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  const input = args.inputFile
    ? readFileSync(args.inputFile, 'utf8')
    : readFileSync('/dev/stdin', 'utf8');

  const rows: string[][] = parse(input, { relax_column_count: true });

  if (rows.length === 0) return;

  const hasHeader = !args.noHeader;
  const headerRow = hasHeader ? rows[0] : null;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  // 列インデックス解決用のヘッダー（--no-header 時は "0","1",... で代替）
  const colHeaders = headerRow ?? rows[0].map((_, i) => String(i));

  const nameColIdx = args.nameCol !== undefined
    ? resolveColIndex(args.nameCol, colHeaders)
    : colHeaders.length - 1;

  const kanaColIdx = args.kanaCol !== undefined
    ? resolveColIndex(args.kanaCol, colHeaders)
    : undefined;

  const withKana = kanaColIdx !== undefined;

  const normalizer = Normalizer.create({ dbPath: args.dbPath });

  const outputRows: string[][] = [];

  if (hasHeader && headerRow !== null) {
    const normHeaders = withKana
      ? [...NORM_FIELDS_BASE, ...NORM_FIELDS_KANA]
      : [...NORM_FIELDS_BASE];
    outputRows.push([...headerRow, ...normHeaders]);
  }

  for (const row of dataRows) {
    const nameVal = row[nameColIdx] ?? '';
    const kanaVal = withKana ? (row[kanaColIdx!] ?? '') : undefined;

    const result = normalizer.normalize(
      kanaVal !== undefined ? { name: nameVal, kana: kanaVal } : { name: nameVal },
    );

    outputRows.push([...row, ...resultToValues(result, withKana)]);
  }

  const output = stringify(outputRows);

  if (args.outputFile !== undefined) {
    writeFileSync(args.outputFile, output, 'utf8');
  } else {
    process.stdout.write(output);
  }
};

main();
