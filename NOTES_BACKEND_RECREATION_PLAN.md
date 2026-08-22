# Notes Backend Recreation Plan

## Goal

Recreate the complete private Notes backend in the existing Northstar Express, Prisma, Neon, Supabase, and Vercel application.

The backend must support:

- Private user-owned notes
- Empty, text-only, image-only, and mixed notes
- Plain-text title and content
- Fixed semantic colors
- Pin, archive, trash, restore, and permanent delete behavior
- Up to 10 ordered private images per note
- Direct signed browser uploads to Supabase Storage
- Provider metadata verification before an image becomes visible
- Temporary signed read URLs
- Autosave conflict protection through `version`, `ETag`, and `If-Match`
- Seven-day trash retention
- Replay-safe, idempotent storage cleanup
- Daily bounded Vercel Cron maintenance

This document is backend-only. Clipboard reading, file pickers, drag/drop, card rendering, and conflict UI remain frontend responsibilities.

## Source Of Truth

Use the following existing repository files as behavioral references while recreating the feature:

- `prisma/schema.prisma`
- `prisma/migrations/20260822000000_add_notes/migration.sql`
- `src/modules/notes/notes.types.ts`
- `src/modules/notes/notes.validation.ts`
- `src/modules/notes/notes.storage.ts`
- `src/modules/notes/notes.service.ts`
- `src/modules/notes/notes.cleanup.ts`
- `src/modules/notes/notes.controller.ts`
- `src/modules/notes/notes.routes.ts`
- `src/modules/notes/notes.internal.ts`
- `src/modules/notes/notes.internal.routes.ts`
- `scripts/setup_note_storage.ts`
- `ENDPOINTS.md`, Notes section
- `Northstar-Backend.postman_collection.json`

Do not use ignored or stale compiled files under `dist/` as implementation source.

## Scope

### Included

- Note CRUD and lifecycle transitions
- Active, archived, and trash views
- Stable cursor pagination
- Per-note optimistic concurrency
- Private Supabase image storage
- Upload intents and direct uploads
- Image metadata confirmation
- Image ordering and deletion
- Signed image reads
- Trash retention and permanent purge
- Abandoned-upload cleanup
- Upload-token replay protection
- Authenticated user routes
- Separately protected cleanup route
- CORS support for `If-Match` and `ETag`
- Tests, API documentation, Postman examples, migration, and deployment steps

### Excluded

- Rich text or HTML storage
- Checklists
- Labels or folders for notes
- Search
- Reminders
- Sharing or collaboration
- Manual note-card ordering
- Image captions
- Thumbnails or image transformations
- OCR
- Virus scanning
- EXIF stripping
- Offline synchronization
- Account-wide storage quotas
- Distributed rate limiting
- Frontend UI implementation

## Domain Rules

- Empty title and content are valid.
- Title length is at most 200 characters.
- Content length is at most 20,000 characters.
- Notes use one of 11 fixed semantic colors.
- Active notes sort pinned first, then newest `updatedAt`, then `id`.
- Archived notes sort by newest `updatedAt`, then `id`.
- Trash sorts by newest `trashedAt`, then `id`.
- Archiving always clears `isPinned`.
- Pinning is valid only for active, non-trashed notes.
- Trash changes only `trashedAt`; it preserves prior archive and pin state.
- Restore clears only `trashedAt`, returning the note to its previous state.
- Trashed notes are readable but cannot be edited or receive/modify images.
- A note with `purgeRequestedAt` is hidden and cannot be restored.
- Missing and foreign notes/images return the same `404`.
- Every visible note mutation increments `version` exactly once.
- Invisible upload reservations and image-only cleanup status changes do not increment `version`.
- Manual and automatic purge claims increment `version` before hiding the note.

## Fixed Values And Limits

```ts
const NOTE_TITLE_MAX_LENGTH = 200;
const NOTE_CONTENT_MAX_LENGTH = 20_000;
const NOTE_LIST_DEFAULT_LIMIT = 30;
const NOTE_LIST_MAX_LIMIT = 50;
const NOTE_IMAGE_LIMIT = 10;
const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_INTENT_TTL_MS = 2 * 60 * 60 * 1000;
const UPLOAD_TOKEN_REPLAY_GRACE_MS = 5 * 60 * 1000;
const NOTE_CLEANUP_BATCH_SIZE = 25;
const IMAGE_CLEANUP_BATCH_SIZE = 50;
const STORAGE_REMOVE_BATCH_SIZE = 100;
const CLEANUP_RETRY_BACKOFF_MS = 25 * 60 * 60 * 1000;
```

Allowed MIME types:

```ts
["image/jpeg", "image/png", "image/webp"]
```

Colors:

```text
DEFAULT
RED
ORANGE
YELLOW
GREEN
TEAL
BLUE
PURPLE
PINK
BROWN
GRAY
```

## Target File Structure

```text
prisma/
  schema.prisma
  migrations/
    <timestamp>_add_notes/
      migration.sql
scripts/
  setup_note_storage.ts
src/
  config/
    env.ts
  modules/
    notes/
      notes.types.ts
      notes.validation.ts
      notes.storage.ts
      notes.service.ts
      notes.cleanup.ts
      notes.controller.ts
      notes.routes.ts
      notes.internal.ts
      notes.internal.routes.ts
      notes.validation.test.ts
      notes.storage.test.ts
      notes.service.test.ts
      notes.cleanup.test.ts
      notes.security.test.ts
```

Shared files to update:

- `src/index.ts`
- `package.json`
- `package-lock.json`
- `vercel.json`
- `.env.example` if the project adds or restores one
- `ENDPOINTS.md`
- `Northstar-Backend.postman_collection.json`

## Phase 1: Prisma Domain And Migration

### Prisma Enums

Add:

```prisma
enum NoteColor {
  DEFAULT
  RED
  ORANGE
  YELLOW
  GREEN
  TEAL
  BLUE
  PURPLE
  PINK
  BROWN
  GRAY
}

enum NoteImageStatus {
  PENDING
  READY
  DELETE_PENDING
}
```

### `Note` Model

```prisma
model Note {
  id               String    @id @default(cuid())
  userId           String
  title            String    @default("") @db.VarChar(200)
  content          String    @default("")
  color            NoteColor @default(DEFAULT)
  isPinned         Boolean   @default(false)
  archivedAt       DateTime?
  trashedAt        DateTime?
  purgeRequestedAt DateTime?
  version          Int       @default(1)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  user   User        @relation(fields: [userId], references: [id], onDelete: Restrict)
  images NoteImage[]

  @@index([userId, trashedAt, archivedAt, isPinned, updatedAt, id])
  @@index([userId, trashedAt, id])
  @@index([trashedAt, purgeRequestedAt])
  @@index([purgeRequestedAt])
  @@index([purgeRequestedAt, updatedAt])
}
```

Add `notes Note[]` to `User`.

Use `onDelete: Restrict` from `Note` to `User`. External image objects must be removed before any future account deletion can safely remove note rows.

### `NoteImage` Model

```prisma
model NoteImage {
  id                   String          @id @default(cuid())
  noteId               String
  storagePath          String          @unique
  mimeType             String
  sizeBytes            Int
  position             Int?
  status               NoteImageStatus @default(PENDING)
  uploadExpiresAt      DateTime?
  uploadTokenExpiresAt DateTime
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId, status, position])
  @@index([status, uploadExpiresAt])
  @@index([status, uploadTokenExpiresAt])
  @@index([status, updatedAt, uploadTokenExpiresAt])
}
```

`uploadTokenExpiresAt` must survive every image status. It allows cleanup to retain a tombstone until a previously issued signed upload URL is no longer replayable.

### Handwritten SQL Checks

The Prisma schema cannot represent every invariant. Add these checks to the migration:

```sql
CHECK ("version" > 0)

CHECK (NOT "isPinned" OR "archivedAt" IS NULL)

CHECK ("purgeRequestedAt" IS NULL OR "trashedAt" IS NOT NULL)

CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760)

CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'))

CHECK ("position" IS NULL OR "position" >= 0)
```

Add a status-field consistency check:

```sql
CHECK (
  ("status" = 'PENDING'
    AND "position" IS NULL
    AND "uploadExpiresAt" IS NOT NULL)
  OR
  ("status" = 'READY'
    AND "position" IS NOT NULL
    AND "uploadExpiresAt" IS NULL)
  OR
  ("status" = 'DELETE_PENDING'
    AND "position" IS NULL
    AND "uploadExpiresAt" IS NULL)
)
```

### Migration Requirements

- Use one additive migration.
- Create both PostgreSQL enum types explicitly.
- Create tables, indexes, named checks, and foreign keys explicitly.
- Do not depend on a generated migration alone; generated SQL may omit required checks.
- No data backfill is required because the tables are new.
- Run Prisma validation and generation immediately after the schema change.

Acceptance criteria:

- Prisma Client exposes `note` and `noteImage` delegates.
- Invalid versions, image sizes, MIME types, positions, and status-field combinations fail at the database layer.
- Deleting a note cascades image rows only after the service has completed storage cleanup.

## Phase 2: Dependencies, Environment, And Storage Setup

### Dependency

Add:

```json
"@supabase/supabase-js": "^2.112.3"
```

Use Node 22 or newer for the locked Supabase packages.

### Environment Variables

Add lazy getters for:

```env
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
SUPABASE_NOTE_IMAGES_BUCKET="note-images"
NOTE_IMAGE_READ_URL_TTL="15m"
NOTE_TRASH_RETENTION="7d"
CRON_SECRET="long-random-secret"
```

Rules:

- `SUPABASE_URL` must be an HTTP or HTTPS URL.
- The service-role/secret key must be nonblank.
- Bucket names must match `[a-z0-9][a-z0-9._-]{0,99}`.
- Durations require a positive integer plus `ms`, `s`, `m`, `h`, or `d`.
- Notes provider variables must be validated lazily so zero-image Notes operations and unrelated tests do not require Supabase configuration.
- `CRON_SECRET` must be read only when cleanup authentication is evaluated.
- Never return or log these values.

The environment variable is named `SUPABASE_SERVICE_ROLE_KEY`, but its value may be the modern backend-only Supabase secret key (`sb_secret_...`) or a legacy service-role JWT. Never use a publishable/anon key for bucket administration.

### Storage Adapter

Implement `notes.storage.ts` as the only module importing Supabase.

Export an object so tests can monkey-patch its methods:

```ts
storageAdapter.createSignedUploadUrl(path)
storageAdapter.createSignedReadUrls(paths)
storageAdapter.getObjectInfo(path)
storageAdapter.removeObjects(paths)
```

Requirements:

- Cache a Supabase client by URL and secret key.
- Disable persisted sessions, URL session detection, and auth token refresh.
- Reduce provider failures to a generic storage error.
- Preserve only numeric provider status where needed for `404` classification.
- Never expose provider response bodies.

Signed upload behavior:

- Call `createSignedUploadUrl(path, { upsert: false })`.
- Require an exact returned path, signed URL, and token.
- Decode the provider token JWT payload and require a valid numeric `exp`.
- Return the provider's actual expiry, not a locally estimated expiry.

Signed read behavior:

- Use `createSignedUrls(paths, expiresInSeconds)`.
- Validate every per-item result even if the HTTP call succeeds.
- Require exact input/output count, unique paths, and non-null URLs.
- Reassociate results to input paths.
- Fail the entire response if any item fails.

Object metadata behavior:

- Return top-level `size` and `contentType`.
- Treat numeric provider status `404` as an absent object.
- Convert all other failures to generic `503` at the service boundary.

Removal behavior:

- Empty path arrays are a no-op.
- Treat provider `404` and successful empty results as idempotent success.

### Bucket Setup Script

Add `scripts/setup_note_storage.ts` and:

```json
"setup:note-storage": "tsx scripts/setup_note_storage.ts"
```

The command must create or update the bucket with:

```ts
{
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
}
```

Do not create public read policies.

Acceptance criteria:

- Re-running the setup command is safe.
- Bucket management uses `supabase.storage`, not `storage.from(bucket)`.
- Browser clients never need a Supabase secret key.

## Phase 3: Public Types, Validation, And Cursors

### Public DTOs

Define explicit DTOs rather than returning raw Prisma records.

```ts
type NoteResponse = {
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
  images: Array<{
    id: string;
    mimeType: string;
    sizeBytes: number;
    position: number;
    url: string;
    urlExpiresAt: string;
  }>;
};
```

Never return:

- `userId`
- `storagePath`
- Image status
- Upload expiry fields
- `purgeRequestedAt`
- Provider tokens or raw provider errors

### Request Validation

Create note:

```ts
{
  title?: string;
  content?: string;
  color?: NoteColor;
}
```

Patch note:

```ts
{
  title?: string;
  content?: string;
  color?: NoteColor;
  isPinned?: boolean;
}
```

Patch must contain at least one field.

Upload intent:

```ts
{
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
}
```

Map errors precisely:

- Unsupported string MIME: `415`
- Size over 10 MiB: `413`
- Missing, zero, negative, fractional, or nonnumeric size: `400`

Image order:

```ts
{
  imageIds: string[];
}
```

Require at most 10 CUIDs with no duplicates. Completeness and image status are service-level validations.

### `If-Match`

Accept only:

```http
If-Match: "3"
```

Parser:

```regex
^"([1-9]\d*)"$
```

Behavior:

- Missing header: `428`
- Invalid syntax, wildcard, weak ETag, zero, negative, multiple tags, or unsafe integer: `400`
- Valid but stale version: `412`

### Cursor Pagination

List query:

```text
view=active|archived|trash
limit=1..50
cursor=<opaque>
```

Defaults:

```text
view=active
limit=30
```

Encode base64url JSON with the complete sort tuple:

```ts
{ view: "active", isPinned, updatedAt, id }
{ view: "archived", updatedAt, id }
{ view: "trash", trashedAt, id }
```

Validation must require:

- Base64url characters only
- Canonical encoding
- Maximum 2048 characters
- Matching requested view
- Valid ISO date with offset
- Valid CUID

Fetch `limit + 1`, return at most `limit`, and derive `nextCursor` from the last returned row.

Acceptance criteria:

- Equal timestamps do not skip or duplicate rows under a static dataset.
- Active pagination never moves from unpinned rows back into pinned rows.
- Cursors are treated as opaque API data.

## Phase 4: Read Services And Signed Response Mapping

Create explicit Prisma selections for notes and ready images.

All note reads must:

- Scope by `userId`.
- Exclude `purgeRequestedAt != null`.
- Include only `READY` images.
- Order images by `position ASC, id ASC`.
- Map every timestamp to an ISO string.
- Omit internal fields.

Views:

```text
active:   trashedAt=null, archivedAt=null
archived: trashedAt=null, archivedAt!=null
trash:    trashedAt!=null
```

Ordering:

```text
active:   isPinned DESC, updatedAt DESC, id DESC
archived: updatedAt DESC, id DESC
trash:    trashedAt DESC, id DESC
```

Signed read mapping:

1. Collect all ready `storagePath` values needed by the response.
2. Deduplicate paths.
3. Sign them in one adapter call.
4. Verify all paths received URLs.
5. Map URLs back to public images.
6. Compute one `urlExpiresAt` for that response.
7. Throw safe `503` if signing fails.

Never return partial ready-image DTOs or a storage path.

Zero-image reads must not initialize Supabase.

## Phase 5: Ownership And Versioned Mutation Foundation

### Ownership

Every user lookup must combine resource identity with `userId`.

Rules:

- Missing and foreign notes return the same `404`.
- Missing and foreign images return the same `404`.
- A purge-claimed note returns `404`.
- Do not contact storage after ownership validation fails.

### Parent Row Lock

For multi-row image mutations, use a callback transaction and:

```sql
SELECT "id"
FROM "Note"
WHERE "id" = $noteId AND "userId" = $userId
FOR UPDATE
```

Follow the existing lock precedent in the auth service.

### Compare-And-Swap

Every visible mutation condition must include:

- `id`
- `userId`
- Expected `version`
- `purgeRequestedAt: null`
- Required lifecycle predicates

If the conditional update changes zero rows, perform an owned read inside the transaction only to classify:

1. Missing, foreign, or purge claimed: `404`
2. Version differs: `412`
3. Version matches but lifecycle is invalid: `409`

Never follow a failed conditional update with an unconditional write.

### Response Signing Before Commit

Visible mutations return a complete note, including signed ready-image URLs. Mint required read URLs before the write transaction so a signing failure returns `503` without committing a visible state change.

After pre-signing, revalidate version and lifecycle atomically during the transaction. A concurrent mutation must still fail the compare-and-swap.

## Phase 6: Create, Patch, And Lifecycle Services

### Create

- Accept optional title, content, and color.
- Default title/content to empty and color to `DEFAULT`.
- Return `201`, complete note DTO, and `ETag: "1"`.

### Patch

- Allow title/content/color on active or archived notes.
- Reject trashed notes.
- Permit `isPinned:true` only while active.
- Increment version once.
- Return complete updated note and new ETag.

### Archive

- Require active note.
- Set `archivedAt`.
- Clear `isPinned`.
- Increment version.

### Unarchive

- Require archived, non-trashed note.
- Clear `archivedAt`.
- Increment version.

### Trash

- Require non-trashed note.
- Set only `trashedAt`.
- Preserve `archivedAt` and `isPinned`.
- Increment version.

### Restore

- Require unclaimed trash note.
- Clear only `trashedAt`.
- Increment version.

Acceptance criteria:

- Invalid state transitions return `409`.
- Stale versions return `412` even during autosave races.
- Restore cannot win after cleanup has claimed purge.

## Phase 7: Image Upload Intent

Input:

```json
{
  "mimeType": "image/png",
  "sizeBytes": 123456
}
```

Inside a short callback transaction:

1. Lock the owned parent note.
2. Reject purge-claimed/missing as `404`.
3. Reject trash as `409`.
4. Count images with status `PENDING` or `READY`.
5. Reject count 10 or greater.
6. Insert a `PENDING` row with a unique internal placeholder path.
7. Use the Prisma-generated CUID to update the path to:

```text
users/{userId}/notes/{noteId}/{imageId}.{jpg|png|webp}
```

Never use a client filename or client-supplied path.

After commit:

1. Create a non-upsert signed upload URL.
2. Parse the actual provider token expiry.
3. Persist that expiry into both upload-expiry fields before returning the URL.
4. Require the image still be pending and the note still be untrashed/unclaimed.

Response:

```json
{
  "imageId": "...",
  "uploadUrl": "https://...",
  "uploadExpiresAt": "...",
  "method": "PUT",
  "headers": {
    "Content-Type": "image/png"
  }
}
```

If URL creation fails:

- Attempt to delete the invisible reservation.
- Leave failed compensation for cleanup.
- Return safe `503`.

Intent creation does not increment note version.

## Phase 8: Image Confirmation

Confirmation requires current `If-Match`.

Before provider I/O:

- Find image through the owned, unclaimed parent.
- Require matching note version.
- Require untrashed note.
- Require unexpired `PENDING` status.

Provider verification:

- Call object `info`.
- Require a safe positive integer size.
- Require size no greater than 10 MiB.
- Require exact declared size.
- Require exact declared MIME.
- Require MIME remains in the allowed set.

If metadata is absent or invalid:

- Move the row to `DELETE_PENDING`.
- Clear position and upload expiry.
- Attempt removal.
- Preserve replay tombstone when necessary.
- Return `422`.

For valid metadata:

1. Pre-sign existing ready images plus the candidate.
2. Lock the parent note.
3. Recheck ownership, version, trash state, and image status.
4. Normalize ready positions to contiguous order.
5. Atomically convert the candidate to `READY`.
6. Assign `position = readyImageCount`.
7. Clear `uploadExpiresAt`.
8. Increment note version once.

The final image update must compare expiry using one PostgreSQL wall-clock value evaluated after parent-lock acquisition:

```sql
WITH db_clock AS (
  SELECT clock_timestamp() AS checked_at
)
UPDATE "NoteImage"
...
WHERE "uploadExpiresAt" > db_clock.checked_at
```

Do not use a request-start timestamp or PostgreSQL `CURRENT_TIMESTAMP`, which is fixed at transaction start and can allow a lock wait to cross the expiry boundary.

If another visible mutation wins during provider calls, return `412` and leave the upload pending so confirmation can be retried before expiry.

## Phase 9: Image Reorder And Delete

### Reorder

Input must be the complete ordered array of all ready image IDs.

Validate before signing and again inside the parent-lock transaction:

- Every supplied ID belongs to the note.
- Every supplied image is `READY`.
- There are no duplicates.
- Supplied length equals current ready-image count.

Rewrite every ready position to its array index and increment note version.

Errors:

- Missing/foreign ID: `404`
- Pending or delete-pending image: `409`
- Incomplete permutation: `409`

### Delete

Inside the parent-lock transaction:

1. Recheck ownership, version, and non-trash state.
2. Require the target image is ready and belongs to the note.
3. Change it to `DELETE_PENDING`.
4. Clear position and upload expiry.
5. Compact remaining ready positions.
6. Increment note version.
7. Return the complete note without the image.

After commit:

- Attempt provider removal.
- Do not fail the visible mutation if removal fails.
- Leave the row for cleanup.

## Phase 10: Replay-Safe Object Deletion

A signed non-upsert upload URL may remain usable after its original object is deleted. If the database row is removed immediately, replaying the URL could recreate an object that cleanup can no longer discover.

For every image deletion:

1. Remove the current object.
2. Compute:

```text
safeDeleteAt = uploadTokenExpiresAt + 5 minutes
```

3. If `safeDeleteAt` is in the future:
   - Keep the `DELETE_PENDING` row.
   - Set `updatedAt` to the safe deletion time.
4. After that time:
   - Remove the path again.
   - Delete the database row.

For full note purge, retain the note and all child paths until the latest child `safeDeleteAt`. Perform a final removal before deleting the note.

This tombstone and final sweep are mandatory. Do not simplify cleanup to one storage removal followed by immediate row deletion.

## Phase 11: Trash Purge And Cleanup

### Manual Permanent Delete

- Require a trashed note.
- Require current `If-Match`.
- Lock/recheck parent state.
- Atomically set `purgeRequestedAt` and increment version.
- Hide the note immediately.
- Invoke the same idempotent purge routine used by cron.
- Return `202` whether immediate provider cleanup succeeds or is deferred.

### Automatic Trash Claim

Use a bounded PostgreSQL CTE:

```sql
WITH candidates AS (
  SELECT "id"
  FROM "Note"
  WHERE "trashedAt" <= $retentionCutoff
    AND "purgeRequestedAt" IS NULL
  ORDER BY "trashedAt", "id"
  FOR UPDATE SKIP LOCKED
  LIMIT 25
)
UPDATE "Note" ...
RETURNING "id";
```

Claiming must atomically:

- Set `purgeRequestedAt`.
- Increment version.
- Set `updatedAt`.

### Abandoned Upload Claim

Use another bounded `SKIP LOCKED` CTE to select expired `PENDING` images, limit 50, and change them to `DELETE_PENDING` while clearing upload expiry and position.

### Retry Behavior

- Select only work with `updatedAt <= now`.
- Defer still-replayable tombstones until their safe deletion time.
- On provider/database failure, schedule `updatedAt = now + 25 hours`.
- The retry delay must remain longer than the daily cron interval so permanently failing rows cannot monopolize every batch.
- Treat absent provider objects as success.
- Make every provider removal and conditional database delete idempotent.

### Cleanup Result

Return counts only:

```ts
{
  claimedNotes,
  purgedNotes,
  deferredNotePurges,
  failedNotePurges,
  claimedUploads,
  deletedImages,
  deferredImageDeletes,
  failedImageDeletes,
}
```

Never log storage paths, signed URLs, tokens, or secrets.

## Phase 12: Routes, Controllers, ETags, And CORS

### User Routes

Mount under `/api/notes` and apply `authenticate` to the router.

| Method | Path | `If-Match` | Success |
|--------|------|------------|---------|
| `POST` | `/api/notes` | No | `201` note |
| `GET` | `/api/notes` | No | `200` page |
| `GET` | `/api/notes/:noteId` | No | `200` note |
| `PATCH` | `/api/notes/:noteId` | Yes | `200` note |
| `POST` | `/api/notes/:noteId/archive` | Yes | `200` note |
| `POST` | `/api/notes/:noteId/unarchive` | Yes | `200` note |
| `POST` | `/api/notes/:noteId/trash` | Yes | `200` note |
| `POST` | `/api/notes/:noteId/restore` | Yes | `200` note |
| `DELETE` | `/api/notes/:noteId` | Yes | `202` message |
| `POST` | `/api/notes/:noteId/images/upload-intents` | No | `201` intent |
| `POST` | `/api/notes/:noteId/images/:imageId/confirm` | Yes | `200` note |
| `PUT` | `/api/notes/:noteId/images/order` | Yes | `200` note |
| `DELETE` | `/api/notes/:noteId/images/:imageId` | Yes | `200` note |

Controllers must:

- Require authenticated `req.user.userId`.
- Validate route IDs as CUIDs.
- Parse query/body/header input.
- Set `ETag: "<note.version>"` on every single-note response.
- Return the existing `{ success, data }` or `{ success, message }` envelopes.
- Let Express 5 propagate rejected async handlers to the global error handler.

### Internal Cleanup Route

Mount:

```http
GET /api/internal/notes/cleanup
Authorization: Bearer <CRON_SECRET>
```

Do not apply user JWT authentication to this route.

Authenticate by hashing both expected and supplied values with SHA-256, then compare equal-length digests using `timingSafeEqual`.

### CORS

Ensure:

```ts
allowedHeaders: ["Content-Type", "Authorization", "If-Match"]
exposedHeaders: ["ETag"]
methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
```

Without these headers, browser clients cannot perform versioned autosave.

## Phase 13: Status Codes And Safe Errors

| Status | Meaning |
|--------|---------|
| `200` | Read, mutation, or cleanup success |
| `201` | Note or upload intent created |
| `202` | Purge accepted |
| `400` | Invalid body, query, CUID, cursor, or header syntax |
| `401` | Missing/invalid user token or cron secret |
| `403` | Browser origin rejected |
| `404` | Missing/foreign resource or purge already claimed |
| `409` | Invalid lifecycle, image state/order/limit, expired intent, or race |
| `412` | Stale note version |
| `413` | Declared image exceeds 10 MiB |
| `415` | Unsupported image MIME |
| `422` | Provider object missing or metadata mismatch |
| `428` | Required `If-Match` missing |
| `500` | Generic database/config/runtime failure |
| `503` | Storage provider/signing/metadata unavailable |

Provider errors must never be passed directly to `ApiError` or the response body.

## Phase 14: Tests

### Validation Tests

- Empty notes
- Title at 200 and 201 characters
- Content at 20,000 and 20,001 characters
- Fixed color enum
- Empty patch rejection
- MIME validation
- Size validation and exact status mapping
- Strict `If-Match`
- List defaults and bounds
- Cursor round-trip, tampering, and wrong-view rejection
- Duplicate, malformed, and oversized image-order arrays

### Storage Adapter Tests

- Non-upsert upload URL creation
- Exact returned path validation
- Provider token `exp` parsing
- Invalid/opaque token rejection
- Per-item signed-read failures
- Exact path reassociation
- Metadata camel-case mapping
- Numeric `404` to null
- Idempotent absent-object removal
- Generic provider errors with no secret leakage
- Bucket create and update behavior

### Service Tests

- Same `404` for missing and foreign notes/images
- No storage call after ownership failure
- All view filters and ordering
- Cursor ties
- Explicit DTO omission of internal fields
- Failed CAS never performs unconditional write
- Response signing failure occurs before visible commit
- Pin/archive rules
- Trash state preservation
- Restore versus purge claim
- Parent lock and concurrent 10-image enforcement
- Upload intent compensation
- Exact storage path generation
- Actual provider expiry persistence
- Confirmation version race
- Database wall-clock expiry predicate
- Metadata mismatch deletion
- Reorder foreign/pending/incomplete handling
- Image delete compaction
- Manual purge reuse

### Cleanup Tests

- Bounded `SKIP LOCKED` SQL
- Seven-day cutoff
- Restore cannot win after claim
- Abandoned upload claim
- Missing objects treated as success
- Provider failure retry scheduling
- Database delete failure after provider success
- 25-hour fairness backoff
- Image tombstone final sweep
- Full-note replay-safe final sweep
- Bounded batch counts

### Route And Security Tests

- All user routes require authentication
- Foreign note/image requests return `404`
- Missing `If-Match` returns `428`
- Unsupported MIME returns `415`
- Oversize returns `413`
- Invalid cron secret returns `401`
- Cron secret comparison is exact
- Service key never appears in responses
- CORS allows `If-Match` and exposes `ETag`

### Real Integration Tests

Mocked unit tests are not sufficient for final rollout. Against non-production Neon and Supabase:

1. Apply the migration.
2. Create the private bucket.
3. Create a note.
4. Create an upload intent.
5. Upload raw bytes directly.
6. Confirm the image.
7. Read the signed image URL.
8. Reorder two images.
9. Exercise stale `If-Match` from two clients.
10. Trash and restore.
11. Permanently delete.
12. Run cleanup.
13. Verify all storage objects are gone.
14. Verify direct unauthenticated bucket reads fail.
15. Verify a replayed old upload URL cannot leave an orphan after final cleanup.

## Phase 15: Documentation And Postman

Update `ENDPOINTS.md` with:

- All routes
- DTOs
- List views and cursor behavior
- `ETag` and `If-Match`
- Lifecycle rules
- Upload sequence
- Exact direct PUT requirements
- Signed URL expiry
- Replay-safe tombstones
- Cleanup result
- Error status table
- Environment and bucket setup

Update the Postman collection with:

- All 13 user endpoints
- Internal cleanup request
- Explicit bearer auth on every protected request
- Explicit `Content-Type` on JSON requests
- `If-Match` examples
- Empty `cronSecret` variable
- Request-local note/image path variables
- Upload sequence instructions

Never commit real tokens, keys, signed URLs, or object paths.

## Phase 16: Deployment And Operations

### Deployment Order

1. Use Node 22 or newer.
2. Provision a separate private Supabase bucket.
3. Store Supabase secret/service-role and cron credentials in backend-only deployment secrets.
4. Run `npm run setup:note-storage`.
5. Apply the additive migration with `npm run prisma:deploy`.
6. Generate Prisma Client.
7. Deploy routes and the daily cron.
8. Run the complete non-production smoke path.
9. Expose the feature to clients only after storage and concurrency checks pass.

### Vercel Cron

Configure:

```json
{
  "path": "/api/internal/notes/cleanup",
  "schedule": "0 3 * * *"
}
```

Vercel must send `Authorization: Bearer <CRON_SECRET>`.

### Monitoring

Monitor counts and rates for:

- `412` conflicts
- `422` metadata failures
- `503` storage failures
- Pending images older than expected
- Delete-pending backlog
- Claimed purge backlog
- Deferred cleanup work
- Failed cleanup work
- Upload completion rate
- Storage growth

Log IDs and aggregate counts only where needed for operations. Do not log storage paths or signed URLs.

### Rollback

1. Disable Notes user routes.
2. Disable the cleanup cron only if object paths remain safely recoverable.
3. Preserve note/image tables while cleanup is outstanding.
4. Enumerate and remove storage objects.
5. Drop schema only after no object path is needed for cleanup.

Do not roll back by dropping tables first; doing so loses the paths required to remove private objects.

## Verification Commands

Run:

```text
npx prisma format
npx prisma validate
npm run prisma:generate
npm test
npm run lint
npm run build
git diff --check
```

Validate Postman and Vercel JSON syntax separately.

Do not run a migration or destructive storage smoke test against an unidentified or production database/project.

## Definition Of Done

- [ ] Prisma models, enums, indexes, and handwritten SQL checks are complete.
- [ ] User deletion is restricted while notes with external objects exist.
- [ ] Supabase credentials are lazy and backend-only.
- [ ] Bucket setup is idempotent and private.
- [ ] Public DTOs cannot expose internal paths or purge/upload state.
- [ ] All user reads and writes enforce ownership.
- [ ] Missing and foreign resources are indistinguishable.
- [ ] Cursor pagination includes complete deterministic sort tuples.
- [ ] Every visible mutation requires current `If-Match` and increments version once.
- [ ] Failed CAS operations never fall back to unconditional writes.
- [ ] Signing failure cannot occur after a visible mutation has committed.
- [ ] Upload intents enforce pending-plus-ready count under a parent lock.
- [ ] Provider token expiry is persisted before returning an upload URL.
- [ ] Confirmation verifies exact provider MIME and size.
- [ ] Confirmation uses PostgreSQL wall-clock time after lock acquisition.
- [ ] Image order remains contiguous.
- [ ] Deleted images disappear transactionally and clean up asynchronously.
- [ ] Replayable upload URLs cannot create undiscoverable orphan objects.
- [ ] Trash claims are atomic and cannot race restore.
- [ ] Cleanup is bounded, idempotent, retryable, and starvation-safe.
- [ ] Cron authorization uses constant-time comparison.
- [ ] CORS supports `If-Match` and `ETag`.
- [ ] Validation, service, storage, cleanup, route, and security tests pass.
- [ ] Real Neon/Supabase smoke tests pass in non-production.
- [ ] API and Postman documentation match implementation.
- [ ] Rollback preserves object paths until external cleanup is complete.

## Recommended Implementation Order

1. Prisma models and handwritten migration
2. Supabase dependency, lazy configuration, and bucket setup
3. DTOs, validation, `If-Match`, and cursor codec
4. Owned reads, response mapping, and signed read batching
5. CAS mutation foundation and lifecycle services
6. Upload intent and provider-expiry persistence
7. Confirmation and metadata verification
8. Reorder and logical image deletion
9. Replay-safe tombstones and purge routine
10. Bounded cleanup claims, retries, and cron authorization
11. Controllers, routes, mounting, ETags, and CORS
12. Tests, docs, Postman, deployment smoke test, and monitoring

This order establishes database and concurrency invariants before adding external storage side effects.
