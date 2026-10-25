import { GetServerSideProps } from 'next';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import invariant from 'tiny-invariant';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/framework/client/api-endpoints';
import client from '@/framework/client';
import {
  CategoryQueryOptions,
  SettingsQueryOptions,
  TypeQueryOptions,
} from '@/types';
import { TYPES_PER_PAGE } from '@/framework/client/variables';

export const getServerSideProps: GetServerSideProps = async ({
  locale,
  params,
}) => {
  invariant(params, 'params is required');
  const { searchType } = params;
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

  const categoryVariable = {
    type: searchType,
    limit: 1000,
    parent: 'null',
    language: locale,
  };

  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.CATEGORIES, categoryVariable],
    queryFn: ({ queryKey }) =>
      client.categories.all(queryKey[1] as CategoryQueryOptions),
  });

  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};
