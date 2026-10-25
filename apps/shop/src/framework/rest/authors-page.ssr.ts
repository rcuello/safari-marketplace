import type { SettingsQueryOptions, TypeQueryOptions } from '@/types';
import type { GetStaticProps } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { QueryClient, useQuery, dehydrate } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { TYPES_PER_PAGE } from './client/variables';

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
    queryKey: [API_ENDPOINTS.AUTHORS, { limit: 30, language: locale }],
    queryFn: ({ queryKey }) => client.authors.all(queryKey[1] as any),
    initialPageParam: undefined,
  });
  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common', 'banner'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};
