import { useRouter } from 'next/router';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from './client/api-endpoints';
import {
  MessageQueryOptions,
  ConversionPaginator,
  ConversationQueryOptions,
  MessagePaginator,
  Conversations,
} from '@/types';
import { mapPaginatorData } from '@/utils/data-mappers';
import { conversationsClient } from './client/conversations';
import { useModalAction } from '@/components/ui/modal/modal.context';
import { adminOnly, getAuthCredentials, hasAccess } from '@/utils/auth-utils';

export const useConversationsQuery = (
  options: Partial<ConversationQueryOptions>
) => {
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isSuccess,
    isFetchingNextPage,
  } = useInfiniteQuery<ConversionPaginator, Error>({
    queryKey: [API_ENDPOINTS.CONVERSIONS, options],
    queryFn: ({ queryKey, pageParam }) =>
      conversationsClient.allConversation(
        Object.assign({}, queryKey[1], pageParam)
      ),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    if (Boolean(hasNextPage)) {
      fetchNextPage();
    }
  }

  return {
    conversations: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    loading: isLoading,
    error,
    isFetching,
    refetch,
    isSuccess,
    isLoadingMore: isFetchingNextPage,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
};

export const useCreateConversations = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { closeModal } = useModalAction();
  const queryClient = useQueryClient();
  const { permissions } = getAuthCredentials();
  let permission = hasAccess(adminOnly, permissions);
  return useMutation({
    mutationFn: conversationsClient.create,
    onSuccess: (data) => {
      if (data?.id) {
        const routes = permission
          ? Routes?.message?.details(data?.id)
          : Routes?.shopMessage?.details(data?.id);
        toast.success(t('common:successfully-created'));
        router.push(`${routes}`);
        closeModal();
      } else {
        toast.error('Something went wrong!');
      }
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MESSAGE] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.CONVERSIONS] });
    },
  });
};

export const useMessagesQuery = (options: Partial<MessageQueryOptions>) => {
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isSuccess,
    isFetchingNextPage,
  } = useInfiniteQuery<MessagePaginator, Error>({
    queryKey: [API_ENDPOINTS.MESSAGE, options],
    queryFn: ({ queryKey, pageParam }) =>
      conversationsClient.getMessage(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    if (Boolean(hasNextPage)) {
      fetchNextPage();
    }
  }

  return {
    messages: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    loading: isLoading,
    error,
    isFetching,
    refetch,
    isSuccess,
    isLoadingMore: isFetchingNextPage,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
};

export const useConversationQuery = ({ id }: { id: string }) => {
  const { data, error, isLoading, isFetching } = useQuery<Conversations, Error>(
    {
      queryKey: [API_ENDPOINTS.CONVERSIONS, id],
      queryFn: () => conversationsClient.getConversion({ id }),
      placeholderData: keepPreviousData,
    }
  );

  return {
    data: data ?? [],
    error,
    loading: isLoading,
    isFetching,
  };
};

export const useSendMessage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: conversationsClient.messageCreate,
    onSuccess: () => {
      toast.success(t('common:text-message-sent'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MESSAGE] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.CONVERSIONS] });
    },
  });
};

export const useMessageSeen = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: conversationsClient.messageSeen,
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MESSAGE] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.CONVERSIONS] });
    },
  });
};
