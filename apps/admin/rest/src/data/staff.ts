import { StaffPaginator, StaffQueryOptions } from '@/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { mapPaginatorData } from '@/utils/data-mappers';
import { API_ENDPOINTS } from './client/api-endpoints';
import { staffClient } from './client/staff';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { toast } from 'react-toastify';
import { Routes } from '@/config/routes';

export const useStaffsQuery = (
  params: Partial<StaffQueryOptions>,
  options: any = {},
) => {
  const { data, error, isLoading } = useQuery<StaffPaginator, Error>({
    queryKey: [API_ENDPOINTS.STAFFS, params],
    queryFn: ({ queryKey }) =>
      staffClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
    ...options,
  });
  return {
    staffs: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

export const useAddStaffMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: staffClient.addStaff,
    onSuccess: () => {
      router.push(`/${router?.query?.shop}${Routes.staff.list}`);
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.STAFFS] });
    },
  });
};

export const useRemoveStaffMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: staffClient.removeStaff,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.STAFFS] });
    },
  });
};
