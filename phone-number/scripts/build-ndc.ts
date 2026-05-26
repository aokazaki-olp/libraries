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

// Excel バッファから市外局番エントリを抽出する
// 列: 市外局番（NDC の0なし）, 番号（NDC+市内局番の0なし）, MA（地域名）
const parseExcel = (buf: ArrayBuffer): Map<string, NdcEntry> => {
  const wb     = XLSX.read(buf, { type: 'array' });
  const result = new Map<string, NdcEntry>();

  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    for (const row of rows) {
      const rawNdc  = String(row['市外局番'] ?? '').replace(/[^\d]/g, '');
      const rawFull = String(row['番号']     ?? '').replace(/[^\d]/g, '');
      const region  = String(row['MA']       ?? '').trim();

      if (!rawNdc || !rawFull || !region) continue;

      const ndc      = '0' + rawNdc;
      const fullCode = '0' + rawFull;
      const localLen = fullCode.length - ndc.length;

      if (localLen <= 0 || localLen > 4) continue;
      if (result.has(ndc)) continue; // 先頭エントリ優先

      result.set(ndc, { region, localLen });
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
