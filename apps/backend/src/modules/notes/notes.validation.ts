import { z } from "zod";
import { ApiError } from "../../utils/ApiError";
import {
  NOTE_COLORS,
  NOTE_CONTENT_MAX_LENGTH,
  NOTE_CURSOR_MAX_LENGTH,
  NOTE_IMAGE_LIMIT,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_IMAGE_MIME_TYPES,
  NOTE_LIST_DEFAULT_LIMIT,
  NOTE_LIST_MAX_LIMIT,
  NOTE_LIST_MIN_LIMIT,
  NOTE_TITLE_MAX_LENGTH,
  NOTE_VIEWS,
  type NoteImageMimeType,
  type NoteView,
} from "./notes.types";

export const CUID_PATTERN = /^c[a-z0-9]{24}$/;
export const IF_MATCH_PATTERN = /^"([1-9]\d*)"$/;
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
export const ISO_OFFSET_DATE_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const noteColorSchema = z.enum(NOTE_COLORS);
export const noteViewSchema = z.enum(NOTE_VIEWS);
export const noteImageMimeTypeSchema = z.enum(NOTE_IMAGE_MIME_TYPES);
export const cuidSchema = z.string().regex(CUID_PATTERN, "Invalid CUID");

const noteTitleSchema = z
  .string()
  .max(
    NOTE_TITLE_MAX_LENGTH,
    `Title must be at most ${NOTE_TITLE_MAX_LENGTH} characters`,
  );

const noteContentSchema = z
  .string()
  .max(
    NOTE_CONTENT_MAX_LENGTH,
    `Content must be at most ${NOTE_CONTENT_MAX_LENGTH} characters`,
  );

export const createNoteSchema = z
  .object({
    title: noteTitleSchema.optional(),
    content: noteContentSchema.optional(),
    color: noteColorSchema.optional(),
  })
  .strict();

export const patchNoteSchema = z
  .object({
    title: noteTitleSchema.optional(),
    content: noteContentSchema.optional(),
    color: noteColorSchema.optional(),
    isPinned: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.content !== undefined ||
      data.color !== undefined ||
      data.isPinned !== undefined,
    { message: "At least one field must be provided" },
  );

const imageIdSchema = z
  .string()
  .regex(CUID_PATTERN, "Each image id must be a valid CUID");

export const imageOrderSchema = z
  .object({
    imageIds: z
      .array(imageIdSchema)
      .max(
        NOTE_IMAGE_LIMIT,
        `imageIds must contain at most ${NOTE_IMAGE_LIMIT} items`,
      )
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "imageIds must not contain duplicates",
      }),
  })
  .strict();

export const uploadIntentSchema = z
  .object({
    mimeType: noteImageMimeTypeSchema,
    sizeBytes: z
      .number()
      .refine(Number.isSafeInteger, "sizeBytes must be a safe integer")
      .positive("sizeBytes must be greater than zero")
      .max(
        NOTE_IMAGE_MAX_BYTES,
        `sizeBytes must be at most ${NOTE_IMAGE_MAX_BYTES}`,
      ),
  })
  .strict();

function isValidIsoOffsetDate(value: string): boolean {
  if (!ISO_OFFSET_DATE_PATTERN.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1] && Number.isFinite(Date.parse(value));
}

export const isoOffsetDateSchema = z
  .string()
  .refine(isValidIsoOffsetDate, "Invalid ISO date with offset");

export const activeNoteCursorSchema = z
  .object({
    view: z.literal("active"),
    isPinned: z.boolean(),
    updatedAt: isoOffsetDateSchema,
    id: cuidSchema,
  })
  .strict();

export const archivedNoteCursorSchema = z
  .object({
    view: z.literal("archived"),
    updatedAt: isoOffsetDateSchema,
    id: cuidSchema,
  })
  .strict();

export const trashNoteCursorSchema = z
  .object({
    view: z.literal("trash"),
    trashedAt: isoOffsetDateSchema,
    id: cuidSchema,
  })
  .strict();

export const noteCursorSchema = z.discriminatedUnion("view", [
  activeNoteCursorSchema,
  archivedNoteCursorSchema,
  trashNoteCursorSchema,
]);

export type ActiveNoteCursor = z.infer<typeof activeNoteCursorSchema>;
export type ArchivedNoteCursor = z.infer<typeof archivedNoteCursorSchema>;
export type TrashNoteCursor = z.infer<typeof trashNoteCursorSchema>;
export type NoteCursor = z.infer<typeof noteCursorSchema>;
export type NoteCursorForView<View extends NoteView> = Extract<
  NoteCursor,
  { view: View }
>;

function invalidCursor(): ApiError {
  return new ApiError("Invalid cursor", 400);
}

export function encodeNoteCursor(cursor: NoteCursor): string {
  const parsed = noteCursorSchema.safeParse(cursor);
  if (!parsed.success) throw invalidCursor();

  const json = JSON.stringify(parsed.data);
  if (json === undefined) throw invalidCursor();

  const encoded = Buffer.from(json, "utf8").toString("base64url");
  if (encoded.length > NOTE_CURSOR_MAX_LENGTH) throw invalidCursor();
  return encoded;
}

export function decodeNoteCursor<View extends NoteView>(
  rawCursor: unknown,
  requestedView: View,
): NoteCursorForView<View> {
  if (
    typeof rawCursor !== "string" ||
    rawCursor.length === 0 ||
    rawCursor.length > NOTE_CURSOR_MAX_LENGTH ||
    !BASE64URL_PATTERN.test(rawCursor) ||
    !noteViewSchema.safeParse(requestedView).success
  ) {
    throw invalidCursor();
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(rawCursor, "base64url");
  } catch {
    throw invalidCursor();
  }

  if (bytes.length === 0 || bytes.toString("base64url") !== rawCursor) {
    throw invalidCursor();
  }

  const json = bytes.toString("utf8");
  if (!Buffer.from(json, "utf8").equals(bytes)) throw invalidCursor();

  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch {
    throw invalidCursor();
  }

  const parsed = noteCursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.view !== requestedView) {
    throw invalidCursor();
  }

  return parsed.data as NoteCursorForView<View>;
}

const encodedCursorSchema = z
  .string()
  .min(1, "cursor must not be empty")
  .max(
    NOTE_CURSOR_MAX_LENGTH,
    `cursor must be at most ${NOTE_CURSOR_MAX_LENGTH} characters`,
  )
  .regex(BASE64URL_PATTERN, "cursor must be canonical base64url");

const listLimitSchema = z.preprocess(
  (value) =>
    typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : value,
  z
    .number()
    .int("limit must be an integer")
    .min(NOTE_LIST_MIN_LIMIT, `limit must be at least ${NOTE_LIST_MIN_LIMIT}`)
    .max(NOTE_LIST_MAX_LIMIT, `limit must be at most ${NOTE_LIST_MAX_LIMIT}`),
);

export const listNotesQuerySchema = z
  .object({
    view: noteViewSchema.default("active"),
    limit: listLimitSchema.default(NOTE_LIST_DEFAULT_LIMIT),
    cursor: encodedCursorSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.cursor === undefined) return;

    try {
      decodeNoteCursor(query.cursor, query.view);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Invalid cursor",
      });
    }
  });

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type PatchNoteInput = z.infer<typeof patchNoteSchema>;
export type ImageOrderInput = z.infer<typeof imageOrderSchema>;
export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
export type ParsedListNotesQuery = {
  [View in NoteView]: {
    view: View;
    limit: number;
    cursor: NoteCursorForView<View> | null;
  };
}[NoteView];

function formatIssues(issues: ReadonlyArray<{ message: string }>): string {
  return issues.map((issue) => issue.message).join(", ");
}

function parseBadRequest<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(formatIssues(parsed.error.issues), 400);
  }
  return parsed.data;
}

export function parseCreateNote(value: unknown): CreateNoteInput {
  return parseBadRequest(createNoteSchema, value);
}

export function parsePatchNote(value: unknown): PatchNoteInput {
  return parseBadRequest(patchNoteSchema, value);
}

export function parseImageOrder(value: unknown): ImageOrderInput {
  return parseBadRequest(imageOrderSchema, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNoteImageMimeType(
  value: unknown,
): value is NoteImageMimeType {
  return (
    typeof value === "string" &&
    (NOTE_IMAGE_MIME_TYPES as readonly string[]).includes(value)
  );
}

export function parseUploadIntent(value: unknown): UploadIntentInput {
  if (!isRecord(value)) {
    throw new ApiError("Upload intent body must be an object", 400);
  }

  if (typeof value.mimeType !== "string") {
    throw new ApiError("mimeType must be a string", 400);
  }
  if (!isNoteImageMimeType(value.mimeType)) {
    throw new ApiError("Unsupported image MIME type", 415);
  }

  const sizeBytes = value.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new ApiError("sizeBytes must be a positive integer", 400);
  }
  if (sizeBytes > NOTE_IMAGE_MAX_BYTES) {
    throw new ApiError(
      `Image size exceeds the ${NOTE_IMAGE_MAX_BYTES} byte limit`,
      413,
    );
  }

  return parseBadRequest(uploadIntentSchema, value);
}

export function parseListNotesQuery(value: unknown): ParsedListNotesQuery {
  const query = parseBadRequest(listNotesQuerySchema, value);

  switch (query.view) {
    case "active":
      return {
        view: query.view,
        limit: query.limit,
        cursor:
          query.cursor === undefined
            ? null
            : decodeNoteCursor(query.cursor, query.view),
      };
    case "archived":
      return {
        view: query.view,
        limit: query.limit,
        cursor:
          query.cursor === undefined
            ? null
            : decodeNoteCursor(query.cursor, query.view),
      };
    case "trash":
      return {
        view: query.view,
        limit: query.limit,
        cursor:
          query.cursor === undefined
            ? null
            : decodeNoteCursor(query.cursor, query.view),
      };
  }
}

export function parseIfMatch(value: unknown, headerName = "If-Match"): number {
  if (value === undefined || value === null) {
    throw new ApiError(`${headerName} header is required`, 428);
  }
  if (typeof value !== "string") {
    throw new ApiError(`Invalid ${headerName} header`, 400);
  }

  const match = IF_MATCH_PATTERN.exec(value);
  if (!match) throw new ApiError(`Invalid ${headerName} header`, 400);

  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) {
    throw new ApiError(`Invalid ${headerName} header`, 400);
  }
  return version;
}

export function parseRouteId(value: unknown, parameterName = "id"): string {
  if (typeof value !== "string" || !CUID_PATTERN.test(value)) {
    throw new ApiError(`Invalid ${parameterName} parameter`, 400);
  }
  return value;
}
