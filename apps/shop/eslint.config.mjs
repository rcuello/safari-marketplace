// Flat config de ESLint 9 (US-81). Reproduce el antiguo .eslintrc.json:
// `next` + `prettier`, sin exhaustive-deps. eslint-config-next 15 todavía se
// publica en formato eslintrc, así que entra por FlatCompat; con Next 16
// (US-82) se importa su export flat nativo.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  // Lo que ignoraba .eslintignore (flat config no lo lee).
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'public/**',
      '.husky/**',
      'next-env.d.ts',
      // graphql-let
      '**/__generated__/**',
      '**/*.graphql.d.ts',
      '**/*.graphqls.d.ts',
    ],
  },
  ...compat.extends('next', 'prettier'),
  // ESLint 9 avisa por defecto de los eslint-disable que ya no hacen falta; la
  // 8 no lo hacía. Se apaga para no sumar hallazgos (limpiarlos es otra US).
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    rules: {
      'react-hooks/exhaustive-deps': 0,
    },
  },
];
