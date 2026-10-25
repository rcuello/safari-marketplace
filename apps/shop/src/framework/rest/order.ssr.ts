import { GetServerSideProps } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import client from '@/framework/client';
import { TYPES_PER_PAGE } from '@/framework/client/variables';
import { SettingsQueryOptions, TypeQueryOptions } from '@/types';
import { API_ENDPOINTS } from './client/api-endpoints';

export const getServerSideProps: GetServerSideProps = async ({ locale }) => {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.SETTINGS, { language: locale }],
    queryFn: ({ queryKey }) =>
      client.settings.all(queryKey[1] as SettingsQueryOptions),
  });

  await queryClient.fetchQuery({
    queryKey: [
      API_ENDPOINTS.TYPES,
      { limit: TYPES_PER_PAGE, language: locale },
    ],
    queryFn: ({ queryKey }) =>
      client.types.all(queryKey[1] as TypeQueryOptions),
  });

  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};
