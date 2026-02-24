'use strict';

/**
 * test-runner.js
 *
 * Node.js環境でGASテストを実行するためのモック・ランナー
 *
 * 実行方法:
 *   node test-runner.js
 *
 * 対象テストスイート:
 *   - HttpClient (HttpCore / ApiClient / WebhookClient)
 *   - SlackClient (SlackCore / SlackApiClient / SlackWebhookClient)
 *   - LoggerFacade
 *   - LazyTemplate
 *   - SlackFilters
 *   - resolveSheet
 *   - loadFromSheetAsObjects
 *   - GoogleSearchConsoleApiClient
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ============================================================================
// GAS API モック
// ============================================================================

// UrlFetchApp モック（実際には使用されない - MockTransportで置換）
const UrlFetchApp = {
  fetch: (url, options) => {
    throw new Error('UrlFetchApp.fetch should be mocked');
  }
};

// Utilities モック
const Utilities = {
  sleep: (ms) => {
    // テスト時は実際にはスリープしない（高速化のため）
  }
};

// Logger モック
const GasLogger = {
  log: (...args) => console.log('[Logger]', ...args)
};

// SpreadsheetApp スタブ（テスト側の MockGasSheet.setup() でオーバーライドされる）
const SpreadsheetApp = {
  openByUrl: () => { throw new Error('SpreadsheetApp.openByUrl should be mocked'); },
  openById: () => { throw new Error('SpreadsheetApp.openById should be mocked'); },
  getActiveSpreadsheet: () => { throw new Error('SpreadsheetApp.getActiveSpreadsheet should be mocked'); }
};

// ScriptApp スタブ（テスト側の MockScriptApp.setup() でオーバーライドされる）
const ScriptApp = {
  getOAuthToken: () => { throw new Error('ScriptApp.getOAuthToken should be mocked'); }
};

// ============================================================================
// コンテキスト作成
// ============================================================================

const context = {
  console,
  UrlFetchApp,
  Utilities,
  Logger: GasLogger,
  SpreadsheetApp,
  ScriptApp,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Math,
  Error,
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  RegExp,
  Map,
  Set,
  WeakMap,
  Symbol,
  Promise,
  Proxy,
  Reflect,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  Infinity,
  NaN,
  undefined,
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  decodeURI
};

// globalThis を自己参照にする
context.globalThis = context;

vm.createContext(context);

// ============================================================================
// ソースファイル読み込み
// ============================================================================

const loadAndRun = (filename) => {
  const filepath = path.join(__dirname, filename);
  const content = fs.readFileSync(filepath, 'utf8');
  // 'use strict' を除去（vm.createContext のコンテキストでは不要）
  const code = content.replace(/^'use strict';\s*/m, '');
  vm.runInContext(code, context, { filename });
};

// ソースファイル（依存順に読み込み）
loadAndRun('LoggerFacade.gs');
loadAndRun('HttpClient.gs');
loadAndRun('SlackClient.gs');
loadAndRun('SlackResolvers.gs');
loadAndRun('LazyTemplate.gs');
loadAndRun('SlackFilters.gs');
loadAndRun('resolveSheet.gs');
loadAndRun('loadAsObjects.gs');
loadAndRun('GoogleSearchConsoleApiClient.gs');

// テストファイル（依存順に読み込み）
// HttpClient.test.gs 内でグローバルな TestRunner, MockTransport などが定義される
loadAndRun('HttpClient.test.gs');
loadAndRun('SlackClient.test.gs');
loadAndRun('LoggerFacade.test.gs');
loadAndRun('SlackResolvers.test.gs');
loadAndRun('LazyTemplate.test.gs');
loadAndRun('SlackFilters.test.gs');
loadAndRun('resolveSheet.test.gs');
loadAndRun('loadAsObjects.test.gs');
loadAndRun('GoogleSearchConsoleApiClient.test.gs');

// ============================================================================
// テスト実行
// ============================================================================

const suites = [
  { name: 'HttpClient', fn: 'runUnitTestsOnly()' },
  { name: 'SlackClient', fn: 'runAllSlackClientTests()' },
  { name: 'SlackResolvers', fn: 'runAllSlackResolversTests()' },
  { name: 'LoggerFacade', fn: 'runAllLoggerFacadeTests()' },
  { name: 'LazyTemplate', fn: 'runAllLazyTemplateTests()' },
  { name: 'SlackFilters', fn: 'runAllSlackFiltersTests()' },
  { name: 'resolveSheet', fn: 'runAllResolveSheetTests()' },
  { name: 'loadAsObjects', fn: 'runAllLoadAsObjectsTests()' },
  { name: 'GoogleSearchConsoleApiClient', fn: 'runAllGscTests()' }
];

const allResults = [];

for (const suite of suites) {
  console.log('\n' + '='.repeat(60));
  console.log(`${suite.name} Tests`);
  console.log('='.repeat(60));

  const result = vm.runInContext(suite.fn, context);
  allResults.push({ name: suite.name, ...result });
}

// ============================================================================
// 結果サマリー
// ============================================================================

console.log('\n\n' + '='.repeat(60));
console.log('OVERALL SUMMARY');
console.log('='.repeat(60));

let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

const nameWidth = Math.max(...allResults.map(r => r.name.length));

for (const r of allResults) {
  const status = r.failed > 0 ? 'FAIL' : 'PASS';
  console.log(`  ${r.name.padEnd(nameWidth)}  ${r.passed}/${r.total} passed  [${status}]`);
  totalPassed += r.passed;
  totalFailed += r.failed;
  totalTests += r.total;
}

console.log('-'.repeat(60));
console.log(`  ${'TOTAL'.padEnd(nameWidth)}  ${totalPassed}/${totalTests} passed`);

if (totalFailed > 0) {
  console.log(`\n${totalFailed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll tests PASSED!');
  process.exit(0);
}
