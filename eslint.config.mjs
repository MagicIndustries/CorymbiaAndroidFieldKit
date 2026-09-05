import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import importPlugin from 'eslint-plugin-import'

// Baseline configuration. Task 5 of the foundation plan adds the three
// architectural rules on top of this: semantic tokens only, size classes only,
// and no cross-tool imports.
//
// There must only ever be ONE ESLint config at the repo root. ESLint 9 resolves
// eslint.config.js ahead of eslint.config.mjs, so a stray .js file here would
// silently shadow this one and disable every rule below without an error.

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      '**/babel.config.js',
      '**/jest.config.js',
      '**/jest.setup.js',
    ],
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __DEV__: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
