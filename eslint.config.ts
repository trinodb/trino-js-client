import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jest from 'eslint-plugin-jest';

export default tseslint.config(
  {
    ignores: ['dist'],
  },
  jest.configs['flat/recommended'],
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': ['warn'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  }
);
