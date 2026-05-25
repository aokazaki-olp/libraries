#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { normalize } = require('../lib/normalizer');
const { toCommonForm } = require('../lib/kanjiNormalize');

const HEADERS = [
  'raw',
  'normalized_std',    // 標準字体（法人格前置統一・字体そのまま）
  'normalized_common', // 通用字体（旧字体・異体字を常用漢字に変換）
  'matchKey',
  'baseName',
  'legalName',
  'legalPosition',
  'kind',
];

function csvField(value) {
  const s = value == null ? '' : String(value);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

process.stdout.write(csvRow(HEADERS) + '\n');

rl.on('line', (line) => {
  const raw = line.trim();
  if (!raw) return;

  const r = normalize(raw);

  process.stdout.write(csvRow([
    r.raw,
    r.normalized,
    toCommonForm(r.normalized),
    r.matchKey,
    r.baseName,
    r.legalName,
    r.legalPosition,
    r.kind,
  ]) + '\n');
});
