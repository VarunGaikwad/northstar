import { useMemo } from "react";
import { useAllFavLinks } from "../api/endpoints/favlinks";
import { useFolders } from "../api/endpoints/folders";
import type { FavLink } from "../types";
import { prettyUrl } from "../utils/gradients";

export interface FavLinkSearchResult extends FavLink {
  folderName?: string;
  displayHost: string;
}

export function useFavLinkSearch(query: string) {
  const { data: allLinks, isLoading: linksLoading } = useAllFavLinks();
  const { data: folders } = useFolders();

  const folderMap = useMemo(() => {
    const map = new Map<string, string>();
    if (folders) {
      folders.forEach((f) => map.set(f.id, f.name));
    }
    return map;
  }, [folders]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !allLinks) return [];

    const results: { item: FavLinkSearchResult; score: number }[] = [];

    for (const link of allLinks) {
      const titleLower = (link.title || "").toLowerCase();
      const host = prettyUrl(link.url || "").toLowerCase();
      const urlLower = (link.url || "").toLowerCase();
      const folderName = link.folderId ? folderMap.get(link.folderId) : undefined;
      const folderLower = (folderName || "").toLowerCase();

      let score = -1;

      if (titleLower.startsWith(q)) {
        score = 100 - Math.min(titleLower.length - q.length, 20); // Exact prefix match
      } else if (titleLower.includes(q)) {
        score = 80; // Substring title match
      } else if (host.startsWith(q)) {
        score = 70; // Hostname prefix match
      } else if (host.includes(q) || urlLower.includes(q)) {
        score = 50; // Hostname/URL substring match
      } else if (folderLower.includes(q)) {
        score = 30; // Folder name match
      }

      if (score > 0) {
        results.push({
          item: {
            ...link,
            folderName,
            displayHost: prettyUrl(link.url),
          },
          score,
        });
      }
    }

    // Sort by relevance score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 6).map((r) => r.item);
  }, [query, allLinks, folderMap]);

  return {
    matches,
    isLoading: linksLoading,
  };
}
