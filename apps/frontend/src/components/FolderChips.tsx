import { Pencil, Plus, Trash2, Folder as FolderIcon } from "lucide-react";
import type { Folder } from "../types";

interface FolderChipsProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelect: (id: string) => void;
  onRename: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
  onAdd: () => void;
}

export function FolderChips({
  folders,
  activeFolderId,
  onSelect,
  onRename,
  onDelete,
  onAdd,
}: FolderChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {folders.map((folder) => {
        const active = folder.id === activeFolderId;
        return (
          <div
            key={folder.id}
            className={`group relative inline-flex items-center rounded-full text-xs font-semibold transition-all duration-200 ${
              active
                ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25 border border-white/20"
                : "bg-white/[0.07] border border-white/15 text-white/80 hover:text-white hover:bg-white/[0.14] hover:border-white/25"
            }`}
          >
            {/* Main Selection Button */}
            <button
              type="button"
              onClick={() => onSelect(folder.id)}
              className="inline-flex items-center gap-2 px-3.5 py-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-full"
            >
              <FolderIcon className={`w-3.5 h-3.5 ${active ? "text-white" : "text-indigo-400"}`} />
              <span>{folder.name}</span>
            </button>

            {/* Action Buttons (Rename / Delete) */}
            <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <button
                type="button"
                title={`Rename ${folder.name}`}
                aria-label={`Rename ${folder.name}`}
                className="p-1 rounded-full text-white/60 hover:text-white hover:bg-white/20 transition cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(folder);
                }}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                title={`Delete ${folder.name}`}
                aria-label={`Delete ${folder.name}`}
                className="p-1 rounded-full text-white/60 hover:text-red-300 hover:bg-red-500/20 transition cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(folder);
                }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}

      {/* Add New Folder Button */}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/[0.04] border border-dashed border-white/20 text-white/70 hover:text-white hover:border-indigo-400/80 hover:bg-indigo-400/10 transition-all duration-200 cursor-pointer active:scale-95"
      >
        <Plus className="w-3.5 h-3.5 text-indigo-400" />
        <span>Folder</span>
      </button>
    </div>
  );
}
