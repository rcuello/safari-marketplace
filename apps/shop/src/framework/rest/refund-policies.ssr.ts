import { LIMIT } from '@/lib/constants';
import { RefundPolicyQueryOptions, SettingsQueryOptions } from '@/types';
import type { GetStaticProps } from 'next';
import { serverSideTranslations } from 'next-i18next/pages/serverSideTranslations';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';

export const getCustomerStaticProps: GetStaticProps = async ({ locale }) => {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.SETTINGS, { language: locale }],
    queryFn: ({ queryKey }) =>
      client.settings.all(queryKey[1] as SettingsQueryOptions),
  });
  await queryClient.prefetchInfiniteQuery({
    queryKey: [
      API_ENDPOINTS.REFUND_POLICIES,
      {
        target: 'customer',
        status: 'approved',
        limit: LIMIT,
        language: locale,
      },
    ],
    queryFn: ({ queryKey }) =>
      client.refundPolicies.all(queryKey[1] as RefundPolicyQueryOptions),
    initialPageParam: undefined,
  });
  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
  };
};

export const getVendorStaticProps: GetStaticProps = async ({ locale }) => {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: [API_ENDPOINTS.SETTINGS, { language: locale }],
    queryFn: ({ queryKey }) =>
      client.settings.all(queryKey[1] as SettingsQueryOptions),
  });
  await queryClient.prefetchInfiniteQuery({
    queryKey: [
      API_ENDPOINTS.REFUND_POLICIES,
      { target: 'vendor', status: 'approved', limit: LIMIT, language: locale },
    ],
    queryFn: ({ queryKey }) =>
      client.refundPolicies.all(queryKey[1] as RefundPolicyQueryOptions),
    initialPageParam: undefined,
  });
  return {
    props: {
      ...(await serverSideTranslations(locale!, ['common'])),
      dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
    },
    revalidate: 10,
  };
};
