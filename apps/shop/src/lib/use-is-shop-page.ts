import { useRouter } from 'next/router';

// Las páginas de una tienda (`/shops/[slug]` y sus pestañas). Solo ahí el
// `slug` de la ruta es el de una tienda; en `/products/[slug]` es el del
// producto (US-71).
export function useIsShopPage() {
  const router = useRouter();
  return router.pathname.startsWith('/shops/[slug]');
}
