import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/data/client/api-endpoints';
import { uploadClient } from '@/data/client/upload';

export const useUploadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: any) => {
      return uploadClient.upload(input);
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SETTINGS] });
    },
  });
};
