import Router, { useRouter } from 'next/router';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { mapPaginatorData } from '@/utils/data-mappers';
import type { UseInfiniteQueryOptions } from '@tanstack/react-query';
import {
  FlashSale,
  FlashSalePaginator,
  FlashSaleProductsRequest,
  FlashSaleProductsRequestPaginator,
  FlashSaleProductsRequestQueryOptions,
  FlashSaleQueryOptions,
  FlashSaleRequestedProductsQueryOptions,
  ProductPaginator,
  ProductQueryOptions,
} from '@/types';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from './client/api-endpoints';
import { Config } from '@/config';
import { flashSaleVendorRequestClient } from '@/data/client/flash-sale-vendor-request';

// get all flash sale request list

export const useRequestedListsForFlashSale = (
  options: Partial<FlashSaleProductsRequestQueryOptions>,
) => {
  const { data, error, isLoading } = useQuery<
    FlashSaleProductsRequestPaginator,
    Error
  >({
    queryKey: [API_ENDPOINTS.REQUEST_LISTS_FOR_FLASH_SALE, options],
    queryFn: ({ queryKey }) =>
      flashSaleVendorRequestClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    flashSaleRequests: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

// Read Single flashSale request

export const useRequestedListForFlashSale = ({
  id,
  language,
  shop_id,
}: {
  id: string;
  language: string;
  shop_id?: string;
}) => {
  const { data, error, isLoading } = useQuery<any, Error>({
    queryKey: [API_ENDPOINTS.FLASH_SALE, { id, language, shop_id }],
    queryFn: () => flashSaleVendorRequestClient.get({ id, language, shop_id }),
  });

  return {
    flashSaleRequest: data,
    error,
    loading: isLoading,
  };
};

// get all flash sale products list in a enlisted requests

export const useRequestedProductsForFlashSale = (
  options: Partial<FlashSaleRequestedProductsQueryOptions>,
) => {
  const { data, error, isLoading } = useQuery<ProductPaginator, Error>({
    queryKey: [API_ENDPOINTS.REQUESTED_PRODUCTS_FOR_FLASH_SALE, options],
    queryFn: ({ queryKey }) =>
      flashSaleVendorRequestClient.requestedProducts(
        Object.assign({}, queryKey[1]),
      ),
    placeholderData: keepPreviousData,
  });

  return {
    products: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

// Create flash sale

export const useCreateFlashSaleRequestMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: flashSaleVendorRequestClient.create,
    onSuccess: async () => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.vendorRequestForFlashSale.list}`
        : Routes.vendorRequestForFlashSale.list;
      await Router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.REQUEST_LISTS_FOR_FLASH_SALE],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

// Update flash sale

export const useUpdateFlashSaleRequestMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: flashSaleVendorRequestClient.update,
    onSuccess: async (data) => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.vendorRequestForFlashSale.list}`
        : Routes.vendorRequestForFlashSale.list;
      await router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.REQUEST_LISTS_FOR_FLASH_SALE],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

// Delete Flash Sale Request

export const useDeleteFlashSaleRequestMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: flashSaleVendorRequestClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.REQUEST_LISTS_FOR_FLASH_SALE],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

// approve flash sale vendor request

export const useApproveVendorFlashSaleRequestMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: flashSaleVendorRequestClient.approve,
    onSuccess: async () => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.vendorRequestForFlashSale.list}`
        : Routes.vendorRequestForFlashSale.list;
      await Router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });

      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.FLASH_SALE] });
    },
  });
};

// disapprove flash sale vendor request

export const useDisApproveVendorFlashSaleRequestMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: flashSaleVendorRequestClient.disapprove,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.FLASH_SALE] });
    },
  });
};
