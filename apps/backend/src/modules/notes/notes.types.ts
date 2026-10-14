export const NOTE_COLORS = [
  "DEFAULT",
  "RED",
  "ORANGE",
  "YELLOW",
  "GREEN",
  "TEAL",
  "BLUE",
  "PURPLE",
  "PINK",
  "BROWN",
  "GRAY",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_VIEWS = ["active", "archived", "trash"] as const;

export type NoteView = (typeof NOTE_VIEWS)[number];

export const NOTE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type NoteImageMimeType = (typeof NOTE_IMAGE_MIME_TYPES)[number];

export const NOTE_IMAGE_EXTENSION_BY_MIME_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<NoteImageMimeType, string>;

export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 20_000;
export const NOTE_LIST_MIN_LIMIT = 1;
export const NOTE_LIST_DEFAULT_LIMIT = 30;
export const NOTE_LIST_MAX_LIMIT = 50;
export const NOTE_CURSOR_MAX_LENGTH = 2_048;
export const NOTE_IMAGE_LIMIT = 10;
export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_INTENT_TTL_MS = 2 * 60 * 60 * 1_000;
export const UPLOAD_TOKEN_REPLAY_GRACE_MS = 5 * 60 * 1_000;
export const NOTE_CLEANUP_BATCH_SIZE = 25;
export const IMAGE_CLEANUP_BATCH_SIZE = 50;
export const STORAGE_REMOVE_BATCH_SIZE = 100;
export const CLEANUP_RETRY_BACKOFF_MS = 25 * 60 * 60 * 1_000;

export type NoteImageResponse = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
  url: string;
  urlExpiresAt: string;
};

export type NoteResponse = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  isPinned: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  images: NoteImageResponse[];
};

export type NoteListPage = {
  notes: NoteResponse[];
  nextCursor: string | null;
};

export type NoteImageUploadIntentResponse = {
  imageId: string;
  uploadUrl: string;
  uploadExpiresAt: string;
  method: "PUT";
  headers: {
    "Content-Type": NoteImageMimeType;
  };
};

export type NoteCleanupResult = {
  claimedNotes: number;
  purgedNotes: number;
  deferredNotePurges: number;
  failedNotePurges: number;
  claimedUploads: number;
  deletedImages: number;
  deferredImageDeletes: number;
  failedImageDeletes: number;
};
