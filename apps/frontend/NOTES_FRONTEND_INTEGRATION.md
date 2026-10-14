# Notes Frontend Integration Guide

This guide explains how a frontend should use the private Notes API, including optimistic autosave, archive/trash behavior, direct image uploads, image ordering, and signed image URLs.

## API Overview

Base path:

```text
/api/notes
```

Every user-facing notes request requires a Northstar access token:

```http
Authorization: Bearer <accessToken>
```

Do not call `/api/internal/notes/cleanup` from the frontend. It is a server-only Vercel Cron endpoint protected by `CRON_SECRET`.

## Frontend Types

```ts
export type NoteColor =
  | "DEFAULT"
  | "RED"
  | "ORANGE"
  | "YELLOW"
  | "GREEN"
  | "TEAL"
  | "BLUE"
  | "PURPLE"
  | "PINK"
  | "BROWN"
  | "GRAY";

export type NoteView = "active" | "archived" | "trash";
export type NoteImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface NoteImage {
  id: string;
  mimeType: NoteImageMimeType;
  sizeBytes: number;
  position: number;
  url: string;
  urlExpiresAt: string;
}

export interface Note {
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
  images: NoteImage[];
}

export interface NotePage {
  items: Note[];
  nextCursor: string | null;
}

export interface CreateNoteInput {
  title?: string;
  content?: string;
  color?: NoteColor;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  color?: NoteColor;
  isPinned?: boolean;
}

export interface UploadIntent {
  imageId: string;
  uploadUrl: string;
  uploadExpiresAt: string;
  method: "PUT";
  headers: {
    "Content-Type": NoteImageMimeType;
  };
}

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiMessage {
  success: true;
  message: string;
}

interface ApiFailure {
  success: false;
  error: string;
}
```

## Copy-Ready Notes Service

The service below is framework-independent. Provide the current access token through `getAccessToken` so token refresh logic can remain in the application's shared auth layer.

```ts
export class NotesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "NotesApiError";
  }
}

type NotesServiceOptions = {
  apiBaseUrl: string;
  getAccessToken: () => string | null;
};

export function createNotesService({
  apiBaseUrl,
  getAccessToken,
}: NotesServiceOptions) {
  const notesBaseUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/notes`;

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ data: T; etag: string | null }> {
    const token = getAccessToken();
    if (!token) {
      throw new NotesApiError("Authentication is required", 401);
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${notesBaseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });

    const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
    if (!response.ok || !payload.success) {
      throw new NotesApiError(
        payload.success ? "Notes request failed" : payload.error,
        response.status,
      );
    }

    return {
      data: payload.data,
      etag: response.headers.get("ETag"),
    };
  }

  function notePath(noteId: string): string {
    return `/${encodeURIComponent(noteId)}`;
  }

  function imagePath(noteId: string, imageId: string): string {
    return `${notePath(noteId)}/images/${encodeURIComponent(imageId)}`;
  }

  function ifMatch(version: number): Record<string, string> {
    return { "If-Match": `"${version}"` };
  }

  return {
    async create(input: CreateNoteInput = {}): Promise<Note> {
      const result = await request<Note>("", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result.data;
    },

    async list(options: {
      view?: NoteView;
      limit?: number;
      cursor?: string;
    } = {}): Promise<NotePage> {
      const query = new URLSearchParams();
      if (options.view) query.set("view", options.view);
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.cursor) query.set("cursor", options.cursor);

      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      const result = await request<NotePage>(suffix);
      return result.data;
    },

    async get(noteId: string): Promise<Note> {
      const result = await request<Note>(notePath(noteId));
      return result.data;
    },

    async update(
      noteId: string,
      version: number,
      input: UpdateNoteInput,
    ): Promise<Note> {
      const result = await request<Note>(notePath(noteId), {
        method: "PATCH",
        headers: ifMatch(version),
        body: JSON.stringify(input),
      });
      return result.data;
    },

    async archive(noteId: string, version: number): Promise<Note> {
      const result = await request<Note>(`${notePath(noteId)}/archive`, {
        method: "POST",
        headers: ifMatch(version),
      });
      return result.data;
    },

    async unarchive(noteId: string, version: number): Promise<Note> {
      const result = await request<Note>(`${notePath(noteId)}/unarchive`, {
        method: "POST",
        headers: ifMatch(version),
      });
      return result.data;
    },

    async trash(noteId: string, version: number): Promise<Note> {
      const result = await request<Note>(`${notePath(noteId)}/trash`, {
        method: "POST",
        headers: ifMatch(version),
      });
      return result.data;
    },

    async restore(noteId: string, version: number): Promise<Note> {
      const result = await request<Note>(`${notePath(noteId)}/restore`, {
        method: "POST",
        headers: ifMatch(version),
      });
      return result.data;
    },

    async permanentlyDelete(noteId: string, version: number): Promise<string> {
      const token = getAccessToken();
      if (!token) throw new NotesApiError("Authentication is required", 401);

      const response = await fetch(`${notesBaseUrl}${notePath(noteId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          ...ifMatch(version),
        },
      });
      const payload = (await response.json()) as ApiMessage | ApiFailure;
      if (!response.ok || !payload.success) {
        throw new NotesApiError(
          payload.success ? "Note deletion failed" : payload.error,
          response.status,
        );
      }
      return payload.message;
    },

    async createUploadIntent(
      noteId: string,
      file: File,
    ): Promise<UploadIntent> {
      const result = await request<UploadIntent>(
        `${notePath(noteId)}/images/upload-intents`,
        {
          method: "POST",
          body: JSON.stringify({
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        },
      );
      return result.data;
    },

    async uploadImageBytes(intent: UploadIntent, file: File): Promise<void> {
      const response = await fetch(intent.uploadUrl, {
        method: intent.method,
        headers: intent.headers,
        body: file,
        credentials: "omit",
      });
      if (!response.ok) {
        throw new NotesApiError("Image upload failed", response.status);
      }
    },

    async confirmImage(
      noteId: string,
      imageId: string,
      version: number,
    ): Promise<Note> {
      const result = await request<Note>(
        `${imagePath(noteId, imageId)}/confirm`,
        {
          method: "POST",
          headers: ifMatch(version),
        },
      );
      return result.data;
    },

    async reorderImages(
      noteId: string,
      imageIds: string[],
      version: number,
    ): Promise<Note> {
      const result = await request<Note>(`${notePath(noteId)}/images/order`, {
        method: "PUT",
        headers: ifMatch(version),
        body: JSON.stringify({ imageIds }),
      });
      return result.data;
    },

    async deleteImage(
      noteId: string,
      imageId: string,
      version: number,
    ): Promise<Note> {
      const result = await request<Note>(imagePath(noteId, imageId), {
        method: "DELETE",
        headers: ifMatch(version),
      });
      return result.data;
    },
  };
}
```

Example initialization:

```ts
export const notesService = createNotesService({
  apiBaseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  getAccessToken: () => authStore.getState().accessToken,
});
```

## Optimistic Autosave

Every note has a positive integer `version`. Every visible mutation requires the version currently held by the frontend:

```http
If-Match: "3"
```

The response contains the next version in both `data.version` and the `ETag` response header.

Use the returned note as the new local source of truth:

```ts
async function saveNotePatch(note: Note, patch: UpdateNoteInput): Promise<Note> {
  try {
    return await notesService.update(note.id, note.version, patch);
  } catch (error) {
    if (error instanceof NotesApiError && error.status === 412) {
      const latest = await notesService.get(note.id);
      // Show a conflict UI or merge the user's unsaved draft with `latest`.
      // Do not automatically resend the stale patch.
      throw new Error(`Note changed elsewhere. Latest version is ${latest.version}.`);
    }
    throw error;
  }
}
```

Autosave requests for the same note should be serialized. Do not send two parallel PATCH requests with the same version. A typical UI should debounce typing, wait for the current save to finish, then send the newest queued draft using the returned version.

Status behavior:

| Status | Frontend action |
|--------|-----------------|
| `412` | Refetch and show/resolve an edit conflict |
| `428` | Frontend bug: a mutation was sent without `If-Match` |
| `409` | Invalid lifecycle action, expired upload, or invalid image order |
| `404` | Note/image is missing, foreign, or already claimed for purge |

## Image Upload Flow

Images never pass through the Northstar server. The frontend uploads bytes directly to a private Supabase signed URL.

Accepted files:

| Rule | Value |
|------|-------|
| MIME types | `image/jpeg`, `image/png`, `image/webp` |
| Maximum file size | 10 MiB |
| Maximum images | 10 pending plus ready images per note |

Validate before requesting an upload intent:

```ts
const allowedTypes = new Set<NoteImageMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxImageBytes = 10 * 1024 * 1024;

function validateNoteImage(file: File): asserts file is File & {
  type: NoteImageMimeType;
} {
  if (!allowedTypes.has(file.type as NoteImageMimeType)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size <= 0 || file.size > maxImageBytes) {
    throw new Error("The image must be no larger than 10 MiB.");
  }
}
```

Complete upload example:

```ts
async function addImage(
  getCurrentNote: () => Note,
  file: File,
): Promise<Note> {
  validateNoteImage(file);
  const note = getCurrentNote();

  // Reserving an image is invisible and does not change note.version.
  const intent = await notesService.createUploadIntent(note.id, file);

  // This request goes directly to Supabase.
  await notesService.uploadImageBytes(intent, file);

  // Read the latest local note after upload. Autosave may have changed its
  // version while the bytes were uploading.
  const latest = getCurrentNote();
  return notesService.confirmImage(latest.id, intent.imageId, latest.version);
}
```

For the direct `PUT` to `uploadUrl`, send only:

```http
Content-Type: <the exact value returned in intent.headers>
```

Do not send any of the following to Supabase:

- Northstar `Authorization` header
- Supabase `apikey`
- `x-upsert`
- Manually supplied `Content-Length`
- JSON or multipart form data

The upload intent expires in approximately two hours. Do not persist upload URLs as permanent application data.

Confirmation errors:

| Status | Meaning |
|--------|---------|
| `409` | Intent expired, note is trashed, or image is no longer pending |
| `412` | Note changed while the upload was in progress; refetch and retry confirmation before expiry |
| `422` | Provider-reported size or MIME type did not match the intent |
| `503` | Storage provider is temporarily unavailable |

## Image Reordering

Send the complete ordered list of every ready image ID. Do not send only the moved image.

```ts
const reordered = await notesService.reorderImages(
  note.id,
  [note.images[2].id, note.images[0].id, note.images[1].id],
  note.version,
);
```

The server rewrites positions to `0..n-1` and returns the complete updated note.

## Image Deletion

```ts
const updated = await notesService.deleteImage(
  note.id,
  image.id,
  note.version,
);
```

The image disappears from the returned note immediately. Storage deletion may continue asynchronously, so the frontend should rely on the returned note rather than checking the old signed image URL.

## Pagination

```ts
const firstPage = await notesService.list({
  view: "active",
  limit: 30,
});

const secondPage = firstPage.nextCursor
  ? await notesService.list({
      view: "active",
      limit: 30,
      cursor: firstPage.nextCursor,
    })
  : null;
```

Treat `nextCursor` as opaque. Do not decode it, edit it, or reuse it with another view.

Ordering is stable:

| View | Order |
|------|-------|
| Active | Pinned first, then newest `updatedAt`, then ID |
| Archived | Newest `updatedAt`, then ID |
| Trash | Newest `trashedAt`, then ID |

## Lifecycle Actions

```ts
const archived = await notesService.archive(note.id, note.version);
const activeAgain = await notesService.unarchive(archived.id, archived.version);
const trashed = await notesService.trash(activeAgain.id, activeAgain.version);
const restored = await notesService.restore(trashed.id, trashed.version);
```

Lifecycle rules:

- Archiving clears `isPinned`.
- Only active notes can be pinned.
- Trash preserves the previous archive and pin state.
- Restore clears only trash state and returns to the previous state.
- Trashed notes cannot be edited or receive/modify images.
- Permanent deletion is allowed only from trash.
- Once permanent purge is claimed, the note is no longer visible or restorable.

Permanent deletion returns `202 Accepted`:

```ts
await notesService.permanentlyDelete(trashed.id, trashed.version);
```

Remove the note from local state immediately after the `202` response. External object cleanup may continue in the background.

## Signed Image URLs

`NoteImage.url` is a temporary private read URL. It is not a permanent object URL.

```ts
function imageUrlIsExpired(image: NoteImage): boolean {
  return Date.parse(image.urlExpiresAt) <= Date.now();
}
```

When a signed read URL expires, refetch the note to receive a new URL. Do not persist signed URLs in a database or long-lived client cache.

## Recommended Frontend State Rules

- Store the complete returned `Note` after every successful mutation.
- Use `note.version` for the next `If-Match` value.
- Serialize autosaves and image mutations per note.
- Keep unsaved draft text separately until a PATCH succeeds.
- Refetch on `412` instead of blindly retrying stale data.
- Remove purged notes from cache after `202`.
- Invalidate active, archived, and trash list caches after lifecycle changes.
- Refresh a note when any `urlExpiresAt` has passed.
- Never expose or request a Supabase service-role key in frontend code.

## Common Error Handling

```ts
function messageForNotesError(error: unknown): string {
  if (!(error instanceof NotesApiError)) {
    return "Something went wrong.";
  }

  switch (error.status) {
    case 401:
      return "Your session expired. Sign in again.";
    case 404:
      return "This note is no longer available.";
    case 409:
      return error.message;
    case 412:
      return "This note changed elsewhere. Reload it before saving.";
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
```

## Endpoint Reference

| Method | Endpoint | `If-Match` |
|--------|----------|------------|
| `POST` | `/api/notes` | No |
| `GET` | `/api/notes` | No |
| `GET` | `/api/notes/:noteId` | No |
| `PATCH` | `/api/notes/:noteId` | Yes |
| `POST` | `/api/notes/:noteId/archive` | Yes |
| `POST` | `/api/notes/:noteId/unarchive` | Yes |
| `POST` | `/api/notes/:noteId/trash` | Yes |
| `POST` | `/api/notes/:noteId/restore` | Yes |
| `DELETE` | `/api/notes/:noteId` | Yes |
| `POST` | `/api/notes/:noteId/images/upload-intents` | No |
| `POST` | `/api/notes/:noteId/images/:imageId/confirm` | Yes |
| `PUT` | `/api/notes/:noteId/images/order` | Yes |
| `DELETE` | `/api/notes/:noteId/images/:imageId` | Yes |
