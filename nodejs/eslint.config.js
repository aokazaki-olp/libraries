// CODING_RULES.md §8.1 の lint 要求を満たす設定。
// 要求を変えたら §8.3 の手順（違反コードを1件書いて落ちることを確かめる）をやり直す。

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts', '**/*.mts'];
const JS_FILES = ['**/*.js', '**/*.mjs'];
const TEST_FILES = ['tests/**/*.test.ts', 'tests/**/*.test.mts', 'tests/**/helpers.ts'];

// 相対パスで .js / .mjs を指す import（§2.2。コンパイラは .ts へ写像して通してしまう）
const RELATIVE_JS = String.raw`/^\.{1,2}\/.*\.m?js$/`;

// 構文で禁じるもの。テストでも外さない（§7.1 実行可能性のガード）
const RESTRICTED_SYNTAX = [
  { selector: 'Decorator', message: 'デコレータ構文は Node で実行できない（§4.8）' },
  { selector: 'AccessorProperty', message: 'accessor フィールドは Node で実行できない（§4.8）' },
  {
    selector: 'TSAbstractAccessorProperty',
    message: 'accessor フィールドは Node で実行できない（§4.8）',
  },
  {
    selector: "CallExpression[callee.property.name='forEach']",
    message: 'forEach は禁止。for...of を使う（§5.1）',
  },
  {
    selector: "CallExpression[callee.property.name='then']",
    message: '.then() チェーンは禁止。async / await を使う（§5.3）',
  },
];

const RESTRICTED_RELATIVE_JS = [
  {
    selector: `ImportDeclaration[source.value=${RELATIVE_JS}]`,
    message: '相対 import は実ファイルの拡張子（.ts）で書く（§2.2）',
  },
  {
    selector: `ExportNamedDeclaration[source.value=${RELATIVE_JS}]`,
    message: '相対 import は実ファイルの拡張子（.ts）で書く（§2.2）',
  },
  {
    selector: `ExportAllDeclaration[source.value=${RELATIVE_JS}]`,
    message: '相対 import は実ファイルの拡張子（.ts）で書く（§2.2）',
  },
  {
    selector: `ImportExpression[source.value=${RELATIVE_JS}]`,
    message: '相対 import は実ファイルの拡張子（.ts）で書く（§2.2）',
  },
];

// 構文レベルの規則。全拡張子に掛ける
const syntaxRules = {
  'no-var': 'error',
  curly: ['error', 'all'],
  yoda: 'error',
  'no-fallthrough': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'max-statements-per-line': ['error', { max: 1 }],
};

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', '.agents/', '.claude/'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: JS_FILES,
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      ...syntaxRules,
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: TS_FILES,
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...syntaxRules,
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX, ...RESTRICTED_RELATIVE_JS],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // §7.1 テストは lint 側の軸だけ緩める（構文制限は外さない）
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
);
