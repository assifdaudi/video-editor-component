// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'output/**',
      '*.js',
      '*.mjs',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
    ],
    rules: {
      // Require explicit return types on functions
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      // Unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // Any types as warnings
      '@typescript-eslint/no-explicit-any': 'warn',
      // Array type preference
      '@typescript-eslint/array-type': 'warn',
      // Prefer interfaces over types for object definitions
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // Allow empty functions (common in Express error handlers)
      '@typescript-eslint/no-empty-function': [
        'error',
        {
          allow: ['arrowFunctions'],
        },
      ],
      // Disable inferrable types rule (helpful for explicit documentation)
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  }
);

