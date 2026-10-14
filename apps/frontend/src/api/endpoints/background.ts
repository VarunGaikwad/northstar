import { useQuery } from "@tanstack/react-query";
import { apiPublicGet } from "../client";
import type { BackgroundResponse } from "../types";

export function useBackground() {
  return useQuery({
    queryKey: ["background"],
    queryFn: () => apiPublicGet<BackgroundResponse>("/background"),
    staleTime: 3_600_000,
  });
}
