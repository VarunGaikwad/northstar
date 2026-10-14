import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiMessage } from "../client";
import { currentUserId, readPersistentCache, writePersistentCache } from "../persistentCache";
import { queryClient } from "../queryClient";
import type { FavLink, Folder } from "../types";

const FRESH_FOR = 5 * 60_000;

function foldersQueryKey(userId: string) {
  return ["folders", userId] as const;
}

async function fetchFolders(userId: string): Promise<Folder[]> {
  const data = await apiGet<Folder[]>("/folders");
  writePersistentCache("folders", data, userId);
  return data;
}

export function useFolders() {
  const userId = currentUserId();
  return useQuery({
    queryKey: foldersQueryKey(userId ?? "anonymous"),
    queryFn: () => fetchFolders(userId!),
    initialData: () => readPersistentCache<Folder[]>("folders", userId)?.data,
    initialDataUpdatedAt: () => readPersistentCache<Folder[]>("folders", userId)?.updatedAt,
    staleTime: FRESH_FOR,
    enabled: Boolean(userId),
  });
}

export function useFolder(id: string) {
  const { data: folders = [], ...query } = useFolders();
  return { ...query, data: folders.find((folder) => folder.id === id) };
}

function saveFolders(userId: string, folders: Folder[]): void {
  queryClient.setQueryData(foldersQueryKey(userId), folders);
  writePersistentCache("folders", folders, userId);
}

function invalidateFolders(): void {
  const userId = currentUserId();
  if (userId) void queryClient.invalidateQueries({ queryKey: foldersQueryKey(userId) });
}

export function useCreateFolder() {
  return useMutation({
    mutationFn: (body: { name: string; parentId?: string | null }) => apiPost<Folder>("/folders", body),
    onSuccess: (folder) => {
      const userId = currentUserId();
      if (userId) saveFolders(userId, [...(queryClient.getQueryData<Folder[]>(foldersQueryKey(userId)) ?? []), folder]);
      invalidateFolders();
    },
  });
}

export function useUpdateFolder() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; parentId?: string | null }) =>
      apiPatch<Folder>(`/folders/${id}`, body),
    onSuccess: (folder) => {
      const userId = currentUserId();
      if (userId) saveFolders(userId, (queryClient.getQueryData<Folder[]>(foldersQueryKey(userId)) ?? []).map((item) => item.id === folder.id ? folder : item));
      invalidateFolders();
    },
  });
}

export function useDeleteFolder() {
  return useMutation({
    mutationFn: (id: string) => apiMessage(`/folders/${id}`, "DELETE"),
    onSuccess: (_, id) => {
      const userId = currentUserId();
      if (userId) {
        saveFolders(userId, (queryClient.getQueryData<Folder[]>(foldersQueryKey(userId)) ?? []).filter((folder) => folder.id !== id));
        const favlinksKey = ["favlinks", userId, "all"] as const;
        const links = (queryClient.getQueryData<FavLink[]>(favlinksKey) ?? []).filter((link) => link.folderId !== id);
        queryClient.setQueryData(favlinksKey, links);
        writePersistentCache("favlinks", links, userId);
      }
      invalidateFolders();
      void queryClient.invalidateQueries({ queryKey: ["favlinks"] });
    },
  });
}
