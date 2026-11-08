'use strict';

const nodeGlobals = {
  require: 'readonly',
  module: 'readonly',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**', 'vendor/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-fallthrough': 'error',
      'valid-typeof': 'error',
    },
  },
];
