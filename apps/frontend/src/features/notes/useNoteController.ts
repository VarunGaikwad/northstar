import { useEffect, useEffectEvent, useRef, useState } from "react";
import { HttpError } from "../../api/client";
import {
  cacheNote,
  invalidateNoteLists,
  messageForNotesError,
  notesApi,
  removeCachedNote,
} from "../../api/endpoints/notes";
import { currentUserId } from "../../api/persistentCache";
import { restoreVisibleSession, subscribeAuth } from "../../auth/session";
import type {
  Note,
  NoteColor,
  NoteImageMimeType,
  UpdateNoteInput,
} from "../../api/types";

const AUTOSAVE_DELAY_MS = 650;
const SAVED_STATUS_MS = 1_800;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 10;
const ALLOWED_IMAGE_TYPES = new Set<NoteImageMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type NoteSaveState =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict";

interface NoteDraft {
  title: string;
  content: string;
}

interface StoredNoteDraft extends NoteDraft {
  baseVersion: number;
}

interface StoredImageConfirmation {
  imageId: string;
  expiresAt: string;
}

function draftStorageKey(userId: string, noteId: string): string {
  return `northstar.notes.draft.${userId}.${noteId}`;
}

function readStoredDraft(note: Note, userId: string): StoredNoteDraft | null {
  try {
    const key = draftStorageKey(userId, note.id);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredNoteDraft>;
    if (
      typeof stored.title !== "string" ||
      typeof stored.content !== "string" ||
      typeof stored.baseVersion !== "number"
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (stored.title === note.title && stored.content === note.content) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      title: stored.title,
      content: stored.content,
      baseVersion: stored.baseVersion,
    };
  } catch {
    return null;
  }
}

function writeStoredDraft(
  noteId: string,
  userId: string,
  draft: NoteDraft,
  baseVersion: number,
): void {
  try {
    sessionStorage.setItem(
      draftStorageKey(userId, noteId),
      JSON.stringify({ ...draft, baseVersion } satisfies StoredNoteDraft),
    );
  } catch {
    // Keep the in-memory draft when session storage is unavailable.
  }
}

function removeStoredDraft(noteId: string, userId: string): void {
  try {
    sessionStorage.removeItem(draftStorageKey(userId, noteId));
  } catch {
    // Session storage is unavailable.
  }
}

function confirmationStorageKey(userId: string, noteId: string): string {
  return `northstar.notes.image-confirmation.${userId}.${noteId}`;
}

function readStoredConfirmation(
  noteId: string,
  userId: string,
): StoredImageConfirmation | null {
  try {
    const key = confirmationStorageKey(userId, noteId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredImageConfirmation>;
    if (
      typeof stored.imageId !== "string" ||
      typeof stored.expiresAt !== "string" ||
      Date.parse(stored.expiresAt) <= Date.now()
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    return { imageId: stored.imageId, expiresAt: stored.expiresAt };
  } catch {
    return null;
  }
}

function writeStoredConfirmation(
  noteId: string,
  userId: string,
  confirmation: StoredImageConfirmation,
): void {
  try {
    sessionStorage.setItem(
      confirmationStorageKey(userId, noteId),
      JSON.stringify(confirmation),
    );
  } catch {
    // The current editor can still retry while session storage is unavailable.
  }
}

function removeStoredConfirmation(noteId: string, userId: string): void {
  try {
    sessionStorage.removeItem(confirmationStorageKey(userId, noteId));
  } catch {
    // Session storage is unavailable.
  }
}

function validateImage(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.has(file.type as NoteImageMimeType)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("The image must be no larger than 10 MiB.");
  }
}

export function useNoteController(initialNote: Note, ownerUserId: string) {
  const [restoredDraft] = useState(() =>
    readStoredDraft(initialNote, ownerUserId),
  );
  const [restoredConfirmation] = useState(() =>
    readStoredConfirmation(initialNote.id, ownerUserId),
  );
  const initialDraft = restoredDraft
    ? { title: restoredDraft.title, content: restoredDraft.content }
    : { title: initialNote.title, content: initialNote.content };
  const restoredDraftConflicts =
    restoredDraft !== null && restoredDraft.baseVersion !== initialNote.version;
  const restoredDraftIsDirty =
    initialDraft.title !== initialNote.title ||
    initialDraft.content !== initialNote.content;
  const [note, setNote] = useState(initialNote);
  const [draft, setDraft] = useState<NoteDraft>(initialDraft);
  const [saveState, setSaveState] = useState<NoteSaveState>(
    restoredDraftConflicts ? "conflict" : restoredDraftIsDirty ? "dirty" : "idle",
  );
  const [error, setError] = useState<string | null>(
    restoredDraftConflicts
      ? "A recovered draft was based on an older version of this note."
      : null,
  );
  const [conflict, setConflict] = useState<Note | null>(
    restoredDraftConflicts ? initialNote : null,
  );
  const [conflictBlocked, setConflictBlocked] = useState(restoredDraftConflicts);
  const [recoveredDraft, setRecoveredDraft] = useState(restoredDraft !== null);
  const [pendingImageConfirmation, setPendingImageConfirmation] = useState(
    restoredConfirmation !== null,
  );
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const noteRef = useRef(initialNote);
  const draftRef = useRef<NoteDraft>(initialDraft);
  const conflictRef = useRef<Note | null>(
    restoredDraftConflicts ? initialNote : null,
  );
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const saveTaskRef = useRef<Promise<void> | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const refreshTaskRef = useRef<Promise<void> | null>(null);
  const pendingConflictMutationRef = useRef<
    ((current: Note) => Promise<Note>) | null
  >(
    restoredConfirmation
      ? (current) =>
          notesApi.confirmImage(
            current.id,
            restoredConfirmation.imageId,
            current.version,
          )
      : null,
  );
  const pausedRef = useRef(restoredDraftConflicts);
  const actionLockedRef = useRef(false);
  const uploadInProgressRef = useRef(false);
  const lastErrorStatusRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  function updateState(run: () => void): void {
    if (mountedRef.current) run();
  }

  function clearAutosaveTimer(): void {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }

  function clearSavedTimer(): void {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }

  function clearPendingConfirmation(): void {
    pendingConflictMutationRef.current = null;
    removeStoredConfirmation(noteRef.current.id, ownerUserId);
    updateState(() => setPendingImageConfirmation(false));
  }

  function setControllerError(nextError: unknown): void {
    lastErrorStatusRef.current =
      nextError instanceof HttpError ? nextError.status : null;
    updateState(() => {
      setError(messageForNotesError(nextError));
      setSaveState("error");
    });
  }

  function applyServerNote(nextNote: Note, syncDraft: boolean): void {
    if (currentUserId() !== ownerUserId) return;
    noteRef.current = nextNote;
    cacheNote(nextNote, ownerUserId);
    updateState(() => setNote(nextNote));

    if (syncDraft) {
      const nextDraft = {
        title: nextNote.title,
        content: nextNote.content,
      };
      draftRef.current = nextDraft;
      updateState(() => setDraft(nextDraft));
      removeStoredDraft(nextNote.id, ownerUserId);
      updateState(() => setRecoveredDraft(false));
    } else if (
      draftRef.current.title !== nextNote.title ||
      draftRef.current.content !== nextNote.content
    ) {
      writeStoredDraft(
        nextNote.id,
        ownerUserId,
        draftRef.current,
        nextNote.version,
      );
    }
  }

  function hasDraftChanges(): boolean {
    const currentNote = noteRef.current;
    const currentDraft = draftRef.current;
    return (
      currentDraft.title !== currentNote.title ||
      currentDraft.content !== currentNote.content
    );
  }

  function markSaved(): void {
    lastErrorStatusRef.current = null;
    clearSavedTimer();
    updateState(() => setSaveState("saved"));
    savedTimerRef.current = window.setTimeout(() => {
      updateState(() => setSaveState((state) => (state === "saved" ? "idle" : state)));
      savedTimerRef.current = null;
    }, SAVED_STATUS_MS);
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queueRef.current.then(task, task);
    queueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function blockForConflict(latest: Note | null, message: string): void {
    pausedRef.current = true;
    conflictRef.current = latest;
    if (latest) cacheNote(latest, ownerUserId);
    updateState(() => {
      setConflict(latest);
      setConflictBlocked(true);
      setError(message);
      setSaveState("conflict");
    });
  }

  async function loadLatestConflict(message: string): Promise<void> {
    try {
      const latest = await notesApi.get(noteRef.current.id);
      if (currentUserId() !== ownerUserId) return;
      blockForConflict(latest, message);
    } catch (refreshError) {
      blockForConflict(
        null,
        `A conflict was detected, but the latest note could not be loaded. ${messageForNotesError(refreshError)}`,
      );
    }
  }

  async function captureMutationError(
    mutationError: unknown,
    retryMutation?: (current: Note) => Promise<Note>,
  ): Promise<void> {
    if (mutationError instanceof HttpError && mutationError.status === 412) {
      if (retryMutation) {
        pendingConflictMutationRef.current = retryMutation;
        updateState(() => setPendingImageConfirmation(true));
      }
      const message = messageForNotesError(mutationError);
      blockForConflict(null, message);
      await loadLatestConflict(message);
      return;
    }
    setControllerError(mutationError);
  }

  function requestSave(): Promise<void> {
    clearAutosaveTimer();
    if (currentUserId() !== ownerUserId) {
      const sessionError = new HttpError("Authentication changed before the note was saved", 401);
      setControllerError(sessionError);
      return Promise.reject(sessionError);
    }
    if (pausedRef.current || noteRef.current.trashedAt) {
      return Promise.resolve();
    }
    if (saveTaskRef.current) return saveTaskRef.current;

    const saveTask = enqueue(async () => {
      let saved = false;
      while (!pausedRef.current && !noteRef.current.trashedAt) {
        const currentNote = noteRef.current;
        const snapshot = { ...draftRef.current };
        const patch: UpdateNoteInput = {};
        if (snapshot.title !== currentNote.title) patch.title = snapshot.title;
        if (snapshot.content !== currentNote.content) patch.content = snapshot.content;
        if (Object.keys(patch).length === 0) break;

        clearSavedTimer();
        updateState(() => {
          setError(null);
          setSaveState("saving");
        });

        let updated: Note;
        try {
          updated = await notesApi.update(currentNote.id, currentNote.version, patch);
        } catch (saveError) {
          await captureMutationError(saveError);
          throw saveError;
        }

        const draftDidNotChange =
          draftRef.current.title === snapshot.title &&
          draftRef.current.content === snapshot.content;
        applyServerNote(updated, draftDidNotChange);
        saved = true;
      }

      if (saved) {
        invalidateNoteLists(ownerUserId);
        if (!pausedRef.current) markSaved();
      }
    });

    saveTaskRef.current = saveTask;
    void saveTask.then(
      () => {
        if (saveTaskRef.current === saveTask) saveTaskRef.current = null;
      },
      () => {
        if (saveTaskRef.current === saveTask) saveTaskRef.current = null;
      },
    );
    return saveTask;
  }

  const flushOnUnmount = useEffectEvent(() => requestSave());

  function scheduleSave(): void {
    clearAutosaveTimer();
    clearSavedTimer();
    if (pausedRef.current || actionLockedRef.current || noteRef.current.trashedAt) {
      return;
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void requestSave().catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
  }

  function updateDraft(field: keyof NoteDraft, value: string): void {
    const nextDraft = { ...draftRef.current, [field]: value };
    draftRef.current = nextDraft;
    if (
      nextDraft.title === noteRef.current.title &&
      nextDraft.content === noteRef.current.content
    ) {
      removeStoredDraft(noteRef.current.id, ownerUserId);
      updateState(() => setRecoveredDraft(false));
    } else {
      writeStoredDraft(
        noteRef.current.id,
        ownerUserId,
        nextDraft,
        noteRef.current.version,
      );
    }
    updateState(() => {
      setDraft(nextDraft);
      if (!pausedRef.current) {
        setError(null);
        setSaveState("dirty");
      }
    });
    scheduleSave();
  }

  async function runVersionedMutation(
    label: string,
    mutation: (current: Note) => Promise<Note>,
    options: {
      allowDuringUpload?: boolean;
      allowPendingConfirmation?: boolean;
      retryOnConflict?: boolean;
    } = {},
  ): Promise<Note | null> {
    if (
      actionLockedRef.current ||
      pausedRef.current ||
      (uploadInProgressRef.current && !options.allowDuringUpload) ||
      (pendingConflictMutationRef.current && !options.allowPendingConfirmation)
    ) {
      return null;
    }
    actionLockedRef.current = true;
    clearAutosaveTimer();
    updateState(() => {
      setBusyLabel(label);
      setError(null);
    });

    try {
      await requestSave();
      if (pausedRef.current) return null;

      const updated = await enqueue(async () => {
        try {
          return await mutation(noteRef.current);
        } catch (mutationError) {
          await captureMutationError(
            mutationError,
            options.retryOnConflict ? mutation : undefined,
          );
          throw mutationError;
        }
      });
      applyServerNote(updated, true);
      invalidateNoteLists(ownerUserId);
      markSaved();
      return updated;
    } finally {
      actionLockedRef.current = false;
      updateState(() => setBusyLabel(null));
      if (!pausedRef.current && !noteRef.current.trashedAt && hasDraftChanges()) {
        scheduleSave();
      }
    }
  }

  async function permanentlyDelete(): Promise<boolean> {
    if (
      actionLockedRef.current ||
      pausedRef.current ||
      uploadInProgressRef.current
    ) {
      return false;
    }
    actionLockedRef.current = true;
    clearAutosaveTimer();
    updateState(() => {
      setBusyLabel("Deleting note");
      setError(null);
    });

    try {
      await requestSave();
      if (pausedRef.current) return false;
      await enqueue(async () => {
        try {
          await notesApi.permanentlyDelete(
            noteRef.current.id,
            noteRef.current.version,
          );
        } catch (mutationError) {
          await captureMutationError(mutationError);
          throw mutationError;
        }
      });
      removeCachedNote(noteRef.current.id, ownerUserId);
      removeStoredDraft(noteRef.current.id, ownerUserId);
      removeStoredConfirmation(noteRef.current.id, ownerUserId);
      return true;
    } finally {
      actionLockedRef.current = false;
      updateState(() => setBusyLabel(null));
    }
  }

  async function uploadImage(file: File): Promise<Note | null> {
    if (
      uploadInProgressRef.current ||
      actionLockedRef.current ||
      pausedRef.current ||
      pendingConflictMutationRef.current
    ) {
      return null;
    }
    try {
      validateImage(file);
      if (noteRef.current.images.length >= MAX_IMAGES) {
        throw new Error("A note can contain up to 10 images.");
      }
    } catch (validationError) {
      setControllerError(validationError);
      throw validationError;
    }

    uploadInProgressRef.current = true;
    updateState(() => {
      setIsUploading(true);
      setError(null);
    });
    let confirmationMutation: ((current: Note) => Promise<Note>) | null = null;
    try {
      const intent = await notesApi.createUploadIntent(noteRef.current.id, file);
      await notesApi.uploadImageBytes(intent, file);
      confirmationMutation = (current) =>
        notesApi.confirmImage(current.id, intent.imageId, current.version);
      pendingConflictMutationRef.current = confirmationMutation;
      writeStoredConfirmation(noteRef.current.id, ownerUserId, {
        imageId: intent.imageId,
        expiresAt: intent.uploadExpiresAt,
      });
      updateState(() => setPendingImageConfirmation(true));
      const confirmed = await runVersionedMutation(
        "Adding image",
        confirmationMutation,
        {
          allowDuringUpload: true,
          allowPendingConfirmation: true,
          retryOnConflict: true,
        },
      );
      if (!confirmed && !pausedRef.current) {
        throw new Error("The uploaded image could not be confirmed.");
      }
      if (confirmed) clearPendingConfirmation();
      return confirmed;
    } catch (uploadError) {
      const canRetryConfirmation =
        confirmationMutation !== null &&
        (!(uploadError instanceof HttpError) ||
          uploadError.status === 401 ||
          uploadError.status >= 500);
      if (canRetryConfirmation) {
        pendingConflictMutationRef.current = confirmationMutation;
        updateState(() => setPendingImageConfirmation(true));
      } else if (
        confirmationMutation &&
        uploadError instanceof HttpError &&
        [404, 409, 422].includes(uploadError.status)
      ) {
        clearPendingConfirmation();
      }
      if (!(uploadError instanceof HttpError && uploadError.status === 412)) {
        setControllerError(uploadError);
      }
      throw uploadError;
    } finally {
      uploadInProgressRef.current = false;
      updateState(() => setIsUploading(false));
    }
  }

  function setColor(color: NoteColor): Promise<Note | null> {
    return runVersionedMutation("Changing color", (current) =>
      notesApi.update(current.id, current.version, { color }),
    );
  }

  function togglePin(): Promise<Note | null> {
    return runVersionedMutation(
      noteRef.current.isPinned ? "Unpinning note" : "Pinning note",
      (current) =>
        notesApi.update(current.id, current.version, {
          isPinned: !current.isPinned,
        }),
    );
  }

  function archive(): Promise<Note | null> {
    return runVersionedMutation("Archiving note", (current) =>
      notesApi.archive(current.id, current.version),
    );
  }

  function unarchive(): Promise<Note | null> {
    return runVersionedMutation("Unarchiving note", (current) =>
      notesApi.unarchive(current.id, current.version),
    );
  }

  function trash(): Promise<Note | null> {
    return runVersionedMutation("Moving note to trash", (current) =>
      notesApi.trash(current.id, current.version),
    );
  }

  function restore(): Promise<Note | null> {
    return runVersionedMutation("Restoring note", (current) =>
      notesApi.restore(current.id, current.version),
    );
  }

  function deleteImage(imageId: string): Promise<Note | null> {
    return runVersionedMutation("Deleting image", (current) =>
      notesApi.deleteImage(current.id, imageId, current.version),
    );
  }

  function moveImage(imageId: string, offset: -1 | 1): Promise<Note | null> {
    return runVersionedMutation("Reordering images", (current) => {
      const imageIds = current.images.map((image) => image.id);
      const index = imageIds.indexOf(imageId);
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= imageIds.length) {
        return Promise.resolve(current);
      }
      [imageIds[index], imageIds[destination]] = [
        imageIds[destination],
        imageIds[index],
      ];
      return notesApi.reorderImages(current.id, imageIds, current.version);
    });
  }

  function refreshImages(): Promise<void> {
    if (refreshTaskRef.current) return refreshTaskRef.current;
    const refreshTask = enqueue(async () => {
      try {
        const latest = await notesApi.get(noteRef.current.id);
        if (currentUserId() !== ownerUserId) return;
        if (latest.version < noteRef.current.version) return;
        if (latest.version !== noteRef.current.version && hasDraftChanges()) {
          blockForConflict(
            latest,
            "This note changed elsewhere. Review the latest version before saving.",
          );
          return;
        }
        applyServerNote(latest, !hasDraftChanges());
      } catch (refreshError) {
        updateState(() => setError(messageForNotesError(refreshError)));
      }
    });
    refreshTaskRef.current = refreshTask;
    void refreshTask.then(
      () => {
        if (refreshTaskRef.current === refreshTask) refreshTaskRef.current = null;
      },
      () => {
        if (refreshTaskRef.current === refreshTask) refreshTaskRef.current = null;
      },
    );
    return refreshTask;
  }

  async function retryConflictFetch(): Promise<void> {
    if (!pausedRef.current || conflictRef.current) return;
    updateState(() => setBusyLabel("Loading latest note"));
    try {
      await loadLatestConflict(
        "This note changed elsewhere. Review the latest version before saving.",
      );
    } finally {
      updateState(() => setBusyLabel(null));
    }
  }

  async function retryPendingImage(): Promise<Note | null> {
    const pendingMutation = pendingConflictMutationRef.current;
    if (!pendingMutation || pausedRef.current) return null;
    try {
      const updated = await runVersionedMutation(
        "Confirming image",
        pendingMutation,
        {
          allowDuringUpload: true,
          allowPendingConfirmation: true,
          retryOnConflict: true,
        },
      );
      if (updated) {
        clearPendingConfirmation();
      }
      return updated;
    } catch (retryError) {
      if (
        retryError instanceof HttpError &&
        [404, 409, 422].includes(retryError.status)
      ) {
        clearPendingConfirmation();
      }
      return null;
    }
  }

  async function useLatestVersion(): Promise<void> {
    const latest = conflictRef.current;
    if (!latest) return;
    pausedRef.current = false;
    conflictRef.current = null;
    applyServerNote(latest, true);
    invalidateNoteLists(ownerUserId);
    updateState(() => {
      setConflict(null);
      setConflictBlocked(false);
      setError(null);
      setSaveState("idle");
    });
    await retryPendingImage();
  }

  async function keepDraft(): Promise<void> {
    const latest = conflictRef.current;
    if (!latest || latest.trashedAt) return;
    pausedRef.current = false;
    conflictRef.current = null;
    applyServerNote(latest, false);
    updateState(() => {
      setConflict(null);
      setConflictBlocked(false);
      setError(null);
      setSaveState("dirty");
    });
    try {
      await requestSave();
      if (!pausedRef.current) await retryPendingImage();
    } catch {
      // Saving and conflict errors are exposed by the controller.
    }
  }

  async function prepareToLeave(): Promise<boolean> {
    clearAutosaveTimer();
    if (
      pausedRef.current ||
      actionLockedRef.current ||
      uploadInProgressRef.current ||
      pendingConflictMutationRef.current
    ) {
      return false;
    }
    try {
      await requestSave();
    } catch {
      return false;
    }
    return !pausedRef.current && !hasDraftChanges();
  }

  function discardDraft(): void {
    if (pausedRef.current || pendingConflictMutationRef.current) return;
    clearAutosaveTimer();
    const nextDraft = {
      title: noteRef.current.title,
      content: noteRef.current.content,
    };
    draftRef.current = nextDraft;
    removeStoredDraft(noteRef.current.id, ownerUserId);
    lastErrorStatusRef.current = null;
    updateState(() => {
      setDraft(nextDraft);
      setRecoveredDraft(false);
      setError(null);
      setSaveState("idle");
    });
  }

  const reconcileIncomingNote = useEffectEvent((incoming: Note) => {
    if (
      incoming.id !== noteRef.current.id ||
      currentUserId() !== ownerUserId ||
      incoming.version < noteRef.current.version
    ) {
      return;
    }

    if (incoming.version === noteRef.current.version) {
      if (incoming !== noteRef.current) {
        applyServerNote(incoming, !hasDraftChanges());
      }
      return;
    }

    if (
      !hasDraftChanges() &&
      !actionLockedRef.current &&
      !saveTaskRef.current &&
      !pausedRef.current
    ) {
      applyServerNote(incoming, true);
      return;
    }

    blockForConflict(
      incoming,
      "This note changed elsewhere. Review the latest version before saving.",
    );
  });

  useEffect(() => {
    reconcileIncomingNote(initialNote);
  }, [initialNote]);

  const retryAfterAuthChange = useEffectEvent(() => {
    if (
      lastErrorStatusRef.current === 401 &&
      currentUserId() === ownerUserId &&
      !pausedRef.current
    ) {
      const hasPendingConfirmation = pendingConflictMutationRef.current !== null;
      if (!hasDraftChanges() && !hasPendingConfirmation) return;
      lastErrorStatusRef.current = null;
      if (hasPendingConfirmation) {
        void retryPendingImage();
      } else {
        void requestSave().catch(() => undefined);
      }
    }
  });

  useEffect(() => subscribeAuth(() => retryAfterAuthChange()), []);

  const retryWhenVisible = useEffectEvent(async () => {
    if (
      document.visibilityState !== "visible" ||
      lastErrorStatusRef.current !== 401 ||
      currentUserId() !== ownerUserId ||
      (!hasDraftChanges() && !pendingConflictMutationRef.current) ||
      pausedRef.current
    ) {
      return;
    }
    try {
      await restoreVisibleSession();
      if (currentUserId() === ownerUserId) {
        lastErrorStatusRef.current = null;
        if (pendingConflictMutationRef.current) {
          await retryPendingImage();
        } else {
          await requestSave();
        }
      }
    } catch {
      // Keep the recovered draft and retry after the next auth or visibility change.
    }
  });

  useEffect(() => {
    const onVisibilityChange = () => void retryWhenVisible();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const warnBeforeUnload = useEffectEvent((event: BeforeUnloadEvent) => {
    if (
      hasDraftChanges() ||
      pausedRef.current ||
      uploadInProgressRef.current ||
      pendingConflictMutationRef.current
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => warnBeforeUnload(event);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAutosaveTimer();
      clearSavedTimer();
      if (
        currentUserId() === ownerUserId &&
        !pausedRef.current &&
        hasDraftChanges()
      ) {
        void flushOnUnmount().catch(() => undefined);
      }
    };
  }, [ownerUserId]);

  return {
    note,
    draft,
    saveState,
    error,
    conflict,
    conflictBlocked,
    recoveredDraft,
    pendingImageConfirmation,
    busyLabel,
    isUploading,
    isBusy: busyLabel !== null,
    hasUnsavedChanges:
      draft.title !== note.title || draft.content !== note.content,
    setTitle: (title: string) => updateDraft("title", title),
    setContent: (content: string) => updateDraft("content", content),
    flush: requestSave,
    setColor,
    togglePin,
    archive,
    unarchive,
    trash,
    restore,
    permanentlyDelete,
    uploadImage,
    deleteImage,
    moveImage,
    refreshImages,
    retryConflictFetch,
    retryPendingImage,
    useLatestVersion,
    keepDraft,
    prepareToLeave,
    discardDraft,
  };
}
