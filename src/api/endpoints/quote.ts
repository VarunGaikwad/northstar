import { useQuery } from "@tanstack/react-query";
import { apiPublicGet } from "../client";
import type { QuoteResponse } from "../types";

export function useQuote() {
  return useQuery({
    queryKey: ["quote"],
    queryFn: () => apiPublicGet<QuoteResponse>("/quote"),
    staleTime: 86_400_000,
  });
}
