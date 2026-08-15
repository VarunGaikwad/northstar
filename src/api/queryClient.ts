import { QueryClient } from "@tanstack/react-query";
import { HttpError } from "./client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        if (err instanceof HttpError && err.status >= 400 && err.status < 500) return false;
        return count < 1;
      },
    },
  },
});
