import { loadStores } from './api';

export const storesQueryKey = ['stores'] as const;
export const storesStaleTimeMs = 5 * 60 * 1000;

export const storesQueryOptions = {
  queryKey: storesQueryKey,
  queryFn: loadStores,
  staleTime: storesStaleTimeMs,
  retry: false,
  retryOnMount: false,
  refetchOnMount: false
} as const;
