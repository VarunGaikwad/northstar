import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiMessage } from "../client";
import { currentUserId, readPersistentCache, writePersistentCache } from "../persistentCache";
import { queryClient } from "../queryClient";
import type { FavLink } from "../types";

const FRESH_FOR = 5 * 60_000;

function favlinksQueryKey(userId: string) {
  return ["favlinks", userId, "all"] as const;
}

async function fetchFavLinks(userId: string): Promise<FavLink[]> {
  const data = await apiGet<FavLink[]>("/favlinks");
  writePersistentCache("favlinks", data, userId);
  return data;
}

export function useAllFavLinks() {
  const userId = currentUserId();
  return useQuery({
    queryKey: favlinksQueryKey(userId ?? "anonymous"),
    queryFn: () => fetchFavLinks(userId!),
    initialData: () => readPersistentCache<FavLink[]>("favlinks", userId)?.data,
    initialDataUpdatedAt: () => readPersistentCache<FavLink[]>("favlinks", userId)?.updatedAt,
    staleTime: FRESH_FOR,
    enabled: Boolean(userId),
  });
}

export function useFavLinks(folderId?: string | null) {
  const allLinks = useAllFavLinks();
  return {
    ...allLinks,
    data: allLinks.data?.filter((link) => (folderId ? link.folderId === folderId : link.folderId === null)),
  };
}

function saveFavLinks(userId: string, links: FavLink[]): void {
  queryClient.setQueryData(favlinksQueryKey(userId), links);
  writePersistentCache("favlinks", links, userId);
}

function invalidateFavLinks(): void {
  const userId = currentUserId();
  if (userId) void queryClient.invalidateQueries({ queryKey: favlinksQueryKey(userId) });
}

export function useFavLink(id: string) {
  const { data: links = [], ...query } = useAllFavLinks();
  return { ...query, data: links.find((link) => link.id === id) };
}

export function useCreateFavLink() {
  return useMutation({
    mutationFn: (body: { title: string; url: string; folderId?: string | null }) => apiPost<FavLink>("/favlinks", body),
    onSuccess: (link) => {
      const userId = currentUserId();
      if (userId) saveFavLinks(userId, [...(queryClient.getQueryData<FavLink[]>(favlinksQueryKey(userId)) ?? []), link]);
      invalidateFavLinks();
    },
  });
}

export function useUpdateFavLink() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; url?: string; folderId?: string | null }) =>
      apiPatch<FavLink>(`/favlinks/${id}`, body),
    onSuccess: (link) => {
      const userId = currentUserId();
      if (userId) saveFavLinks(userId, (queryClient.getQueryData<FavLink[]>(favlinksQueryKey(userId)) ?? []).map((item) => item.id === link.id ? link : item));
      invalidateFavLinks();
    },
  });
}

export function useDeleteFavLink() {
  return useMutation({
    mutationFn: (id: string) => apiMessage(`/favlinks/${id}`, "DELETE"),
    onSuccess: (_, id) => {
      const userId = currentUserId();
      if (userId) saveFavLinks(userId, (queryClient.getQueryData<FavLink[]>(favlinksQueryKey(userId)) ?? []).filter((link) => link.id !== id));
      invalidateFavLinks();
    },
  });
}
