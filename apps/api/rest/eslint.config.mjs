// Flat config de ESLint 9 (US-81). Reproduce el antiguo .eslintrc.js:
// `@typescript-eslint/recommended` + `prettier/recommended`, entornos node y
// jest, y las mismas excepciones locales.
import { defineConfig } from 'eslint/config';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // El .eslintrc.js se ignoraba a sí mismo; su sucesor también.
  { ignores: ['eslint.config.mjs'] },
  tseslint.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
    rules: {
      // Paridad con el `recommended` de typescript-eslint 5 (CA-1 de US-81).
      // Salieron del `recommended` en la 8, pero existen: se mantienen.
      '@typescript-eslint/adjacent-overload-signatures': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // La 8 quitó `@typescript-eslint/no-loss-of-precision`: la regla del
      // núcleo ya cubre lo mismo.
      'no-loss-of-precision': 'error',
      // Entraron al `recommended` en la 8; activarlas es endurecer (otra US).
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `_x` = sin usar a propósito (los stubs de Pickbazar conservan su firma);
      // `{ data, ...resto }` es la forma de omitir una clave.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
