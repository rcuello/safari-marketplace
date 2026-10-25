import type { GetStaticProps } from 'next';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { SettingsQueryOptions } from '@/types';

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.SETTINGS, { language: locale }],
    queryFn: ({ queryKey }) =>
      client.settings.all(queryKey[1] as SettingsQueryOptions),
  });
  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.TYPES, { language: locale }],
    queryFn: ({ queryKey }) => client.types.all(queryKey[1] as any),
  });
  await queryClient.prefetchInfiniteQuery({
    queryKey: [API_ENDPOINTS.MANUFACTURERS, { limit: 30, language: locale }],
    queryFn: ({ queryKey }) => client.manufacturers.all(queryKey[1] as any),
    initialPageParam: undefined,
  });
  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common', 'banner'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};
