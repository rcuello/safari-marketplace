import {
  CreateOrderInput,
  CreateOrderPaymentInput,
  CreateRefundInput,
  DownloadableFilePaginator,
  Order,
  OrderPaginator,
  OrderQueryOptions,
  PaymentGateway,
  QueryOptions,
  RefundPaginator,
  RefundPolicyQueryOptions,
} from '@/types';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useTranslation } from 'next-i18next/pages';
import { toast } from 'react-toastify';
import { useModalAction } from '@/components/ui/modal/modal.context';
import { API_ENDPOINTS } from './client/api-endpoints';
import client from './client';
import { useAtom } from 'jotai';
import { verifiedResponseAtom } from '@/store/checkout';
import { useRouter } from 'next/router';
import { Routes } from '@/config/routes';
import { mapPaginatorData } from '@/framework/utils/data-mappers';
import { isArray, isObject, isEmpty } from 'lodash';

export function useOrders(options?: Partial<OrderQueryOptions>) {
  const { locale } = useRouter();

  const formattedOptions = {
    ...options,
    // language: locale
  };

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery<OrderPaginator, Error>({
    queryKey: [API_ENDPOINTS.ORDERS, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.orders.all(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
    refetchOnWindowFocus: false,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    orders: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    isLoading,
    error,
    isFetching,
    isLoadingMore: isFetchingNextPage,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
}

export function useOrder({ tracking_number }: { tracking_number: string }) {
  const { data, isLoading, error, isFetching, refetch } = useQuery<
    Order,
    Error
  >({
    queryKey: [API_ENDPOINTS.ORDERS, tracking_number],
    queryFn: () => client.orders.get(tracking_number),
    refetchOnWindowFocus: false,
  });

  return {
    order: data,
    isFetching,
    isLoading,
    refetch,
    error,
  };
}

export function useRefunds(options: Pick<QueryOptions, 'limit'>) {
  const { locale } = useRouter();

  const formattedOptions = {
    ...options,
    // language: locale
  };

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
  } = useInfiniteQuery<RefundPaginator, Error>({
    queryKey: [API_ENDPOINTS.ORDERS_REFUNDS, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.orders.refunds(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    refunds: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    error,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
}

export const useDownloadableProducts = (
  options: Pick<QueryOptions, 'limit'>,
) => {
  const { locale } = useRouter();

  const formattedOptions = {
    ...options,
    // language: locale
  };

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
  } = useInfiniteQuery<DownloadableFilePaginator, Error>({
    queryKey: [API_ENDPOINTS.ORDERS_DOWNLOADS, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.orders.downloadable(
        Object.assign({}, queryKey[1] as OrderQueryOptions, pageParam),
      ),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
    refetchOnWindowFocus: false,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    downloads: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    isLoading,
    isFetching,
    isLoadingMore: isFetchingNextPage,
    error,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
};

export function useCreateRefund() {
  const { t } = useTranslation();
  const { locale } = useRouter();
  const { closeModal } = useModalAction();
  const queryClient = useQueryClient();
  const { mutate: createRefundRequest, isPending: isLoading } = useMutation({
    mutationFn: client.orders.createRefund,
    onSuccess: () => {
      toast.success(`${t('text-refund-request-submitted')}`);
    },
    onError: (error) => {
      const {
        response: { data },
      }: any = error ?? {};

      toast.error(`${t(data?.message)}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ORDERS] });
      closeModal();
    },
  });

  function formatRefundInput(input: CreateRefundInput) {
    const formattedInputs = {
      ...input,
      // language: locale
    };
    createRefundRequest(formattedInputs);
  }

  return {
    createRefundRequest: formatRefundInput,
    isLoading,
  };
}

export function useCreateOrder() {
  const router = useRouter();
  const { locale } = router;
  const { t } = useTranslation();
  const { mutate: createOrder, isPending: isLoading } = useMutation({
    mutationFn: client.orders.create,
    onSuccess: ({ tracking_number, payment_gateway, payment_intent }) => {
      console.log(
        tracking_number,
        payment_gateway,
        payment_intent,
        'create order',
      );

      if (tracking_number) {
        if (
          [
            PaymentGateway.COD,
            PaymentGateway.CASH,
            PaymentGateway.FULL_WALLET_PAYMENT,
          ].includes(payment_gateway as PaymentGateway)
        ) {
          return router.push(Routes.order(tracking_number));
        }

        if (payment_intent?.payment_intent_info?.is_redirect) {
          return router.push(
            payment_intent?.payment_intent_info?.redirect_url as string,
          );
        } else {
          return router.push(`${Routes.order(tracking_number)}/payment`);
        }
      }
    },
    onError: (error) => {
      const {
        response: { data },
      }: any = error ?? {};
      toast.error(data?.message);
    },
  });

  function formatOrderInput(input: CreateOrderInput) {
    const formattedInputs = {
      ...input,
      language: locale,
      invoice_translated_text: {
        subtotal: t('order-sub-total'),
        discount: t('order-discount'),
        tax: t('order-tax'),
        delivery_fee: t('order-delivery-fee'),
        total: t('order-total'),
        products: t('text-products'),
        quantity: t('text-quantity'),
        invoice_no: t('text-invoice-no'),
        date: t('text-date'),
      },
    };
    createOrder(formattedInputs);
  }

  return {
    createOrder: formatOrderInput,
    isLoading,
    // isPaymentIntentLoading
  };
}

export function useGenerateDownloadableUrl() {
  const { mutate: getDownloadableUrl } = useMutation({
    mutationFn: client.orders.generateDownloadLink,
    onSuccess: (data) => {
      function download(fileUrl: string, fileName: string) {
        var a = document.createElement('a');
        a.href = fileUrl;
        a.setAttribute('download', fileName);
        a.click();
      }

      download(data, 'record.name');
    },
  });

  function generateDownloadableUrl(digital_file_id: string) {
    getDownloadableUrl({
      digital_file_id,
    });
  }

  return {
    generateDownloadableUrl,
  };
}

export function useVerifyOrder() {
  const [_, setVerifiedResponse] = useAtom(verifiedResponseAtom);

  return useMutation({
    mutationFn: client.orders.verify,
    onSuccess: (data) => {
      //@ts-ignore
      if (data?.errors as string) {
        //@ts-ignore
        toast.error(data?.errors[0]?.message);
      } else if (data) {
        // FIXME
        //@ts-ignore
        setVerifiedResponse(data);
      }
    },
    onError: (error) => {
      const {
        response: { data },
      }: any = error ?? {};
      toast.error(data?.message);
    },
  });
}

export function useOrderPayment() {
  const queryClient = useQueryClient();

  const { mutate: createOrderPayment, isPending: isLoading } = useMutation({
    mutationFn: client.orders.payment,
    onSettled: (data) => {
      queryClient.refetchQueries({ queryKey: [API_ENDPOINTS.ORDERS] });
      queryClient.refetchQueries({
        queryKey: [API_ENDPOINTS.ORDERS_DOWNLOADS],
      });
    },
    onError: (error) => {
      const {
        response: { data },
      }: any = error ?? {};
      toast.error(data?.message);
    },
  });

  function formatOrderInput(input: CreateOrderPaymentInput) {
    const formattedInputs = {
      ...input,
    };
    createOrderPayment(formattedInputs);
  }

  return {
    createOrderPayment: formatOrderInput,
    isLoading,
  };
}

export function useSavePaymentMethod() {
  const {
    mutate: savePaymentMethod,
    isPending: isLoading,
    error,
    data,
  } = useMutation({ mutationFn: client.orders.savePaymentMethod });

  return {
    savePaymentMethod,
    data,
    isLoading,
    error,
  };
}

export function useGetPaymentIntentOriginal({
  tracking_number,
}: {
  tracking_number: string;
}) {
  const router = useRouter();
  const { openModal } = useModalAction();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [API_ENDPOINTS.PAYMENT_INTENT, { tracking_number }],
    queryFn: () => client.orders.getPaymentIntent({ tracking_number }),
    // Make it dynamic for both gql and rest
    enabled: false,
  });

  // TanStack Query 5 quitó onSuccess de useQuery. La consulta solo corre con
  // refetch (enabled: false), así que el efecto va tras cada refetch con éxito.
  async function getPaymentIntentQueryOriginal() {
    const result = await refetch();
    if (result.isSuccess) {
      const data = result.data;
      if (data?.payment_intent_info?.is_redirect) {
        router.push(data?.payment_intent_info?.redirect_url as string);
      } else {
        openModal('PAYMENT_MODAL', {
          paymentGateway: data?.payment_gateway,
          paymentIntentInfo: data?.payment_intent_info,
          trackingNumber: data?.tracking_number,
        });
      }
    }
    return result;
  }

  return {
    data,
    getPaymentIntentQueryOriginal,
    isLoading,
    error,
  };
}

export function useGetPaymentIntent({
  tracking_number,
  payment_gateway,
  recall_gateway,
  form_change_gateway,
}: {
  tracking_number: string;
  payment_gateway: string;
  recall_gateway?: boolean;
  form_change_gateway?: boolean;
}) {
  const router = useRouter();
  const { openModal, closeModal } = useModalAction();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [
      API_ENDPOINTS.PAYMENT_INTENT,
      { tracking_number, payment_gateway, recall_gateway },
    ],
    queryFn: () =>
      client.orders.getPaymentIntent({
        tracking_number,
        payment_gateway,
        recall_gateway,
      }),
    // Make it dynamic for both gql and rest
    enabled: false,
  });

  // TanStack Query 5 quitó onSuccess de useQuery. La consulta solo corre con
  // refetch (enabled: false), así que el efecto va tras cada refetch con éxito.
  async function getPaymentIntentQuery() {
    const result = await refetch();
    if (result.isSuccess) {
      const item = result.data;
      let data: any = '';
      if (isArray(item)) {
        data = { ...item };
        data = isEmpty(data) ? [] : data[0];
      } else if (isObject(item)) {
        data = item;
      }
      if (data?.payment_intent_info?.is_redirect) {
        router.push(data?.payment_intent_info?.redirect_url as string);
      } else {
        if (recall_gateway) window.location.reload();
        openModal('PAYMENT_MODAL', {
          paymentGateway: data?.payment_gateway,
          paymentIntentInfo: data?.payment_intent_info,
          trackingNumber: data?.tracking_number,
        });
      }
    }
    return result;
  }

  return {
    data,
    getPaymentIntentQuery,
    isLoading,
    fetchAgain: isFetching,
    error,
  };
}
