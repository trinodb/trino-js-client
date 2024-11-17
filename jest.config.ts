/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type {Config} from 'jest';

const config: Config = {
  clearMocks: true,
  coverageProvider: 'v8',
  moduleFileExtensions: ['js', 'ts'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  verbose: true,
};

export default config;
