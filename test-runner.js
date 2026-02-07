'use strict';

/**
 * test-runner.js
 *
 * Node.js環境でGASテストを実行するためのモック・ランナー
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
const Logger = {
  log: (...args) => console.log('[Logger]', ...args)
};

// ============================================================================
// コンテキスト作成
// ============================================================================

const context = {
  console,
  UrlFetchApp,
  Utilities,
  Logger,
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
  RegExp,
  Map,
  parseInt,
  encodeURIComponent,
  decodeURIComponent
};

vm.createContext(context);

// ============================================================================
// ソースファイル読み込み
// ============================================================================

const loadAndRun = (filename) => {
  const filepath = path.join(__dirname, filename);
  const content = fs.readFileSync(filepath, 'utf8');
  // 'use strict' を除去
  const code = content.replace(/^'use strict';\s*/m, '');
  vm.runInContext(code, context, { filename });
};

// 依存順に読み込み
loadAndRun('LoggerFacade.gs');
loadAndRun('HttpClient.gs');
loadAndRun('SlackClient.gs');
loadAndRun('HttpClient.test.gs');
loadAndRun('SlackClient.test.gs');

// ============================================================================
// テスト実行
// ============================================================================

console.log('='.repeat(60));
console.log('HttpClient Tests');
console.log('='.repeat(60));

const httpResults = vm.runInContext('runUnitTestsOnly()', context);

console.log('\n');
console.log('='.repeat(60));
console.log('SlackClient Tests');
console.log('='.repeat(60));

const slackResults = vm.runInContext('runAllSlackClientTests()', context);

// ============================================================================
// 結果サマリー
// ============================================================================

console.log('\n');
console.log('='.repeat(60));
console.log('OVERALL SUMMARY');
console.log('='.repeat(60));

const totalPassed = httpResults.passed + slackResults.passed;
const totalFailed = httpResults.failed + slackResults.failed;
const totalTests = httpResults.total + slackResults.total;

console.log(`HttpClient:  ${httpResults.passed}/${httpResults.total} passed`);
console.log(`SlackClient: ${slackResults.passed}/${slackResults.total} passed`);
console.log('-'.repeat(40));
console.log(`TOTAL:       ${totalPassed}/${totalTests} passed`);

if (totalFailed > 0) {
  console.log(`\n${totalFailed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll tests PASSED!');
  process.exit(0);
}
