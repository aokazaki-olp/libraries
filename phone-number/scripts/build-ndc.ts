/**
 * build-ndc.ts
 * @description 総務省「電気通信番号指定状況」Excel から src/data/ndc.ts を生成する
 *
 * 使い方: npm run build:dict
 * データ元: https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html
 */

import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = resolve(__dirname, '../src/data/ndc.ts');

const INDEX_URL = 'https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/number_shitei.html';
const BASE_URL  = 'https://www.soumu.go.jp';

interface NdcEntry {
  region:   string;
  localLen: number;
}

// 列カテゴリ
type ColCategory = 'ndc' | 'full' | 'local' | 'region';

interface ColIndices {
  ndc:    number;
  full:   number;  // 番号列（市外+市内、0なし）。-1 の場合は local を使う
  local:  number;  // 市内局番列。-1 の場合は full を使う
  region: number;
}

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
};

const fetchBuffer = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.arrayBuffer();
};

// 固定電話セクションの Excel リンクを抽出する
const extractExcelLinks = (html: string): string[] => {
  const links: string[] = [];
  const re = /href="([^"]*\/main_content\/[^"]*\.xlsx?)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    links.push(href.startsWith('http') ? href : BASE_URL + href);
  }
  return [...new Set(links)];
};

// 全角英数字を半角に、空白類を除去して正規化する
const normalizeLabel = (s: string): string =>
  s
    .replace(/[　\s]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

// セルテキストから列カテゴリを推定する
const detectCategory = (label: string): ColCategory | null => {
  const n = normalizeLabel(label);
  // 市外局番: 先頭一致。「市外局番（0AB～J）」等の括弧付きも含む
  if (/^市外局番/.test(n))                        return 'ndc';
  // 全番号: 市外+市内を連結した番号列
  if (/^番号$|^指定番号|^番号（市外局番/.test(n)) return 'full';
  // 市内局番単独列
  if (/^市内局番/.test(n))                        return 'local';
  // 地域名: MA / MA名 / 市外MA名 / 地域名
  if (/^MA$|^MA名|^市外MA|^地域名|^エリア名/.test(n)) return 'region';
  return null;
};

/**
 * シートのヘッダー行と列インデックスを検出する
 * 先頭 10 行をスキャンし、ndc + (full|local) + region がそろった行をヘッダーと判定する
 */
const detectHeader = (
  rows: unknown[][],
): { headerIdx: number; cols: ColIndices } | null => {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    let ndcCol = -1, fullCol = -1, localCol = -1, regionCol = -1;

    for (let j = 0; j < row.length; j++) {
      const label = String(row[j] ?? '');
      const cat   = detectCategory(label);
      if (cat === 'ndc'    && ndcCol    < 0) ndcCol    = j;
      if (cat === 'full'   && fullCol   < 0) fullCol   = j;
      if (cat === 'local'  && localCol  < 0) localCol  = j;
      if (cat === 'region' && regionCol < 0) regionCol = j;
    }

    const hasFullInfo = fullCol >= 0 || localCol >= 0;
    if (ndcCol >= 0 && hasFullInfo && regionCol >= 0) {
      return {
        headerIdx: i,
        cols: { ndc: ndcCol, full: fullCol, local: localCol, region: regionCol },
      };
    }
  }
  return null;
};

// 1シート分のデータを解析する
const parseSheet = (ws: XLSX.WorkSheet): Map<string, NdcEntry> => {
  const result = new Map<string, NdcEntry>();
  const rows   = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

  const header = detectHeader(rows);
  if (!header) return result; // ヘッダー不明のシートはスキップ

  const { headerIdx, cols } = header;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    const rawNdc    = String(row[cols.ndc]    ?? '').replace(/[^\d]/g, '');
    const rawFull   = cols.full  >= 0 ? String(row[cols.full]  ?? '').replace(/[^\d]/g, '') : '';
    const rawLocal  = cols.local >= 0 ? String(row[cols.local] ?? '').replace(/[^\d]/g, '') : '';
    const region    = String(row[cols.region] ?? '').replace(/[　\s]/g, '');

    if (!rawNdc || !region) continue;

    // 先頭0: 列によって含む場合と含まない場合がある
    const ndc = rawNdc.startsWith('0') ? rawNdc : '0' + rawNdc;

    let localLen: number;
    if (rawFull) {
      // 番号列から: len("0"+番号) - len(ndc)
      const full = rawFull.startsWith('0') ? rawFull : '0' + rawFull;
      localLen = full.length - ndc.length;
    } else if (rawLocal) {
      // 市内局番列から: そのまま桁数
      localLen = rawLocal.length;
    } else {
      continue;
    }

    if (localLen <= 0 || localLen > 4) continue;
    if (result.has(ndc)) continue; // 先頭エントリ優先

    result.set(ndc, { region, localLen });
  }

  return result;
};

// Excel バッファから市外局番エントリを抽出する（全シート対象）
const parseExcel = (buf: ArrayBuffer): Map<string, NdcEntry> => {
  const wb     = XLSX.read(buf, { type: 'array' });
  const result = new Map<string, NdcEntry>();

  for (const sheetName of wb.SheetNames) {
    const entries = parseSheet(wb.Sheets[sheetName]);
    for (const [ndc, entry] of entries) {
      if (!result.has(ndc)) result.set(ndc, entry);
    }
  }

  return result;
};

const buildTimestamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const renderTs = (entries: Map<string, NdcEntry>, timestamp: string): string => {
  const lines = [...entries.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ndc, e]) => `  '${ndc}': { region: '${e.region.replace(/'/g, "\\'")}', localLen: ${e.localLen} },`);

  return [
    `/**`,
    ` * ndc.ts`,
    ` * @description 市外局番 → 地域情報マッピング（総務省「電気通信番号指定状況」より自動生成）`,
    ` *`,
    ` * 生成日: ${timestamp}`,
    ` * 再生成: npm run build:dict`,
    ` */`,
    ``,
    `export interface NdcEntry {`,
    `  region:   string;`,
    `  localLen: number;`,
    `}`,
    ``,
    `export const NDC_MAP: Readonly<Record<string, NdcEntry>> = {`,
    ...lines,
    `} as const;`,
    ``,
  ].join('\n');
};

const main = async (): Promise<void> => {
  console.log('[build-ndc] インデックスページを取得中...');
  const html  = await fetchText(INDEX_URL);
  const links = extractExcelLinks(html);

  if (links.length === 0) {
    throw new Error('固定電話 Excel リンクが見つかりませんでした。ページ構造が変わった可能性があります。');
  }
  console.log(`[build-ndc] ${links.length} 件の Excel リンクを検出`);

  const all = new Map<string, NdcEntry>();

  for (const link of links) {
    console.log(`[build-ndc] ダウンロード: ${link}`);
    const buf     = await fetchBuffer(link);
    const entries = parseExcel(buf);
    for (const [ndc, entry] of entries) {
      if (!all.has(ndc)) all.set(ndc, entry);
    }
    console.log(`[build-ndc]   → ${entries.size} 件 (累計 ${all.size} 件)`);
  }

  console.log(`[build-ndc] 合計 ${all.size} 件の市外局番を取得`);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, renderTs(all, buildTimestamp()), 'utf-8');
  console.log(`[build-ndc] 書き出し完了: ${OUT_PATH}`);
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
