/** @type {import('next').NextConfig} */
const { i18n } = require('./next-i18next.config');

// const runtimeCaching = require('next-pwa/cache');
// const withPWA = require('next-pwa')({
//   disable: process.env.NODE_ENV === 'development',
//   dest: 'public',
//   runtimeCaching,
// });

module.exports = {
  reactStrictMode: true,
  i18n,
  // Next 16 escribe un AGENTS.md en la app en cada `next dev`; no se versiona.
  agentRules: false,
  images: {
    // Sustituye a images.domains (obsoleto, R-4). Un patrón por host sin
    // protocolo, puerto ni ruta equivale a la entrada de `domains`.
    remotePatterns: [
      'pickbazarlaravel.s3.ap-southeast-1.amazonaws.com',
      'pixarlaravel.s3.ap-southeast-1.amazonaws.com',
      'lh3.googleusercontent.com',
      'localhost',
      '127.0.0.1',
      'i.pravatar.cc',
    ].map((hostname) => ({ hostname })),
    // Next 16 bloquea por defecto optimizar imágenes de IPs locales; las
    // entradas 'localhost' y '127.0.0.1' solo tienen sentido en desarrollo,
    // así que se permiten ahí y producción conserva el bloqueo de Next.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
    // Next 16 solo admite la calidad 75 por defecto; el shop usa quality={100}.
    qualities: [75, 100],
  },
  ...(process.env.FRAMEWORK_PROVIDER === 'graphql' && {
    webpack(config, options) {
      config.module.rules.push({
        test: /\.graphql$/,
        exclude: /node_modules/,
        use: [options.defaultLoaders.babel, { loader: 'graphql-let/loader' }],
      });

      config.module.rules.push({
        test: /\.ya?ml$/,
        type: 'json',
        use: 'yaml-loader',
      });

      return config;
    },
  }),
  ...(process.env.APPLICATION_MODE === 'production' && {
    typescript: {
      ignoreBuildErrors: true,
    },
    // `eslint.ignoreDuringBuilds` sale: Next 16 ya no lintea en `next build`.
  }),
};
