import type {
  FaqsQueryOptions,
  ShopQueryOptions,
  TypeQueryOptions,
} from '@/types';
import type { GetStaticProps } from 'next';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { SHOPS_PER_PAGE, TYPES_PER_PAGE } from './client/variables';
import { SettingsQueryOptions } from '@/types';
import { LIMIT } from '@/lib/constants';

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
    queryKey: [
      API_ENDPOINTS.FAQS,
      {
        faq_type: 'global',
        issued_by: 'Super Admin',
        limit: LIMIT,
        language: locale,
      },
    ],
    queryFn: ({ queryKey }) => client.faqs.all(queryKey[1] as FaqsQueryOptions),
    initialPageParam: undefined,
  });
  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};
