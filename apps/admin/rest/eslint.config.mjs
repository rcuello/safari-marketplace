// Flat config de ESLint 9 (US-81; export flat nativo de eslint-config-next 16
// desde US-82). Reproduce el antiguo .eslintrc.json: `next` + `prettier`, sin
// exhaustive-deps ni no-img-element.
import next from 'eslint-config-next';
import prettier from 'eslint-config-prettier/flat';

export default [
  // Lo que ignoraba .eslintignore (flat config no lo lee).
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'public/**',
      '.husky/**',
      'next-env.d.ts',
    ],
  },
  ...next,
  prettier,
  // Reglas que entran con eslint-config-next 16: las del React Compiler de
  // eslint-plugin-react-hooks 7 y una nueva de @next/next. Activarlas es
  // endurecer el lint (fuera de alcance de US-82, igual que en US-81); se
  // apagan para conservar las mismas reglas activas que con la 15.
  {
    rules: Object.fromEntries(
      [
        '@next/next/no-location-assign-relative-destination',
        'react-hooks/config',
        'react-hooks/error-boundaries',
        'react-hooks/gating',
        'react-hooks/globals',
        'react-hooks/immutability',
        'react-hooks/incompatible-library',
        'react-hooks/preserve-manual-memoization',
        'react-hooks/purity',
        'react-hooks/refs',
        'react-hooks/set-state-in-effect',
        'react-hooks/set-state-in-render',
        'react-hooks/static-components',
        'react-hooks/unsupported-syntax',
        'react-hooks/use-memo',
      ].map((rule) => [rule, 'off']),
    ),
  },
  // ESLint 9 avisa por defecto de los eslint-disable que ya no hacen falta; la
  // 8 no lo hacía. Se apaga para no sumar hallazgos (limpiarlos es otra US).
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    rules: {
      'react-hooks/exhaustive-deps': 0,
      '@next/next/no-img-element': 'off',
    },
  },
];
