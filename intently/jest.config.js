const nextJest = require('next/jest')
const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',

  // Runs after Jest is loaded, before each test file.
  // https://jestjs.io/docs/configuration#setupfilesafterenv-array
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/src/tests/**/*.test.ts',
    '<rootDir>/src/tests/**/*.test.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/src/_parked/'],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/store/**/*.ts',
    'src/hooks/**/*.ts',
    'src/components/**/*.{ts,tsx}',
    'src/app/**/*.{ts,tsx}',
    '!src/app/**/layout.tsx',
    '!src/**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov'],
}

module.exports = createJestConfig(config)
