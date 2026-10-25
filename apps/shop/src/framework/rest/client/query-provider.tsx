import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { AppProps } from 'next/app';

interface QueryProviderProps {
  pageProps: AppProps['pageProps'];
}

export default function QueryProvider({
  pageProps,
  children,
}: React.PropsWithChildren<QueryProviderProps>) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary
        state={
          //@ts-ignore
          pageProps.dehydratedState
        }
      >
        {children}
      </HydrationBoundary>
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
}
