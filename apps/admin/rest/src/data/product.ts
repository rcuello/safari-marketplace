import Router, { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next/pages';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/data/client/api-endpoints';
import { productClient } from './client/product';
import {
  ProductQueryOptions,
  GetParams,
  ProductPaginator,
  Product,
} from '@/types';
import { mapPaginatorData } from '@/utils/data-mappers';
import { Routes } from '@/config/routes';
import { Config } from '@/config';

export const useCreateProductMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: productClient.create,
    onSuccess: async () => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.product.list}`
        : Routes.product.list;
      await Router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.PRODUCTS] });
    },
    onError: (error: any) => {
      const { data, status } = error?.response;
      if (status === 422) {
        const errorMessage: any = Object.values(data).flat();
        toast.error(errorMessage[0]);
      } else {
        toast.error(t(`common:${error?.response?.data.message}`));
      }
    },
  });
};

export const useUpdateProductMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: productClient.update,
    onSuccess: async (data) => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.product.list}`
        : Routes.product.list;
      await router.push(
        `${generateRedirectUrl}/${data?.slug}/edit`,
        undefined,
        {
          locale: Config.defaultLanguage,
        },
      );
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.PRODUCTS] });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useDeleteProductMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: productClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.PRODUCTS] });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useProductQuery = ({ slug, language }: GetParams) => {
  const { data, error, isLoading } = useQuery<Product, Error>({
    queryKey: [API_ENDPOINTS.PRODUCTS, { slug, language }],
    queryFn: () => productClient.get({ slug, language }),
  });

  return {
    product: data,
    error,
    isLoading,
  };
};

export const useProductsQuery = (
  params: Partial<ProductQueryOptions>,
  options: any = {},
) => {
  const { data, error, isLoading } = useQuery<ProductPaginator, Error>({
    queryKey: [API_ENDPOINTS.PRODUCTS, params],
    queryFn: ({ queryKey }) =>
      productClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
    ...options,
  });

  return {
    products: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

export const useGenerateDescriptionMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  return useMutation({
    mutationFn: productClient.generateDescription,
    onSuccess: () => {
      toast.success(t('Generated...'));
    },
    // Always refetch after error or success:
    onSettled: (data) => {
      queryClient.refetchQueries({
        queryKey: [API_ENDPOINTS.GENERATE_DESCRIPTION],
      });
      data;
    },
  });
};

export const useInActiveProductsQuery = (
  options: Partial<ProductQueryOptions>,
) => {
  const { data, error, isLoading } = useQuery<ProductPaginator, Error>({
    queryKey: [API_ENDPOINTS.NEW_OR_INACTIVE_PRODUCTS, options],
    queryFn: ({ queryKey }) =>
      productClient.newOrInActiveProducts(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    products: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

export const useProductStockQuery = (options: Partial<ProductQueryOptions>) => {
  const { data, error, isLoading } = useQuery<ProductPaginator, Error>({
    queryKey: [API_ENDPOINTS.LOW_OR_OUT_OF_STOCK_PRODUCTS, options],
    queryFn: ({ queryKey }) =>
      productClient.lowOrOutOfStockProducts(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    products: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

// Read All products by flash sale

export const useProductsByFlashSaleQuery = (options: any) => {
  const { data, error, isLoading } = useQuery<ProductPaginator, Error>({
    queryKey: [API_ENDPOINTS.PRODUCTS_BY_FLASH_SALE, options],
    queryFn: ({ queryKey }) =>
      productClient.getProductsByFlashSale(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    products: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};
