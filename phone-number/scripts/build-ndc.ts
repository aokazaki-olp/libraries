/**
 * build-ndc.ts
 * @description 総務省「市外局番の一覧」Word ファイルから src/data/ndc.ts を生成する
 *
 * 使い方:
 *   1. 総務省サイトから最新の Word ファイルをダウンロードして data/raw/shigai_list.docx に配置
 *      https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/shigai_list.html
 *   2. npm run build:dict
 */

import mammoth from 'mammoth';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_PATH = resolve(__dirname, '../data/raw/shigai_list.docx');
const OUT_PATH = resolve(__dirname, '../src/data/ndc.ts');

// Word 表から市外局番と地域名を抽出する
// 総務省 Word 表の列構造: [番号区画コード, 市外局番, 地域名, 市内局番構成]
const extractNdcEntries = (html: string): Map<string, string> => {
  const result = new Map<string, string>();

  // <tr>...</tr> を順に取り出す
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    // <td> または <th> の内容テキストを抽出
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').trim());

    if (cells.length < 3) {
      continue;
    }

    // 2列目: 市外局番（数字のみ）, 3列目: 地域名
    const rawNdc  = cells[1].replace(/[^\d]/g, '');
    const region  = cells[2].replace(/\s+/g, '');

    if (!rawNdc || !/^\d{1,4}$/.test(rawNdc) || !region) {
      continue;
    }

    // 先頭0を付けて正規化（例: "3" → "03", "45" → "045"）
    const ndc = '0' + rawNdc;
    result.set(ndc, region);
  }

  return result;
};

const buildTimestamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const renderTs = (entries: Map<string, string>, timestamp: string): string => {
  const lines = [...entries.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ndc, region]) => `  '${ndc}': '${region.replace(/'/g, "\\'")}',`);

  return [
    `/**`,
    ` * ndc.ts`,
    ` * @description 市外局番 → 地域名マッピング（総務省「市外局番の一覧」より）`,
    ` *`,
    ` * 生成日: ${timestamp}`,
    ` * 再生成: npm run build:dict`,
    ` */`,
    ``,
    `export const NDC_MAP: Readonly<Record<string, string>> = {`,
    ...lines,
    `} as const;`,
    ``,
  ].join('\n');
};

const main = async (): Promise<void> => {
  let rawDocx: Buffer;
  try {
    rawDocx = await readFile(RAW_PATH);
  } catch {
    console.error(`[build-ndc] Word ファイルが見つかりません: ${RAW_PATH}`);
    console.error('総務省サイトからダウンロードして data/raw/shigai_list.docx に配置してください。');
    console.error('https://www.soumu.go.jp/main_sosiki/joho_tsusin/top/tel_number/shigai_list.html');
    process.exit(1);
  }

  console.log('[build-ndc] Word ファイルを変換中...');
  const { value: html } = await mammoth.convertToHtml({ buffer: rawDocx });

  const entries = extractNdcEntries(html);
  console.log(`[build-ndc] ${entries.size} 件の市外局番を抽出しました`);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, renderTs(entries, buildTimestamp()), 'utf-8');
  console.log(`[build-ndc] 書き出し完了: ${OUT_PATH}`);
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
