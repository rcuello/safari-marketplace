import type { ShopQueryOptions, TypeQueryOptions } from '@/types';
import type { GetStaticProps } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { SHOPS_PER_PAGE, TYPES_PER_PAGE } from './client/variables';
import { SettingsQueryOptions } from '@/types';

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.SETTINGS, { language: locale }],
    queryFn: ({ queryKey }) =>
      client.settings.all(queryKey[1] as SettingsQueryOptions),
  });
  await queryClient.prefetchQuery({
    queryKey: [
      API_ENDPOINTS.TYPES,
      { limit: TYPES_PER_PAGE, language: locale },
    ],
    queryFn: ({ queryKey }) =>
      client.types.all(queryKey[1] as TypeQueryOptions),
  });
  await queryClient.prefetchInfiniteQuery({
    queryKey: [API_ENDPOINTS.SHOPS, { limit: SHOPS_PER_PAGE, is_active: 1 }],
    queryFn: ({ queryKey }) =>
      client.shops.all(queryKey[1] as ShopQueryOptions),
    initialPageParam: undefined,
  });
  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common', 'banner'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};
