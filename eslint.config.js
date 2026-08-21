import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
  {
    // scripts do k6 (ARARA-400) rodam num runtime próprio (Goja), com
    // globals específicos que não existem em Node — __ENV é o único usado
    // hoje
    files: ['tests/load/**/*.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
      },
    },
  },
  {
    // frontend/ é um projeto npm próprio (package.json, node_modules e
    // eslint.config.mjs independentes) — tem o próprio lint, não o da raiz
    ignores: ['dist/', 'node_modules/', 'coverage/', 'frontend/'],
  },
);
