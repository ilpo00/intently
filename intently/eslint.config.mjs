// ESLint v9 flat config
// Uses eslint-config-next's native flat-config export (v16+) —
// FlatCompat is no longer required and was causing a circular-structure
// error when reporting config validation issues.
//
// We also register `typescript-eslint` directly so custom rules like
// `@typescript-eslint/no-explicit-any` can be configured on top of
// the Next defaults, which only ship the Next/React/hooks rules.

import next from 'eslint-config-next'
import tseslint from 'typescript-eslint'

const config = [
  ...next,
  ...tseslint.configs.recommended,
  {
    // Project-wide rule overrides
    rules: {
      // Allow unused vars prefixed with _ (common for destructuring)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Align with .cursorrules: no `any` in source.
      '@typescript-eslint/no-explicit-any': 'error',
      // Apostrophes in JSX copy are fine — this rule is purely cosmetic.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // CommonJS config files use require() — allow it there.
    files: ['*.js', '*.cjs', 'jest.config.js', 'next.config.js', 'postcss.config.*', 'tailwind.config.*'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Tests may use `as any` sparingly for mock shims and narrow casts.
    files: ['src/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['.next/', 'node_modules/', 'coverage/', 'src/_parked/'],
  },
]

export default config
