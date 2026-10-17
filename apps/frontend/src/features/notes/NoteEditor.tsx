import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useState,
} from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  Check,
  ImagePlus,
  Images,
  LoaderCircle,
  Palette,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Note, NoteImage } from "../../api/types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import { Badge, Button, IconButton } from "../../components/ui";
import { NOTE_COLOR_OPTIONS, noteColorOption } from "./noteColors";
import { useNoteController, type NoteSaveState } from "./useNoteController";

interface NoteEditorProps {
  initialNote: Note;
  ownerUserId: string;
  onBack: () => void;
  onLeave: () => void;
}

export interface NoteEditorHandle {
  prepareToLeave: () => Promise<boolean>;
}

type ConfirmAction =
  | { type: "trash" }
  | { type: "permanent-delete" }
  | { type: "image"; imageId: string }
  | null;

const updatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatImageSize(sizeBytes: number): string {
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function saveStatus(state: NoteSaveState, version: number) {
  switch (state) {
    case "dirty":
      return { label: "Unsaved", variant: "neutral" as const, dot: true };
    case "saving":
      return { label: "Saving", variant: "primary" as const, dot: true };
    case "saved":
      return { label: "Saved", variant: "success" as const, dot: true };
    case "error":
      return { label: "Save failed", variant: "danger" as const, dot: true };
    case "conflict":
      return { label: "Conflict", variant: "warning" as const, dot: true };
    default:
      return { label: `Version ${version}`, variant: "neutral" as const, dot: false };
  }
}

function NoteImageCard({
  image,
  index,
  count,
  disabled,
  expired,
  alt,
  onMove,
  onDelete,
  onRefresh,
}: {
  image: NoteImage;
  index: number;
  count: number;
  disabled: boolean;
  expired: boolean;
  alt: string;
  onMove: (offset: -1 | 1) => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/35">
      <div className="relative aspect-[4/3] bg-black/20">
        {expired ? (
          <button
            type="button"
            onClick={onRefresh}
            className="absolute inset-0 flex w-full flex-col items-center justify-center gap-2 text-xs font-semibold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <RefreshCw className="h-5 w-5" />
            Refresh image
          </button>
        ) : (
          <img
            src={image.url}
            alt={alt}
            className="h-full w-full object-cover"
            onError={onRefresh}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-white/40">
          {formatImageSize(image.sizeBytes)}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            label="Move image earlier"
            size="sm"
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon={<ArrowDown className="h-3.5 w-3.5 rotate-[-90deg]" />}
            label="Move image later"
            size="sm"
            disabled={disabled || index === count - 1}
            onClick={() => onMove(1)}
          />
          <IconButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete image"
            variant="danger"
            size="sm"
            disabled={disabled}
            onClick={onDelete}
          />
        </div>
      </div>
    </article>
  );
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  function NoteEditor(
    { initialNote, ownerUserId, onBack, onLeave },
    ref,
  ) {
  const controller = useNoteController(initialNote, ownerUserId);
  const [showColors, setShowColors] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [now, setNow] = useState(() => Date.now());

  const isTrashed = controller.note.trashedAt !== null;
  const isArchived = controller.note.archivedAt !== null;
  const isLocked = controller.isBusy || controller.conflictBlocked;
  const controlsLocked =
    isLocked || controller.isUploading || controller.pendingImageConfirmation;
  const canEdit = !isTrashed && !isLocked;
  const color = noteColorOption(controller.note.color);
  const status = saveStatus(controller.saveState, controller.note.version);
  const images = [...controller.note.images].sort(
    (left, right) => left.position - right.position,
  );
  const expiredImageKey = images
    .filter((image) => Date.parse(image.urlExpiresAt) <= now)
    .map((image) => `${image.id}:${image.urlExpiresAt}`)
    .join("|");
  const refreshExpiredImages = useEffectEvent(() => {
    void controller.refreshImages().catch(() => undefined);
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (expiredImageKey) refreshExpiredImages();
  }, [expiredImageKey]);

  useImperativeHandle(ref, () => ({
    prepareToLeave: controller.prepareToLeave,
  }));

  function handleBack(): void {
    onBack();
  }

  async function runAndLeave(action: () => Promise<Note | null>): Promise<void> {
    try {
      const updated = await action();
      if (updated) onLeave();
    } catch {
      // The controller exposes the actionable error inline.
    }
  }

  function handleConfirm(): void {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;

    if (action.type === "trash") {
      void runAndLeave(controller.trash);
      return;
    }
    if (action.type === "permanent-delete") {
      void controller
        .permanentlyDelete()
        .then((deleted) => deleted && onLeave())
        .catch(() => undefined);
      return;
    }
    void controller.deleteImage(action.imageId).catch(() => undefined);
  }

  const confirmMessage =
    confirmAction?.type === "trash"
      ? "Move this note to trash? You can restore it until it is permanently deleted."
      : confirmAction?.type === "permanent-delete"
        ? "Permanently delete this note and all of its images? This cannot be undone."
        : confirmAction?.type === "image"
          ? "Delete this image from the note?"
          : "";

  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${color.surface}`}
    >
      <header className="shrink-0 border-b border-white/10 px-3 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <IconButton
            icon={<ArrowLeft className="h-4 w-4" />}
            label="Back to notes"
            size="sm"
            className="md:hidden"
            onClick={handleBack}
          />

          <div className="min-w-0 flex-1" aria-live="polite">
            <Badge
              variant={status.variant}
              size="sm"
              dot={status.dot}
              className="max-w-full"
            >
              {controller.busyLabel ?? status.label}
            </Badge>
          </div>

          {!isTrashed && (
            <IconButton
              icon={<Palette className="h-4 w-4" />}
              label="Choose note color"
              variant={showColors ? "primary" : "ghost"}
              size="sm"
              disabled={controlsLocked}
              onClick={() => setShowColors((visible) => !visible)}
            />
          )}

          {!isTrashed && !isArchived && (
            <IconButton
              icon={
                controller.note.isPinned ? (
                  <PinOff className="h-4 w-4" />
                ) : (
                  <Pin className="h-4 w-4" />
                )
              }
              label={controller.note.isPinned ? "Unpin note" : "Pin note"}
              variant={controller.note.isPinned ? "primary" : "ghost"}
              size="sm"
              disabled={controlsLocked}
              onClick={() => void controller.togglePin().catch(() => undefined)}
            />
          )}

          {!isTrashed && !isArchived && (
            <IconButton
              icon={<Archive className="h-4 w-4" />}
              label="Archive note"
              size="sm"
              disabled={controlsLocked}
              onClick={() => void runAndLeave(controller.archive)}
            />
          )}

          {!isTrashed && isArchived && (
            <IconButton
              icon={<ArchiveRestore className="h-4 w-4" />}
              label="Unarchive note"
              size="sm"
              disabled={controlsLocked}
              onClick={() => void runAndLeave(controller.unarchive)}
            />
          )}

          {!isTrashed && (
            <IconButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Move note to trash"
              variant="danger"
              size="sm"
              disabled={controlsLocked}
              onClick={() => setConfirmAction({ type: "trash" })}
            />
          )}

          {isTrashed && (
            <>
              <IconButton
                icon={<RotateCcw className="h-4 w-4" />}
                label="Restore note"
                variant="primary"
                size="sm"
                disabled={controlsLocked}
                onClick={() => void runAndLeave(controller.restore)}
              />
              <IconButton
                icon={<Trash2 className="h-4 w-4" />}
                label="Permanently delete note"
                variant="danger"
                size="sm"
                disabled={controlsLocked}
                onClick={() => setConfirmAction({ type: "permanent-delete" })}
              />
            </>
          )}
        </div>

        {showColors && !isTrashed && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-3 animate-fade-up">
            {NOTE_COLOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.label}
                aria-label={`${option.label} note color`}
                aria-pressed={controller.note.color === option.value}
                disabled={controlsLocked}
                onClick={() => {
                  setShowColors(false);
                  void controller.setColor(option.value).catch(() => undefined);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-full border transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:pointer-events-none disabled:opacity-50 ${
                  controller.note.color === option.value
                    ? "border-white/90 bg-white/15"
                    : "border-white/15 bg-black/10"
                }`}
              >
                <span className={`h-3.5 w-3.5 rounded-full ${option.swatch}`} />
              </button>
            ))}
          </div>
        )}
      </header>

      {controller.error && (
        <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/15 p-3 text-xs text-red-100 sm:mx-5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <span className="min-w-0 flex-1">{controller.error}</span>
          {controller.hasUnsavedChanges &&
            !controller.conflictBlocked &&
            !controller.pendingImageConfirmation && (
            <Button
              variant="ghost"
              size="sm"
              onClick={controller.discardDraft}
            >
              Discard draft
            </Button>
          )}
        </div>
      )}

      {controller.recoveredDraft && !controller.conflictBlocked && (
        <div className="mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100 sm:mx-5">
          <span>
            Recovered an unsaved draft from this tab. It will remain available until it saves or you discard it.
          </span>
          {!controller.pendingImageConfirmation && (
            <Button variant="ghost" size="sm" onClick={controller.discardDraft}>
              Discard
            </Button>
          )}
        </div>
      )}

      {controller.pendingImageConfirmation && !controller.conflictBlocked && (
        <div className="mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100 sm:mx-5">
          <span>The uploaded image still needs to be confirmed.</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={controller.isBusy}
            onClick={() => void controller.retryPendingImage()}
          >
            Retry
          </Button>
        </div>
      )}

      {isTrashed && (
        <div className="mx-3 mt-3 shrink-0 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 sm:mx-5">
          Trashed notes are read-only. Restore this note to edit it or manage images.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-[320px] flex-1 flex-col px-4 py-4 sm:px-7 sm:py-6">
          <input
            value={controller.draft.title}
            onChange={(event) => controller.setTitle(event.target.value)}
            onBlur={() => void controller.flush().catch(() => undefined)}
            disabled={!canEdit}
            aria-label="Note title"
            placeholder="Untitled note"
            className="w-full border-none bg-transparent text-2xl font-bold tracking-tight text-white outline-none placeholder:text-white/25 disabled:cursor-default disabled:opacity-80 sm:text-3xl"
          />
          <textarea
            value={controller.draft.content}
            onChange={(event) => controller.setContent(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length === 0) return;
              event.preventDefault();
              const available = Math.max(0, 10 - images.length);
              void (async () => {
                for (const file of files.slice(0, available)) {
                  try {
                    await controller.uploadImage(file);
                  } catch {
                    break;
                  }
                }
              })();
            }}
            aria-describedby="note-image-paste-hint"
            onBlur={() => void controller.flush().catch(() => undefined)}
            disabled={!canEdit}
            aria-label="Note content"
            placeholder="Start writing..."
            className="mt-4 min-h-0 w-full flex-1 resize-none border-none bg-transparent text-[15px] leading-7 text-white/85 outline-none placeholder:text-white/25 disabled:cursor-default disabled:opacity-80"
          />
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
            <span>{controller.draft.content.length.toLocaleString()} characters</span>
            <span>
              Updated {updatedAtFormatter.format(new Date(controller.note.updatedAt))}
            </span>
          </div>
        </div>

        <section className="shrink-0 border-t border-white/10 px-4 py-4 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Images className="h-4 w-4 text-indigo-300" />
              <h3 className="text-sm font-semibold text-white/85">Images</h3>
              <span id="note-image-paste-hint" className="text-[11px] text-white/35">
                {images.length}/10 · Paste an image with Ctrl+V
              </span>
            </div>

            {!isTrashed && (
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white ${
                  controlsLocked || images.length >= 10
                    ? "pointer-events-none opacity-50"
                    : ""
                }`}
              >
                {controller.isUploading ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {controller.isUploading ? "Uploading" : "Add image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={controlsLocked || images.length >= 10}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void controller.uploadImage(file).catch(() => undefined);
                  }}
                />
              </label>
            )}
          </div>

          {images.length === 0 ? (
            <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/10 px-4 text-center text-xs text-white/35">
              Add up to 10 JPEG, PNG, or WebP images, 10 MiB each.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {images.map((image, index) => (
                <NoteImageCard
                  key={image.id}
                  image={image}
                  index={index}
                  count={images.length}
                  disabled={controlsLocked || isTrashed}
                  expired={Date.parse(image.urlExpiresAt) <= now}
                  alt={`Attachment ${index + 1} for ${controller.note.title || "untitled note"}`}
                  onMove={(offset) =>
                    void controller.moveImage(image.id, offset).catch(() => undefined)
                  }
                  onDelete={() =>
                    setConfirmAction({ type: "image", imageId: image.id })
                  }
                  onRefresh={() =>
                    void controller.refreshImages().catch(() => undefined)
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        message={confirmMessage}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
      />

      <Modal
        open={controller.conflictBlocked}
        title="Resolve edit conflict"
        onClose={() => undefined}
        dismissible={false}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {controller.pendingImageConfirmation
                ? "The image was uploaded, but the note changed before it could be confirmed. Choose how to resolve the note and confirmation will be retried."
                : "This note changed in another session. Your draft is preserved and has not been resent."}
            </p>
          </div>
          {controller.conflict && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Latest server version
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-white/90">
                {controller.conflict.title || "Untitled note"}
              </p>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-white/55">
                {controller.conflict.content || "No content"}
              </p>
            </div>
          )}
          {controller.conflict ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => void controller.useLatestVersion()}
              >
                Use latest
              </Button>
              <Button
                variant="primary"
                leftIcon={<Check className="h-4 w-4" />}
                disabled={controller.conflict.trashedAt !== null}
                onClick={() => void controller.keepDraft()}
              >
                Keep my draft
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-white/55">
                {controller.error}
              </p>
              <Button
                className="w-full"
                variant="secondary"
                isLoading={controller.busyLabel === "Loading latest note"}
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void controller.retryConflictFetch()}
              >
                Retry loading latest
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
  },
);
