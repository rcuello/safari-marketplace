/** @type {import('next').NextConfig} */

const { i18n } = require('./next-i18next.config');

// const runtimeCaching = require('next-pwa/cache');
// const withPWA = require('next-pwa')({
//   disable: process.env.NODE_ENV === 'development',
//   dest: 'public',
//   runtimeCaching,
// });

const nextConfig = {
  reactStrictMode: true,
  i18n,
  // Next 16 escribe un AGENTS.md en la app en cada `next dev`; no se versiona.
  agentRules: false,
  images: {
    // Sustituye a images.domains (obsoleto, R-4). Un patrón por host sin
    // protocolo, puerto ni ruta equivale a la entrada de `domains`. La antigua
    // entrada '127.0.0.1:8000' no casaba nunca (`domains` compara el hostname,
    // que no lleva puerto) y ya la cubre '127.0.0.1'.
    remotePatterns: [
      'via.placeholder.com',
      'res.cloudinary.com',
      's3.amazonaws.com',
      '18.141.64.26',
      '127.0.0.1',
      'localhost',
      'picsum.photos',
      'pickbazar-sail.test',
      'pickbazarlaravel.s3.ap-southeast-1.amazonaws.com',
      'lh3.googleusercontent.com',
    ].map((hostname) => ({ hostname })),
    // Next 16 bloquea por defecto optimizar imágenes de IPs locales; las
    // entradas 'localhost' y '127.0.0.1' solo tienen sentido en desarrollo,
    // así que se permiten ahí y producción conserva el bloqueo de Next.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
  },
  ...(process.env.APPLICATION_MODE === 'production' && {
    typescript: {
      ignoreBuildErrors: true,
    },
    // `eslint.ignoreDuringBuilds` sale: Next 16 ya no lintea en `next build`.
  }),
};

module.exports = nextConfig;
