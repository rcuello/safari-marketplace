import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next/pages';
import { API_ENDPOINTS } from './client/api-endpoints';
import { settingsClient } from './client/settings';
import { useSettings } from '@/contexts/settings.context';
import { Settings } from '@/types';
import {
  getMaintenanceDetails,
  setMaintenanceDetails,
} from '@/utils/maintenance-utils';

export const useUpdateSettingsMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { updateSettings } = useSettings();

  return useMutation({
    mutationFn: settingsClient.update,
    onError: (error) => {
      console.log(error);
    },
    onSuccess: (data) => {
      updateSettings(data?.options);
      setMaintenanceDetails(
        data?.options?.maintenance?.isUnderMaintenance,
        data?.options?.maintenance,
      );
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SETTINGS] });
    },
  });
};

export const useSettingsQuery = ({ language }: { language: string }) => {
  const { data, error, isLoading } = useQuery<Settings, Error>({
    queryKey: [API_ENDPOINTS.SETTINGS, { language }],
    queryFn: () => settingsClient.all({ language }),
  });

  return {
    settings: data,
    error,
    loading: isLoading,
  };
};
