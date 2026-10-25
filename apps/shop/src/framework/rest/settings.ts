import type { Settings, SettingsQueryOptions } from '@/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import { getPreviewImage } from '@/lib/get-preview-image';
import { useAtom } from 'jotai';
import { couponAtom } from '@/store/checkout';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { setMaintenanceDetails } from './utils/maintenance-utils';

export function useSettings() {
  const { locale } = useRouter();

  const formattedOptions = {
    language: locale,
  };

  const { data, isLoading, error, isFetching } = useQuery<Settings, Error>({
    queryKey: [API_ENDPOINTS.SETTINGS, formattedOptions],
    queryFn: ({ queryKey }) =>
      client.settings.all(
        Object.assign({}, queryKey[1] as SettingsQueryOptions),
      ),
  });
  const { isUnderMaintenance = false, maintenance = {} } = data?.options! ?? {};
  setMaintenanceDetails(isUnderMaintenance, maintenance);
  return {
    settings: data?.options ?? {},
    isLoading,
    error,
    isFetching,
  };
}

export const useUploads = ({ onChange, defaultFiles }: any) => {
  const [files, setFiles] = useState<FileWithPath[]>(
    getPreviewImage(defaultFiles),
  );

  const { mutate: upload, isPending: isLoading } = useMutation({
    mutationFn: client.settings.upload,
    onSuccess: (data) => {
      if (onChange) {
        const dataAfterRemoveTypename = data?.map(
          ({ __typename, ...rest }: any) => rest,
        );
        onChange(dataAfterRemoveTypename);
        setFiles(getPreviewImage(dataAfterRemoveTypename));
      }
    },
  });

  function handleSubmit(data: File[]) {
    upload(data);
  }

  return { mutate: handleSubmit, isLoading, files };
};

export function useSubscription() {
  let [isSubscribed, setIsSubscribed] = useState(false);

  const subscription = useMutation({
    mutationFn: client.users.subscribe,
    onSuccess: () => {
      setIsSubscribed(true);
    },
    onError: () => {
      setIsSubscribed(false);
    },
  });

  return {
    ...subscription,
    isSubscribed,
  };
}

export function useVerifyCoupon() {
  const { t } = useTranslation();
  const [_, applyCoupon] = useAtom(couponAtom);
  let [formError, setFormError] = useState<any>(null);
  const { mutate, isPending: isLoading } = useMutation({
    mutationFn: client.coupons.verify,
    onSuccess: (data: any) => {
      if (!data.is_valid) {
        setFormError({
          code: t(`common:${data?.message}`),
        });
      }
      applyCoupon(data?.coupon);
    },
    onError: (error) => {
      const {
        response: { data },
      }: any = error ?? {};

      toast.error(data?.message);
    },
  });

  return { mutate, isLoading, formError, setFormError };
}
