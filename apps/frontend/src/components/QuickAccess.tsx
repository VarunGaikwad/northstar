import { useEffect, useState } from "react";
import { Plus, Bookmark, FolderPlus, AlertCircle, LayoutGrid, List } from "lucide-react";
import {
  useCreateFavLink,
  useDeleteFavLink,
  useFavLinks,
  useUpdateFavLink,
} from "../api/endpoints/favlinks";
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useUpdateFolder,
} from "../api/endpoints/folders";
import { useLocalStorage } from "../hooks/useLocalStorage";
import type { FavLink, Folder } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FolderChips } from "./FolderChips";
import { FolderFormModal } from "./FolderFormModal";
import { LinkCard } from "./LinkCard";
import { LinkFormModal } from "./LinkFormModal";
import { Button, IconButton, Skeleton } from "./ui";

export function QuickAccess() {
  const { data: folders, isLoading: foldersLoading, error: foldersError } = useFolders();
  const [activeFolderId, setActiveFolderId] = useLocalStorage<string | null>(
    "dashboard.activeFolderId",
    null
  );
  const [viewMode, setViewMode] = useLocalStorage<"grid" | "list">(
    "dashboard.linksViewMode",
    "grid"
  );

  const folderList = folders ?? [];
  const validActiveId = folderList.some((f) => f.id === activeFolderId)
    ? activeFolderId
    : (folderList[0]?.id ?? null);

  useEffect(() => {
    if (activeFolderId !== validActiveId) {
      setActiveFolderId(validActiveId);
    }
  }, [activeFolderId, validActiveId, setActiveFolderId]);

  const {
    data: favlinks,
    isLoading: linksLoading,
    error: linksError,
  } = useFavLinks(validActiveId);

  const [folderModal, setFolderModal] = useState<{
    open: boolean;
    editing: Folder | null;
  }>({ open: false, editing: null });
  const [linkModal, setLinkModal] = useState<{
    open: boolean;
    editing: FavLink | null;
  }>({ open: false, editing: null });
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "folder"; folder: Folder }
    | { kind: "link"; link: FavLink }
    | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const createFavLink = useCreateFavLink();
  const updateFavLink = useUpdateFavLink();
  const deleteFavLink = useDeleteFavLink();

  const activeFolder = folderList.find((f) => f.id === validActiveId) ?? null;
  const links = favlinks ?? [];
  const error = foldersError?.message ?? linksError?.message ?? formError;

  const saveFolder = async (name: string) => {
    setFormError(null);
    try {
      if (folderModal.editing) {
        await updateFolder.mutateAsync({ id: folderModal.editing.id, name });
      } else {
        const folder = await createFolder.mutateAsync({ name });
        setActiveFolderId(folder.id);
      }
      setFolderModal({ open: false, editing: null });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save folder");
    }
  };

  const handleDeleteFolder = async () => {
    if (deleteTarget?.kind !== "folder") return;
    setFormError(null);
    try {
      await deleteFolder.mutateAsync(deleteTarget.folder.id);
      setDeleteTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete folder");
    }
  };

  const saveLink = async (title: string, url: string) => {
    if (!validActiveId) return;
    setFormError(null);
    try {
      if (linkModal.editing) {
        await updateFavLink.mutateAsync({
          id: linkModal.editing.id,
          title,
          url,
          folderId: validActiveId,
        });
      } else {
        await createFavLink.mutateAsync({ title, url, folderId: validActiveId });
      }
      setLinkModal({ open: false, editing: null });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save link");
    }
  };

  const handleDeleteLink = async () => {
    if (deleteTarget?.kind !== "link") return;
    setFormError(null);
    try {
      await deleteFavLink.mutateAsync(deleteTarget.link.id);
      setDeleteTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete link");
    }
  };

  const confirmMessage =
    deleteTarget?.kind === "folder"
      ? `Delete folder "${deleteTarget.folder.name}" and all its links?`
      : deleteTarget?.kind === "link"
        ? `Delete link "${deleteTarget.link.title}"?`
        : "";

  return (
    <div className="h-full min-h-0 flex flex-col rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 backdrop-blur-xl p-6 shadow-[0_12px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold flex items-center gap-2 text-white">
          <Bookmark className="w-5 h-5 text-indigo-400" />
          <span>Bookmarks & Links</span>
        </h2>
        
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex p-0.5 rounded-xl bg-white/[0.06] border border-white/10">
            <IconButton
              icon={<LayoutGrid className="w-3.5 h-3.5" />}
              label="Grid view"
              variant={viewMode === "grid" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
            />
            <IconButton
              icon={<List className="w-3.5 h-3.5" />}
              label="List view"
              variant={viewMode === "list" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FolderPlus className="w-3.5 h-3.5 text-indigo-400" />}
            onClick={() => setFolderModal({ open: true, editing: null })}
          >
            New Folder
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-500/15 border border-red-400/30 p-3 text-xs text-red-200 flex items-center gap-2 animate-fade-up">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Folder Filters */}
      {foldersLoading ? (
        <div className="flex gap-2 mb-6">
          <Skeleton variant="rectangular" className="h-8 w-24 rounded-full" />
          <Skeleton variant="rectangular" className="h-8 w-24 rounded-full" />
          <Skeleton variant="rectangular" className="h-8 w-24 rounded-full" />
        </div>
      ) : (
        <FolderChips
          folders={folderList}
          activeFolderId={validActiveId}
          onSelect={setActiveFolderId}
          onRename={(folder) => setFolderModal({ open: true, editing: folder })}
          onDelete={(folder) => setDeleteTarget({ kind: "folder", folder })}
          onAdd={() => setFolderModal({ open: true, editing: null })}
        />
      )}

      {/* Bookmark Grid / List Container */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto pr-1 ${
          viewMode === "grid"
            ? "grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3.5 content-start"
            : "space-y-2"
        }`}
      >
        {!activeFolder && !foldersLoading && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-center text-white/50 space-y-3">
            <Bookmark className="w-10 h-10 stroke-1 text-indigo-400/60" />
            <p className="text-sm">No bookmark folders yet. Create your first folder above.</p>
          </div>
        )}
        {linksLoading && activeFolder && (
          <>
            <Skeleton variant="rectangular" className="h-32 rounded-2xl" />
            <Skeleton variant="rectangular" className="h-32 rounded-2xl" />
            <Skeleton variant="rectangular" className="h-32 rounded-2xl" />
          </>
        )}
        {activeFolder &&
          !linksLoading &&
          links.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              viewMode={viewMode}
              onEdit={(l) => setLinkModal({ open: true, editing: l })}
              onDelete={(l) => setDeleteTarget({ kind: "link", link: l })}
            />
          ))}
        {activeFolder && !linksLoading && (
          <button
            type="button"
            onClick={() => setLinkModal({ open: true, editing: null })}
            className={`flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 text-white/70 text-xs font-semibold cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:text-white hover:border-indigo-400/80 hover:bg-indigo-500/10 hover:shadow-[0_0_20px_rgba(129,140,248,0.2)] active:scale-98 ${
              viewMode === "grid" ? "flex-col min-h-[130px]" : "p-3.5 w-full"
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-indigo-400">
              <Plus className="w-4 h-4" />
            </div>
            <span>Add Bookmark</span>
          </button>
        )}
      </div>

      <FolderFormModal
        open={folderModal.open}
        initialName={folderModal.editing?.name ?? null}
        onClose={() => setFolderModal({ open: false, editing: null })}
        onSave={saveFolder}
      />

      <LinkFormModal
        open={linkModal.open}
        link={linkModal.editing}
        onClose={() => setLinkModal({ open: false, editing: null })}
        onSave={saveLink}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        message={confirmMessage}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteTarget?.kind === "folder" ? handleDeleteFolder : handleDeleteLink}
      />
    </div>
  );
}
