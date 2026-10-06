/** @type {import('@swc/core').JsMinifyOptions & Record<string, unknown>} */
const swc = {
  jsc: {
    parser: {
      syntax: 'typescript',
      tsx: true,
    },
    target: 'es2022',
  },
  module: {
    type: 'commonjs',
  },
};

const transform = {
  '^.+\\.tsx?$': ['@swc/jest', swc],
};

/** @type {import('jest').Config} */
const config = {
  forceExit: true,
  projects: [
    {
      displayName: 'gateway',
      testEnvironment: 'node',
      roots: ['<rootDir>/gateway'],
      testMatch: ['<rootDir>/gateway/test/**/*.test.ts'],
      transform,
      moduleNameMapper: {
        '^@remote/protocol$': '<rootDir>/packages/protocol/src/index.ts',
        '^(\\.{1,2}/.*)\\.ts$': '$1',
      },
    },
    {
      displayName: 'web',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/web'],
      testMatch: ['<rootDir>/web/**/*.{test,spec}.{ts,tsx}'],
      transform,
      moduleNameMapper: {
        '^@/(.*)\\.tsx$': '<rootDir>/web/src/$1',
        '^@/(.*)\\.ts$': '<rootDir>/web/src/$1',
        '^@/(.*)$': '<rootDir>/web/src/$1',
        '^@remote/protocol$': '<rootDir>/packages/protocol/src/index.ts',
        '^(\\.{1,2}/.*)\\.tsx$': '$1',
        '^(\\.{1,2}/.*)\\.ts$': '$1',
      },
    },
  ],
};

export default config;
