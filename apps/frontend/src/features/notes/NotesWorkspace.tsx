import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import {
  AlertCircle,
  Archive,
  Images,
  LoaderCircle,
  NotebookPen,
  Pin,
  Plus,
  RefreshCw,
  ShieldCheck,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import {
  cacheNote,
  messageForNotesError,
  invalidateNoteLists,
  notesApi,
  notesKeys,
  removeCachedNote,
  useCreateNote,
  useNote,
  useNotes,
} from "../../api/endpoints/notes";
import type { Note, NoteView } from "../../api/types";
import { currentUserId } from "../../api/persistentCache";
import { HttpError } from "../../api/client";
import { queryClient } from "../../api/queryClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../auth/useAuth";
import { Badge, Button, IconButton, Skeleton } from "../../components/ui";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";
import { noteColorOption } from "./noteColors";

interface NotesWorkspaceProps {
  onClose: () => void;
}

interface ViewOption {
  value: NoteView;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

const VIEW_OPTIONS: ViewOption[] = [
  {
    value: "active",
    label: "Notes",
    description: "Current and pinned",
    icon: StickyNote,
  },
  {
    value: "archived",
    label: "Archive",
    description: "Put away for later",
    icon: Archive,
  },
  {
    value: "trash",
    label: "Trash",
    description: "Restore or delete",
    icon: Trash2,
  },
];

const noteDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function NoteCard({
  note,
  selected,
  onSelect,
  selecting,
  checked,
  disabled,
  onToggle,
  onDelete,
}: {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  selecting: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const color = noteColorOption(note.color);

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        {selecting ? (
          <input
            type="checkbox"
            aria-label={`Select ${note.title || "Untitled note"}`}
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            className="h-5 w-5 cursor-pointer accent-indigo-500"
          />
        ) : (
          <IconButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={`${note.trashedAt ? "Permanently delete" : "Delete"} ${note.title || "Untitled note"}`}
            variant="danger"
            size="sm"
            disabled={disabled}
            onClick={onDelete}
          />
        )}
      </div>
      <button
        type="button"
        aria-pressed={selecting ? checked : selected}
        disabled={disabled}
        onClick={selecting ? onToggle : onSelect}
        className={`group w-full rounded-2xl border p-4 pr-12 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          color.surface
        } ${
          (selecting ? checked : selected)
            ? "border-indigo-400/70 shadow-[0_0_0_1px_rgba(129,140,248,0.25),0_12px_28px_rgba(0,0,0,0.25)]"
            : "hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.09]"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-white/95">
                {note.title || "Untitled note"}
              </h3>
              {note.isPinned && (
                <Pin className="h-3.5 w-3.5 shrink-0 fill-indigo-300/20 text-indigo-300" />
              )}
            </div>
            <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-white/50">
              {note.content || "No content yet"}
            </p>
          </div>
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${color.swatch}`} />
        </div>

        <div className="mt-4 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
          <span>{noteDateFormatter.format(new Date(note.updatedAt))}</span>
          {note.images.length > 0 && (
            <span className="flex items-center gap-1">
              <Images className="h-3 w-3" />
              {note.images.length}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

function ViewSwitcher({
  view,
  onChange,
  compact = false,
}: {
  view: NoteView;
  onChange: (view: NoteView) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/15 p-1">
        {VIEW_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={view === option.value}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors ${
                view === option.value
                  ? "bg-indigo-500 text-white shadow-md shadow-indigo-950/30"
                  : "text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <nav aria-label="Note views" className="space-y-1.5">
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-current={view === option.value ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
              view === option.value
                ? "border-indigo-400/30 bg-indigo-500/15 text-white"
                : "border-transparent text-white/55 hover:border-white/10 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                view === option.value ? "bg-indigo-500/25" : "bg-white/5"
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block truncate text-[10px] text-white/35">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function SelectedNote({
  noteId,
  ownerUserId,
  editorRef,
  onBack,
  onLeave,
}: {
  noteId: string;
  ownerUserId: string;
  editorRef: RefObject<NoteEditorHandle | null>;
  onBack: () => void;
  onLeave: () => void;
}) {
  const noteQuery = useNote(noteId);

  if (
    noteQuery.isLoading ||
    (noteQuery.isFetching && !noteQuery.isFetchedAfterMount)
  ) {
    return (
      <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-5 h-4 w-full" />
        <Skeleton className="mt-3 h-4 w-5/6" />
        <Skeleton variant="rectangular" className="mt-8 h-52" />
      </div>
    );
  }

  if (!noteQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/[0.07] p-8 text-center">
        <AlertCircle className="h-8 w-8 text-red-300" />
        <h3 className="mt-3 text-sm font-semibold text-white">Unable to open note</h3>
        <p className="mt-1 max-w-sm text-xs leading-5 text-white/50">
          {messageForNotesError(noteQuery.error)}
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void noteQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <NoteEditor
      ref={editorRef}
      key={noteId}
      initialNote={noteQuery.data}
      ownerUserId={ownerUserId}
      onBack={onBack}
      onLeave={onLeave}
    />
  );
}

export function NotesWorkspace({ onClose }: NotesWorkspaceProps) {
  const { user } = useAuth();
  const [view, setView] = useState<NoteView>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<Note[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditorHandle>(null);
  const navigationLockedRef = useRef(false);
  const notesQuery = useNotes(view);
  const createNote = useCreateNote();
  const notes = notesQuery.data?.pages.flatMap((page) => page.notes) ?? [];
  const activeOption = VIEW_OPTIONS.find((option) => option.value === view)!;
  const ownerUserId = user?.id ?? "anonymous";

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    workspaceRef.current
      ?.querySelector<HTMLElement>('[aria-label="Close notes"]')
      ?.focus();
    return () => previousFocus?.focus();
  }, []);

  async function requestNavigation(
    action: () => void | Promise<void>,
  ): Promise<void> {
    if (navigationLockedRef.current) return;
    navigationLockedRef.current = true;
    try {
      const canLeave =
        !selectedId ||
        !editorRef.current ||
        (await editorRef.current.prepareToLeave());
      if (canLeave) await action();
    } finally {
      navigationLockedRef.current = false;
    }
  }

  function changeView(nextView: NoteView): void {
    if (nextView === view) return;
    void requestNavigation(() => {
      startTransition(() => {
        setView(nextView);
        setSelectedId(null);
        setCreateError(null);
        setSelecting(false);
        setCheckedIds(new Set());
      });
    });
  }

  function toggleChecked(noteId: string): void {
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function requestDelete(targets: Note[]): void {
    if (!targets.length || deleting) return;
    if (view === "trash") setDeleteTargets(targets);
    else void deleteNotes(targets);
  }

  async function deleteNotes(targets: Note[]): Promise<void> {
    await requestNavigation(async () => {
      setDeleting(true);
      setCreateError(null);
      // Unmount the editor after flushing its draft so autosave cannot race deletion.
      setSelectedId(null);
      const failures: string[] = [];
      try {
        for (const target of targets) {
          if (currentUserId() !== ownerUserId) break;
          const cached = queryClient.getQueryData<Note>(notesKeys.detail(ownerUserId, target.id));
          const latest = cached && cached.version > target.version ? cached : target;
          try {
            if (view === "trash") {
              await notesApi.permanentlyDelete(latest.id, latest.version);
            } else {
              await notesApi.trash(latest.id, latest.version);
            }
            removeCachedNote(latest.id, ownerUserId);
            setCheckedIds((previous) => {
              const next = new Set(previous);
              next.delete(latest.id);
              return next;
            });
          } catch (error) {
            if (error instanceof HttpError && error.status === 412) {
              try {
                const refreshed = await notesApi.get(target.id);
                cacheNote(refreshed, ownerUserId);
                failures.push("This note changed elsewhere. Review the updated note and delete again.");
              } catch (refreshError) {
                failures.push(`Could not refresh the changed note. ${messageForNotesError(refreshError)}`);
              }
            } else {
              failures.push(messageForNotesError(error));
            }
          }
        }
        if (failures.length) {
          invalidateNoteLists(ownerUserId);
          setCreateError(`${failures.length} note(s) could not be deleted. ${failures[0]}`);
        }
      } finally {
        setDeleting(false);
      }
    });
  }

  async function handleCreate(): Promise<void> {
    await requestNavigation(async () => {
      setCreateError(null);
      try {
        const created = await createNote.mutateAsync({});
        startTransition(() => {
          setView("active");
          setSelectedId(created.id);
          setSelecting(false);
          setCheckedIds(new Set());
        });
      } catch (error) {
        setCreateError(messageForNotesError(error));
      }
    });
  }

  function handleWorkspaceKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const target = event.target;
    const closestDialog =
      target instanceof Element ? target.closest('[role="dialog"]') : null;
    if (closestDialog && closestDialog.id !== "notes-workspace") return;

    if (event.key === "Escape") {
      event.preventDefault();
      void requestNavigation(onClose);
      return;
    }
    if (event.key !== "Tab") return;

    const selector =
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(
      workspaceRef.current?.querySelectorAll<HTMLElement>(selector) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={workspaceRef}
      id="notes-workspace"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-workspace-title"
      className="fixed inset-0 z-40 bg-slate-950/75 p-2 backdrop-blur-xl animate-fade-up sm:p-4 lg:p-6"
      onKeyDown={handleWorkspaceKeyDown}
    >
      <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-900/88 shadow-[0_28px_90px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-2xl">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4 sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/25 to-violet-500/15 text-indigo-300">
            <NotebookPen className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1
              id="notes-workspace-title"
              className="truncate text-base font-bold tracking-tight text-white sm:text-lg"
            >
              Notes
            </h1>
            <p className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-white/35 sm:block">
              Private workspace · Autosaved
            </p>
          </div>

          <Button
            variant="primary"
            size="sm"
            isLoading={createNote.isPending}
            disabled={deleting}
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => void handleCreate()}
          >
            <span className="hidden sm:inline">New note</span>
            <span className="sm:hidden">New</span>
          </Button>
          <IconButton
            icon={<X className="h-4 w-4" />}
            label="Close notes"
            variant="glass"
            size="sm"
            onClick={() => void requestNavigation(onClose)}
          />
        </header>

        <fieldset disabled={deleting} className="flex min-h-0 min-w-0 flex-1 border-0 p-0">
          <aside className="hidden w-52 shrink-0 flex-col border-r border-white/10 bg-black/10 p-4 lg:flex">
            <ViewSwitcher view={view} onChange={changeView} />
            <div className="mt-auto rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.07] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                <ShieldCheck className="h-4 w-4" />
                Private by default
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-white/35">
                Image links are short-lived and are never persisted in Northstar's client cache.
              </p>
            </div>
          </aside>

          <section
            aria-label={`${activeOption.label} list`}
            className={`${
              selectedId ? "hidden md:flex" : "flex"
            } min-h-0 w-full shrink-0 flex-col border-r border-white/10 bg-slate-950/20 md:w-[330px] lg:w-[360px]`}
          >
            <div className="shrink-0 space-y-3 border-b border-white/10 p-3 lg:hidden">
              <ViewSwitcher view={view} onChange={changeView} compact />
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-white/90">{activeOption.label}</h2>
                <p className="text-[10px] text-white/35">
                  {notesQuery.isLoading
                    ? "Loading notes"
                    : `${notes.length} loaded${notesQuery.hasNextPage ? "+" : ""}`}
                </p>
              </div>
              {notesQuery.isFetching && !notesQuery.isFetchingNextPage && (
                <LoaderCircle className="h-4 w-4 animate-spin text-indigo-300" />
              )}
            </div>

            {(createError || notesQuery.error) && (
              <div role="alert" className="mx-3 mb-3 flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-xs text-red-100">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  {createError ?? messageForNotesError(notesQuery.error)}
                </span>
                {notesQuery.error && (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-white/10 px-2 py-1 font-semibold text-white/80 hover:bg-white/15 hover:text-white"
                    onClick={() => void notesQuery.refetch()}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              <Button variant="ghost" size="sm" onClick={() => {
                void requestNavigation(() => {
                  setSelectedId(null);
                  setSelecting(!selecting);
                  setCheckedIds(new Set());
                });
              }}>
                {selecting ? "Cancel selection" : "Select notes"}
              </Button>
              {selecting && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => {
                    const allChecked = notes.length > 0 && notes.every((note) => checkedIds.has(note.id));
                    setCheckedIds(allChecked ? new Set() : new Set(notes.map((note) => note.id)));
                  }}>
                    {notes.length > 0 && notes.every((note) => checkedIds.has(note.id)) ? "Deselect all" : "Select all loaded"}
                  </Button>
                  <Button variant="danger" size="sm" disabled={!checkedIds.size} isLoading={deleting}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => requestDelete(notes.filter((note) => checkedIds.has(note.id)))}>
                    Delete selected ({notes.filter((note) => checkedIds.has(note.id)).length})
                  </Button>
                </>
              )}
            </div>

            <div aria-busy={deleting} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {notesQuery.isLoading && (
                <div className="space-y-3">
                  <Skeleton variant="rectangular" className="h-32" />
                  <Skeleton variant="rectangular" className="h-32" />
                  <Skeleton variant="rectangular" className="h-32" />
                </div>
              )}

              {!notesQuery.isLoading && !notesQuery.error && notes.length === 0 && (
                <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/30">
                    <activeOption.icon className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-white/75">
                    No {activeOption.label.toLowerCase()} here
                  </h3>
                  <p className="mt-1 max-w-[220px] text-xs leading-5 text-white/35">
                    {view === "active"
                      ? "Create a note and your work will save automatically."
                      : view === "archived"
                        ? "Archived notes will stay organized here."
                        : "Notes moved to trash can be restored or permanently deleted."}
                  </p>
                  {view === "active" && (
                    <Button
                      className="mt-4"
                      variant="secondary"
                      size="sm"
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                      isLoading={createNote.isPending}
                      onClick={() => void handleCreate()}
                    >
                      Create first note
                    </Button>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {notes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    selected={selectedId === note.id}
                    selecting={selecting}
                    checked={checkedIds.has(note.id)}
                    disabled={deleting}
                    onToggle={() => toggleChecked(note.id)}
                    onDelete={() => requestDelete([note])}
                    onSelect={() => {
                      if (selectedId !== note.id) {
                        void requestNavigation(() => setSelectedId(note.id));
                      }
                    }}
                  />
                ))}
              </div>

              {notesQuery.hasNextPage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-4 w-full"
                  isLoading={notesQuery.isFetchingNextPage}
                  onClick={() => void notesQuery.fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          </section>

          <main
            className={`${
              selectedId ? "flex" : "hidden md:flex"
            } min-h-0 min-w-0 flex-1 flex-col p-2 sm:p-3 lg:p-4`}
          >
            {selectedId ? (
              <SelectedNote
                noteId={selectedId}
                ownerUserId={ownerUserId}
                editorRef={editorRef}
                onBack={() =>
                  void requestNavigation(() => setSelectedId(null))
                }
                onLeave={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-gradient-to-br from-white/[0.035] to-transparent p-8 text-center">
                <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-indigo-400/15 bg-indigo-500/[0.08] text-indigo-300/70">
                  <NotebookPen className="h-9 w-9" />
                  <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-800 text-white/50">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                </div>
                <h2 className="mt-5 text-lg font-semibold text-white/80">Capture what matters</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-white/35">
                  Select a note from the list or create a new one. Changes are versioned and saved as you type.
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <Badge variant="primary" size="sm">Autosave</Badge>
                  <Badge variant="neutral" size="sm">Private images</Badge>
                </div>
              </div>
            )}
          </main>
        </fieldset>
      </div>
      <ConfirmDialog
        open={deleteTargets !== null}
        message={`Permanently delete ${deleteTargets?.length ?? 0} note(s) and their images? This cannot be undone.`}
        onCancel={() => setDeleteTargets(null)}
        onConfirm={() => {
          const targets = deleteTargets;
          setDeleteTargets(null);
          if (targets) void deleteNotes(targets);
        }}
      />
    </div>
  );
}
