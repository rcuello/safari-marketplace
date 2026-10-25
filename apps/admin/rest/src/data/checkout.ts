import { useMutation } from '@tanstack/react-query';
import { checkoutClient } from '@/data/client/checkout';

export const useVerifyCheckoutMutation = () => {
  return useMutation({ mutationFn: checkoutClient.verify });
};
