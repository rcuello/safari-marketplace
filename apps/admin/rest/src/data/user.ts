import { AUTH_CRED } from '@/utils/constants';
import { Routes } from '@/config/routes';
import Cookies from 'js-cookie';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_ENDPOINTS } from './client/api-endpoints';
import { userClient } from './client/user';
import {
  User,
  QueryOptionsType,
  UserPaginator,
  UserQueryOptions,
  LicensedDomainPaginator,
  LicenseAdditionalData,
} from '@/types';
import { mapPaginatorData } from '@/utils/data-mappers';
import axios from 'axios';
import { useEffect } from 'react';
import { setEmailVerified } from '@/utils/auth-utils';
import { type } from 'os';

export const useMeQuery = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  const query = useQuery<User, Error>({
    queryKey: [API_ENDPOINTS.ME],
    queryFn: userClient.me,
    retry: false,
  });
  const { data, error } = query;

  // v5 quita onSuccess/onError de useQuery: los mismos cuerpos, como efectos
  useEffect(() => {
    if (!data) return;
    if (router.pathname === Routes.verifyLicense) {
      router.replace(Routes.dashboard);
    }
    if (router.pathname === Routes.verifyEmail) {
      setEmailVerified(true);
      router.replace(Routes.dashboard);
    }
  }, [data]);

  useEffect(() => {
    if (!error) return;
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 417) {
        router.replace(Routes.verifyLicense);
        return;
      }

      if (error.response?.status === 409) {
        setEmailVerified(false);
        router.replace(Routes.verifyEmail);
        return;
      }
      queryClient.clear();
      router.replace(Routes.login);
    }
  }, [error]);

  return query;
};

export function useLogin() {
  return useMutation({ mutationFn: userClient.login });
}

export const useLogoutMutation = () => {
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: userClient.logout,
    onSuccess: () => {
      Cookies.remove(AUTH_CRED);
      router.replace(Routes.login);
      toast.success(t('common:successfully-logout'), {
        toastId: 'logoutSuccess',
      });
    },
  });
};

export const useRegisterMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: userClient.register,
    onSuccess: () => {
      toast.success(t('common:successfully-register'), {
        toastId: 'successRegister',
      });
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.REGISTER] });
    },
  });
};

export const useUpdateUserMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userClient.update,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ME] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS] });
    },
  });
};
export const useUpdateUserEmailMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userClient.updateEmail,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    onError: (error) => {
      const {
        response: { data },
      }: any = error ?? {};

      toast.error(data?.message);
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ME] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS] });
    },
  });
};

export const useChangePasswordMutation = () => {
  return useMutation({ mutationFn: userClient.changePassword });
};

export const useForgetPasswordMutation = () => {
  return useMutation({ mutationFn: userClient.forgetPassword });
};
export const useResendVerificationEmail = () => {
  const { t } = useTranslation('common');
  return useMutation({
    mutationFn: userClient.resendVerificationEmail,
    onSuccess: () => {
      toast.success(t('common:PICKBAZAR_MESSAGE.EMAIL_SENT_SUCCESSFUL'));
    },
    onError: () => {
      toast(t('common:PICKBAZAR_MESSAGE.EMAIL_SENT_FAILED'));
    },
  });
};

export const useLicenseKeyMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: userClient.addLicenseKey,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
      setTimeout(() => {
        router.reload();
      }, 1000);
    },
    onError: () => {
      toast.error(t('common:PICKBAZAR_MESSAGE.INVALID_LICENSE_KEY'));
    },
  });
};

export const useVerifyForgetPasswordTokenMutation = () => {
  return useMutation({ mutationFn: userClient.verifyForgetPasswordToken });
};

export const useResetPasswordMutation = () => {
  return useMutation({ mutationFn: userClient.resetPassword });
};

export const useMakeOrRevokeAdminMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: userClient.makeAdmin,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS] });
    },
  });
};

export const useBlockUserMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: userClient.block,
    onSuccess: () => {
      toast.success(t('common:successfully-block'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.STAFFS] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ADMIN_LIST] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.CUSTOMERS] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.VENDORS_LIST] });
    },
  });
};

export const useUnblockUserMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: userClient.unblock,
    onSuccess: () => {
      toast.success(t('common:successfully-unblock'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.STAFFS] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ADMIN_LIST] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.CUSTOMERS] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.VENDORS_LIST] });
    },
  });
};

export const useAddWalletPointsMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userClient.addWalletPoints,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.USERS] });
    },
  });
};

export const useUserQuery = ({ id }: { id: string }) => {
  return useQuery<User, Error>({
    queryKey: [API_ENDPOINTS.USERS, id],
    queryFn: () => userClient.fetchUser({ id }),
    enabled: Boolean(id),
  });
};

export const useUsersQuery = (params: Partial<QueryOptionsType>) => {
  const { data, isLoading, error } = useQuery<UserPaginator, Error>({
    queryKey: [API_ENDPOINTS.USERS, params],
    queryFn: () => userClient.fetchUsers(params),
    placeholderData: keepPreviousData,
  });

  return {
    users: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data as any),
    loading: isLoading,
    error,
  };
};

export const useAdminsQuery = (params: Partial<QueryOptionsType>) => {
  const { data, isLoading, error } = useQuery<UserPaginator, Error>({
    queryKey: [API_ENDPOINTS.ADMIN_LIST, params],
    queryFn: () => userClient.fetchAdmins(params),
    placeholderData: keepPreviousData,
  });

  return {
    admins: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data as any),
    loading: isLoading,
    error,
  };
};

export const useVendorsQuery = (params: Partial<UserQueryOptions>) => {
  const { data, isLoading, error } = useQuery<UserPaginator, Error>({
    queryKey: [API_ENDPOINTS.VENDORS_LIST, params],
    queryFn: () => userClient.fetchVendors(params),
    placeholderData: keepPreviousData,
  });

  return {
    vendors: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data as any),
    loading: isLoading,
    error,
  };
};

export const useCustomersQuery = (params: Partial<UserQueryOptions>) => {
  const { data, isLoading, error } = useQuery<UserPaginator, Error>({
    queryKey: [API_ENDPOINTS.CUSTOMERS, params],
    queryFn: () => userClient.fetchCustomers(params),
    placeholderData: keepPreviousData,
  });

  return {
    customers: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data as any),
    loading: isLoading,
    error,
  };
};

export const useMyStaffsQuery = (
  params: Partial<UserQueryOptions & { shop_id: string }>,
) => {
  const { data, isLoading, error } = useQuery<UserPaginator, Error>({
    queryKey: [API_ENDPOINTS.MY_STAFFS, params],
    queryFn: () => userClient.getMyStaffs(params),
    placeholderData: keepPreviousData,
  });

  return {
    myStaffs: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data as any),
    loading: isLoading,
    error,
  };
};

export const useAllStaffsQuery = (params: Partial<UserQueryOptions>) => {
  const { data, isLoading, error } = useQuery<UserPaginator, Error>({
    queryKey: [API_ENDPOINTS.ALL_STAFFS, params],
    queryFn: () => userClient.getAllStaffs(params),
    placeholderData: keepPreviousData,
  });

  return {
    allStaffs: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data as any),
    loading: isLoading,
    error,
  };
};
