import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { currentUserId } from "../persistentCache";
import { queryClient } from "../queryClient";
import type {
  CreateNoteInput,
  Note,
  NotePage,
  NoteUploadIntent,
  NoteView,
  UpdateNoteInput,
} from "../types";
import {
  HttpError,
  apiDelete,
  apiGet,
  apiMessage,
  apiPatch,
  apiPost,
  apiPut,
} from "../client";

const DEFAULT_PAGE_SIZE = 30;

export const notesKeys = {
  root: ["notes"] as const,
  all: (userId: string) => ["notes", userId] as const,
  lists: (userId: string) => ["notes", userId, "list"] as const,
  list: (userId: string, view: NoteView, limit: number) =>
    ["notes", userId, "list", view, limit] as const,
  detail: (userId: string, noteId: string) =>
    ["notes", userId, "detail", noteId] as const,
};

function notePath(noteId: string): string {
  return `/notes/${encodeURIComponent(noteId)}`;
}

function imagePath(noteId: string, imageId: string): string {
  return `${notePath(noteId)}/images/${encodeURIComponent(imageId)}`;
}

function versionHeaders(version: number): HeadersInit {
  // Avoid hosting proxies interpreting application version checks as HTTP preconditions.
  return { "X-Note-Version": `"${version}"` };
}

function noteRequestOptions(version?: number) {
  return {
    credentials: "include" as const,
    ...(version === undefined ? {} : { headers: versionHeaders(version) }),
  };
}

export const notesApi = {
  create(input: CreateNoteInput = {}): Promise<Note> {
    return apiPost<Note>("/notes", input, noteRequestOptions());
  },

  list(options: {
    view?: NoteView;
    limit?: number;
    cursor?: string;
  } = {}): Promise<NotePage> {
    const query = new URLSearchParams();
    if (options.view) query.set("view", options.view);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return apiGet<NotePage>(`/notes${suffix}`, noteRequestOptions());
  },

  get(noteId: string): Promise<Note> {
    return apiGet<Note>(notePath(noteId), noteRequestOptions());
  },

  update(noteId: string, version: number, input: UpdateNoteInput): Promise<Note> {
    return apiPatch<Note>(notePath(noteId), input, noteRequestOptions(version));
  },

  archive(noteId: string, version: number): Promise<Note> {
    return apiPost<Note>(
      `${notePath(noteId)}/archive`,
      undefined,
      noteRequestOptions(version),
    );
  },

  unarchive(noteId: string, version: number): Promise<Note> {
    return apiPost<Note>(
      `${notePath(noteId)}/unarchive`,
      undefined,
      noteRequestOptions(version),
    );
  },

  trash(noteId: string, version: number): Promise<Note> {
    return apiPost<Note>(
      `${notePath(noteId)}/trash`,
      undefined,
      noteRequestOptions(version),
    );
  },

  restore(noteId: string, version: number): Promise<Note> {
    return apiPost<Note>(
      `${notePath(noteId)}/restore`,
      undefined,
      noteRequestOptions(version),
    );
  },

  async permanentlyDelete(noteId: string, version: number): Promise<string> {
    const result = await apiMessage(
      notePath(noteId),
      "DELETE",
      noteRequestOptions(version),
    );
    return result.message;
  },

  createUploadIntent(noteId: string, file: File): Promise<NoteUploadIntent> {
    return apiPost<NoteUploadIntent>(
      `${notePath(noteId)}/images/upload-intents`,
      {
        mimeType: file.type,
        sizeBytes: file.size,
      },
      noteRequestOptions(),
    );
  },

  async uploadImageBytes(intent: NoteUploadIntent, file: File): Promise<void> {
    const response = await fetch(intent.uploadUrl, {
      method: intent.method,
      headers: intent.headers,
      body: file,
      credentials: "omit",
    });
    if (!response.ok) {
      throw new HttpError("Image upload failed", response.status);
    }
  },

  confirmImage(
    noteId: string,
    imageId: string,
    version: number,
  ): Promise<Note> {
    return apiPost<Note>(
      `${imagePath(noteId, imageId)}/confirm`,
      undefined,
      noteRequestOptions(version),
    );
  },

  reorderImages(
    noteId: string,
    imageIds: string[],
    version: number,
  ): Promise<Note> {
    return apiPut<Note>(
      `${notePath(noteId)}/images/order`,
      { imageIds },
      noteRequestOptions(version),
    );
  },

  deleteImage(noteId: string, imageId: string, version: number): Promise<Note> {
    return apiDelete<Note>(
      imagePath(noteId, imageId),
      noteRequestOptions(version),
    );
  },
};

function updateNoteInLists(userId: string, note: Note): void {
  queryClient.setQueriesData<InfiniteData<NotePage>>(
    { queryKey: notesKeys.lists(userId) },
    (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          notes: page.notes.map((item) => (item.id === note.id ? note : item)),
        })),
      };
    },
  );
}

export function cacheNote(
  note: Note,
  userId: string | null = currentUserId(),
): void {
  if (!userId || currentUserId() !== userId) return;
  queryClient.setQueryData(notesKeys.detail(userId, note.id), note);
  updateNoteInLists(userId, note);
}

export function invalidateNoteLists(
  userId: string | null = currentUserId(),
): void {
  if (userId && currentUserId() === userId) {
    void queryClient.invalidateQueries({ queryKey: notesKeys.lists(userId) });
  }
}

export function removeCachedNote(
  noteId: string,
  userId: string | null = currentUserId(),
): void {
  if (!userId || currentUserId() !== userId) return;
  queryClient.removeQueries({ queryKey: notesKeys.detail(userId, noteId) });
  queryClient.setQueriesData<InfiniteData<NotePage>>(
    { queryKey: notesKeys.lists(userId) },
    (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          notes: page.notes.filter((item) => item.id !== noteId),
        })),
      };
    },
  );
  invalidateNoteLists(userId);
}

async function fetchNotesPage(
  userId: string,
  view: NoteView,
  limit: number,
  cursor?: string,
): Promise<NotePage> {
  const page = await notesApi.list({ view, limit, cursor });
  if (currentUserId() !== userId) {
    throw new HttpError("Authentication changed while loading notes", 401);
  }
  return page;
}

async function fetchNote(userId: string, noteId: string): Promise<Note> {
  const note = await notesApi.get(noteId);
  if (currentUserId() !== userId) {
    throw new HttpError("Authentication changed while loading a note", 401);
  }
  return note;
}

export function useNotes(view: NoteView, limit = DEFAULT_PAGE_SIZE) {
  const userId = currentUserId();
  return useInfiniteQuery({
    queryKey: notesKeys.list(userId ?? "anonymous", view, limit),
    queryFn: ({ pageParam }) =>
      fetchNotesPage(userId!, view, limit, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(userId),
  });
}

export function useNote(noteId: string) {
  const userId = currentUserId();
  return useQuery({
    queryKey: notesKeys.detail(userId ?? "anonymous", noteId),
    queryFn: () => fetchNote(userId!, noteId),
    enabled: Boolean(userId && noteId),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useCreateNote() {
  const userId = currentUserId();
  return useMutation({
    mutationFn: (input: CreateNoteInput = {}) => notesApi.create(input),
    onSuccess: (note) => {
      cacheNote(note, userId);
      invalidateNoteLists(userId);
    },
  });
}

export function messageForNotesError(error: unknown): string {
  if (!(error instanceof HttpError)) {
    return error instanceof Error ? error.message : "Something went wrong.";
  }

  switch (error.status) {
    case 401:
      return "Your session expired. Sign in again.";
    case 404:
      return "This note is no longer available.";
    case 412:
      return "This note changed elsewhere. Review the latest version before saving.";
    case 413:
      return "The image is larger than 10 MiB.";
    case 415:
      return "Only JPEG, PNG, and WebP images are supported.";
    case 422:
      return "The uploaded image could not be verified.";
    case 428:
      return "The app is missing the note version.";
    case 503:
      return "Image storage is temporarily unavailable.";
    default:
      return error.message;
  }
}
