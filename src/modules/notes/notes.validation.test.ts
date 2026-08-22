import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../../utils/ApiError";
import {
  decodeNoteCursor,
  encodeNoteCursor,
  isNoteImageMimeType,
  parseCreateNote,
  parseIfMatch,
  parseImageOrder,
  parseListNotesQuery,
  parsePatchNote,
  parseRouteId,
  parseUploadIntent,
  type ActiveNoteCursor,
  type ArchivedNoteCursor,
  type NoteCursor,
  type TrashNoteCursor,
} from "./notes.validation";
import {
  NOTE_COLORS,
  NOTE_CONTENT_MAX_LENGTH,
  NOTE_CURSOR_MAX_LENGTH,
  NOTE_IMAGE_EXTENSION_BY_MIME_TYPE,
  NOTE_IMAGE_LIMIT,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_IMAGE_MIME_TYPES,
  NOTE_LIST_DEFAULT_LIMIT,
  NOTE_LIST_MAX_LIMIT,
  NOTE_LIST_MIN_LIMIT,
  NOTE_TITLE_MAX_LENGTH,
  NOTE_VIEWS,
  type NoteView,
} from "./notes.types";

function assertApiError(
  operation: () => unknown,
  expectedStatus: number,
  description: string,
  expectedMessage?: RegExp,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ApiError, `${description}: expected ApiError`);
    assert.equal(error.statusCode, expectedStatus, description);
    if (expectedMessage !== undefined) {
      assert.match(error.message, expectedMessage, description);
    }
    return true;
  });
}

function makeCuid(index: number): string {
  return `c${index.toString(36).padStart(24, "0")}`;
}

function encodeOpaque(value: unknown): string {
  const json = JSON.stringify(value);
  assert.ok(json !== undefined);
  return Buffer.from(json, "utf8").toString("base64url");
}

function makeNonCanonicalEquivalent(encoded: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const remainder = encoded.length % 4;
  assert.ok(
    remainder === 2 || remainder === 3,
    "fixture must end with unused base64url bits",
  );

  const last = encoded.at(-1);
  assert.ok(last !== undefined);
  const lastValue = alphabet.indexOf(last);
  assert.notEqual(lastValue, -1);

  const unusedBitsMask = remainder === 2 ? 0b1111 : 0b11;
  assert.equal(lastValue & unusedBitsMask, 0);
  return `${encoded.slice(0, -1)}${alphabet[lastValue | 1]}`;
}

const CUID_A = makeCuid(1);
const CUID_B = makeCuid(2);

const ACTIVE_CURSOR: ActiveNoteCursor = {
  view: "active",
  isPinned: false,
  updatedAt: "2026-08-22T08:03:33.123Z",
  id: CUID_A,
};

const ARCHIVED_CURSOR: ArchivedNoteCursor = {
  view: "archived",
  updatedAt: "2026-08-22T17:03:33+09:00",
  id: CUID_B,
};

const TRASH_CURSOR: TrashNoteCursor = {
  view: "trash",
  trashedAt: "2024-02-29T23:59:59.999-04:30",
  id: makeCuid(3),
};

test("exports the fixed Phase 14 note validation values", () => {
  assert.deepEqual(NOTE_COLORS, [
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
  ]);
  assert.deepEqual(NOTE_VIEWS, ["active", "archived", "trash"]);
  assert.deepEqual(NOTE_IMAGE_MIME_TYPES, [
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  assert.deepEqual(NOTE_IMAGE_EXTENSION_BY_MIME_TYPE, {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  });
  assert.equal(NOTE_TITLE_MAX_LENGTH, 200);
  assert.equal(NOTE_CONTENT_MAX_LENGTH, 20_000);
  assert.equal(NOTE_LIST_MIN_LIMIT, 1);
  assert.equal(NOTE_LIST_DEFAULT_LIMIT, 30);
  assert.equal(NOTE_LIST_MAX_LIMIT, 50);
  assert.equal(NOTE_CURSOR_MAX_LENGTH, 2_048);
  assert.equal(NOTE_IMAGE_LIMIT, 10);
  assert.equal(NOTE_IMAGE_MAX_BYTES, 10 * 1024 * 1024);
});

test("accepts an empty create and empty title/content", () => {
  assert.deepEqual(parseCreateNote({}), {});
  assert.deepEqual(parseCreateNote({ title: "", content: "" }), {
    title: "",
    content: "",
  });
});

test("preserves create and patch whitespace without trimming", () => {
  const values = {
    title: "  title with surrounding whitespace\t",
    content: "\n  content with surrounding whitespace  \r\n",
  };

  assert.deepEqual(parseCreateNote(values), values);
  assert.deepEqual(parsePatchNote({ ...values, isPinned: false }), {
    ...values,
    isPinned: false,
  });
});

test("enforces title length at exactly 200 and 201 characters", () => {
  const maximumTitle = "t".repeat(NOTE_TITLE_MAX_LENGTH);
  const oversizedTitle = `${maximumTitle}t`;

  assert.deepEqual(parseCreateNote({ title: maximumTitle }), {
    title: maximumTitle,
  });
  assert.deepEqual(parsePatchNote({ title: maximumTitle }), {
    title: maximumTitle,
  });
  assertApiError(
    () => parseCreateNote({ title: oversizedTitle }),
    400,
    "201-character create title",
  );
  assertApiError(
    () => parsePatchNote({ title: oversizedTitle }),
    400,
    "201-character patch title",
  );
});

test("enforces content length at exactly 20,000 and 20,001 characters", () => {
  const maximumContent = "c".repeat(NOTE_CONTENT_MAX_LENGTH);
  const oversizedContent = `${maximumContent}c`;

  assert.deepEqual(parseCreateNote({ content: maximumContent }), {
    content: maximumContent,
  });
  assert.deepEqual(parsePatchNote({ content: maximumContent }), {
    content: maximumContent,
  });
  assertApiError(
    () => parseCreateNote({ content: oversizedContent }),
    400,
    "20,001-character create content",
  );
  assertApiError(
    () => parsePatchNote({ content: oversizedContent }),
    400,
    "20,001-character patch content",
  );
});

test("accepts every fixed color and rejects fake or malformed colors", () => {
  for (const color of NOTE_COLORS) {
    assert.deepEqual(parseCreateNote({ color }), { color });
    assert.deepEqual(parsePatchNote({ color }), { color });
  }

  const invalidColors: ReadonlyArray<readonly [string, unknown]> = [
    ["unknown color", "BLACK"],
    ["wrong case", "red"],
    ["empty string", ""],
    ["number", 1],
    ["null", null],
  ];
  for (const [description, color] of invalidColors) {
    assertApiError(
      () => parseCreateNote({ color }),
      400,
      `create ${description}`,
    );
    assertApiError(
      () => parsePatchNote({ color }),
      400,
      `patch ${description}`,
    );
  }
});

test("rejects malformed note bodies and extra create/patch fields", () => {
  const malformedBodies: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["array", []],
    ["string", "note"],
  ];
  for (const [description, body] of malformedBodies) {
    assertApiError(
      () => parseCreateNote(body),
      400,
      `malformed create body: ${description}`,
    );
    assertApiError(
      () => parsePatchNote(body),
      400,
      `malformed patch body: ${description}`,
    );
  }

  assertApiError(
    () => parseCreateNote({ title: "valid", extra: true }),
    400,
    "extra create field",
  );
  assertApiError(
    () => parsePatchNote({ content: "valid", extra: true }),
    400,
    "extra patch field",
  );
});

test("rejects an empty patch but accepts false and empty field values", () => {
  assertApiError(() => parsePatchNote({}), 400, "empty patch");
  assertApiError(
    () => parsePatchNote({ unknown: "field" }),
    400,
    "unknown-only patch",
  );

  const validPatches: ReadonlyArray<Record<string, unknown>> = [
    { title: "" },
    { content: "" },
    { isPinned: false },
    { isPinned: true },
    { color: "DEFAULT" },
    { title: "", content: "", isPinned: false },
  ];
  for (const patch of validPatches) {
    assert.deepEqual(parsePatchNote(patch), patch);
  }
});

test("accepts every supported upload MIME and exposes an exact type guard", () => {
  for (const mimeType of NOTE_IMAGE_MIME_TYPES) {
    assert.equal(isNoteImageMimeType(mimeType), true);
    assert.deepEqual(parseUploadIntent({ mimeType, sizeBytes: 1 }), {
      mimeType,
      sizeBytes: 1,
    });
  }

  for (const value of [undefined, null, 1, {}, [], "image/gif"]) {
    assert.equal(isNoteImageMimeType(value), false);
  }
});

test("maps unsupported MIME strings to 415 and malformed MIME values to 400", () => {
  for (const mimeType of ["image/gif", "IMAGE/PNG", " image/png", ""]) {
    assertApiError(
      () => parseUploadIntent({ mimeType, sizeBytes: 1 }),
      415,
      `unsupported MIME ${JSON.stringify(mimeType)}`,
      /unsupported image MIME type/i,
    );
  }

  const malformedMimeTypes: ReadonlyArray<readonly [string, unknown]> = [
    ["missing", undefined],
    ["null", null],
    ["number", 1],
    ["boolean", true],
    ["array", ["image/png"]],
    ["object", { value: "image/png" }],
    ["boxed string", new String("image/png")],
  ];
  for (const [description, mimeType] of malformedMimeTypes) {
    assertApiError(
      () => parseUploadIntent({ mimeType, sizeBytes: 1 }),
      400,
      `malformed MIME: ${description}`,
      /mimeType must be a string/i,
    );
  }

  for (const body of [undefined, null, [], "image/png", 1]) {
    assertApiError(
      () => parseUploadIntent(body),
      400,
      "non-object upload body",
      /must be an object/i,
    );
  }
});

test("accepts exact image size boundaries and maps every oversize integer to 413", () => {
  for (const sizeBytes of [1, NOTE_IMAGE_MAX_BYTES]) {
    assert.deepEqual(
      parseUploadIntent({ mimeType: "image/png", sizeBytes }),
      { mimeType: "image/png", sizeBytes },
    );
  }

  for (const sizeBytes of [
    NOTE_IMAGE_MAX_BYTES + 1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_VALUE,
  ]) {
    assertApiError(
      () => parseUploadIntent({ mimeType: "image/png", sizeBytes }),
      413,
      `oversized image value ${sizeBytes}`,
      /exceeds/i,
    );
  }
});

test("maps missing and every malformed image size to 400", () => {
  const invalidSizes: ReadonlyArray<readonly [string, unknown]> = [
    ["missing", undefined],
    ["zero", 0],
    ["negative zero", -0],
    ["negative integer", -1],
    ["positive fraction", 1.5],
    ["negative fraction", -1.5],
    ["fraction above the byte limit", NOTE_IMAGE_MAX_BYTES + 0.5],
    ["smallest positive fraction", Number.MIN_VALUE],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["numeric string", "1"],
    ["empty string", ""],
    ["null", null],
    ["boolean", true],
    ["bigint", 1n],
    ["array", [1]],
    ["object", { value: 1 }],
  ];

  for (const [description, sizeBytes] of invalidSizes) {
    assertApiError(
      () => parseUploadIntent({ mimeType: "image/png", sizeBytes }),
      400,
      `invalid image size: ${description}`,
      /positive integer/i,
    );
  }
});

test("rejects extra upload intent fields with 400", () => {
  assertApiError(
    () =>
      parseUploadIntent({
        mimeType: "image/png",
        sizeBytes: 1,
        filename: "note.png",
      }),
    400,
    "extra upload intent field",
  );
});

test("accepts only quoted positive safe integer If-Match values", () => {
  const accepted: ReadonlyArray<readonly [string, number]> = [
    ['"1"', 1],
    ['"3"', 3],
    [`"${Number.MAX_SAFE_INTEGER}"`, Number.MAX_SAFE_INTEGER],
  ];
  for (const [raw, expected] of accepted) {
    assert.equal(parseIfMatch(raw), expected);
  }
});

test("maps missing If-Match to 428", () => {
  for (const value of [undefined, null]) {
    assertApiError(
      () => parseIfMatch(value),
      428,
      "missing If-Match",
      /required/i,
    );
  }
});

test("maps every invalid If-Match form to 400", () => {
  const rejected: ReadonlyArray<readonly [string, unknown]> = [
    ["empty", ""],
    ["unquoted", "3"],
    ["single quoted", "'3'"],
    ["wildcard", "*"],
    ["weak ETag", 'W/"3"'],
    ["zero", '"0"'],
    ["negative", '"-1"'],
    ["positive sign", '"+1"'],
    ["leading zero", '"01"'],
    ["decimal", '"1.0"'],
    ["leading whitespace", ' "1"'],
    ["trailing whitespace", '"1" '],
    ["multiple tags", '"1", "2"'],
    ["unsafe integer", '"9007199254740992"'],
    ["number", 3],
    ["boolean", true],
    ["array", ['"3"']],
    ["object", { value: '"3"' }],
  ];

  for (const [description, value] of rejected) {
    assertApiError(
      () => parseIfMatch(value),
      400,
      `invalid If-Match: ${description}`,
      /invalid If-Match header/i,
    );
  }
});

test("applies list defaults and accepts every view", () => {
  assert.deepEqual(parseListNotesQuery({}), {
    view: "active",
    limit: NOTE_LIST_DEFAULT_LIMIT,
    cursor: null,
  });

  for (const view of NOTE_VIEWS) {
    assert.deepEqual(parseListNotesQuery({ view }), {
      view,
      limit: NOTE_LIST_DEFAULT_LIMIT,
      cursor: null,
    });
  }
});

test("accepts exact list limit bounds as query strings or numbers", () => {
  const accepted: ReadonlyArray<readonly [unknown, number]> = [
    [String(NOTE_LIST_MIN_LIMIT), NOTE_LIST_MIN_LIMIT],
    [String(NOTE_LIST_MAX_LIMIT), NOTE_LIST_MAX_LIMIT],
    [NOTE_LIST_MIN_LIMIT, NOTE_LIST_MIN_LIMIT],
    [NOTE_LIST_MAX_LIMIT, NOTE_LIST_MAX_LIMIT],
  ];

  for (const [limit, expected] of accepted) {
    assert.deepEqual(parseListNotesQuery({ limit }), {
      view: "active",
      limit: expected,
      cursor: null,
    });
  }
});

test("rejects out-of-range or malformed list limits with 400", () => {
  const rejectedLimits: ReadonlyArray<readonly [string, unknown]> = [
    ["zero string", "0"],
    ["zero number", 0],
    ["negative string", "-1"],
    ["negative number", -1],
    ["above maximum string", String(NOTE_LIST_MAX_LIMIT + 1)],
    ["above maximum number", NOTE_LIST_MAX_LIMIT + 1],
    ["empty string", ""],
    ["leading zero", "01"],
    ["positive sign", "+1"],
    ["decimal string", "1.5"],
    ["fractional number", 1.5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["boolean", true],
    ["array", ["10"]],
  ];

  for (const [description, limit] of rejectedLimits) {
    assertApiError(
      () => parseListNotesQuery({ limit }),
      400,
      `invalid list limit: ${description}`,
    );
  }
});

test("keeps list query parsing strict", () => {
  assertApiError(
    () => parseListNotesQuery({ view: "deleted" }),
    400,
    "unknown list view",
  );
  assertApiError(
    () => parseListNotesQuery({ view: "active", extra: true }),
    400,
    "extra list query field",
  );
  assertApiError(
    () => parseListNotesQuery({ cursor: "" }),
    400,
    "empty list cursor",
  );

  for (const query of [undefined, null, [], "view=active"]) {
    assertApiError(
      () => parseListNotesQuery(query),
      400,
      "malformed list query object",
    );
  }
});

test("round-trips canonical cursors for all views and list parsing", () => {
  const cases: ReadonlyArray<{
    view: NoteView;
    cursor: NoteCursor;
  }> = [
    { view: "active", cursor: ACTIVE_CURSOR },
    { view: "archived", cursor: ARCHIVED_CURSOR },
    { view: "trash", cursor: TRASH_CURSOR },
  ];

  for (const { view, cursor } of cases) {
    const encoded = encodeNoteCursor(cursor);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.equal(encoded.includes("="), false);
    assert.ok(encoded.length <= NOTE_CURSOR_MAX_LENGTH);
    assert.equal(
      encoded,
      Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url"),
    );
    assert.deepEqual(decodeNoteCursor(encoded, view), cursor);
    assert.deepEqual(
      parseListNotesQuery({ view, limit: "7", cursor: encoded }),
      { view, limit: 7, cursor },
    );
  }
});

test("rejects padded and non-canonical base64url cursors with 400", () => {
  const canonical = encodeNoteCursor(ARCHIVED_CURSOR);
  const nonCanonical = makeNonCanonicalEquivalent(canonical);

  assert.ok(
    Buffer.from(nonCanonical, "base64url").equals(
      Buffer.from(canonical, "base64url"),
    ),
  );
  assert.notEqual(nonCanonical, canonical);
  assertApiError(
    () => decodeNoteCursor(nonCanonical, "archived"),
    400,
    "non-canonical cursor",
  );
  assertApiError(
    () => decodeNoteCursor(`${canonical}=`, "archived"),
    400,
    "padded cursor",
  );
  assertApiError(
    () => parseListNotesQuery({ view: "archived", cursor: `${canonical}=` }),
    400,
    "padded list cursor",
  );
});

test("rejects a tampered cursor with 400", () => {
  const encoded = encodeNoteCursor(ACTIVE_CURSOR);
  const tampered = `${encoded[0] === "A" ? "B" : "A"}${encoded.slice(1)}`;

  assertApiError(
    () => decodeNoteCursor(tampered, "active"),
    400,
    "tampered cursor",
  );
  assertApiError(
    () => parseListNotesQuery({ view: "active", cursor: tampered }),
    400,
    "tampered list cursor",
  );
});

test("rejects every valid cursor under the wrong requested view", () => {
  const cases: ReadonlyArray<{
    view: NoteView;
    cursor: NoteCursor;
  }> = [
    { view: "active", cursor: ACTIVE_CURSOR },
    { view: "archived", cursor: ARCHIVED_CURSOR },
    { view: "trash", cursor: TRASH_CURSOR },
  ];

  for (const { view, cursor } of cases) {
    const encoded = encodeNoteCursor(cursor);
    for (const requestedView of NOTE_VIEWS) {
      if (requestedView === view) continue;
      assertApiError(
        () => decodeNoteCursor(encoded, requestedView),
        400,
        `${view} cursor requested as ${requestedView}`,
      );
      assertApiError(
        () => parseListNotesQuery({ view: requestedView, cursor: encoded }),
        400,
        `${view} list cursor requested as ${requestedView}`,
      );
    }
  }

  assertApiError(
    () => decodeNoteCursor(encodeNoteCursor(ACTIVE_CURSOR), "deleted" as NoteView),
    400,
    "invalid requested view",
  );
});

test("rejects malformed cursor envelopes and payload shapes with 400", () => {
  const malformedRaw: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["number", 1],
    ["object", {}],
    ["empty string", ""],
    ["invalid character", "abc+"],
    ["single incomplete character", "A"],
    ["invalid UTF-8", Buffer.from([0xff]).toString("base64url")],
    ["malformed JSON", Buffer.from("{", "utf8").toString("base64url")],
  ];
  for (const [description, raw] of malformedRaw) {
    assertApiError(
      () => decodeNoteCursor(raw, "active"),
      400,
      `malformed raw cursor: ${description}`,
    );
  }

  const malformedPayloads: ReadonlyArray<readonly [string, unknown]> = [
    ["null JSON", null],
    ["array JSON", []],
    ["empty object", {}],
    ["unknown discriminator", { view: "deleted" }],
    [
      "missing active pin state",
      { view: "active", updatedAt: ACTIVE_CURSOR.updatedAt, id: CUID_A },
    ],
    [
      "non-boolean active pin state",
      {
        view: "active",
        isPinned: "false",
        updatedAt: ACTIVE_CURSOR.updatedAt,
        id: CUID_A,
      },
    ],
    ["missing archived date", { view: "archived", id: CUID_A }],
    ["missing trash date", { view: "trash", id: CUID_A }],
    ["strict extra field", { ...ACTIVE_CURSOR, extra: true }],
  ];
  for (const [description, payload] of malformedPayloads) {
    assertApiError(
      () => decodeNoteCursor(encodeOpaque(payload), "active"),
      400,
      `malformed cursor payload: ${description}`,
    );
  }

  assertApiError(
    () =>
      encodeNoteCursor({
        ...ACTIVE_CURSOR,
        extra: true,
      } as unknown as NoteCursor),
    400,
    "strict cursor encoding",
  );
});

test("rejects cursor dates without a valid calendar date and offset", () => {
  const invalidDates = [
    "",
    "2026-08-22",
    "2026-08-22T17:03:33",
    "2026-08-22T17:03:33z",
    "2026-13-01T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2024-02-30T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+09:60",
  ];

  for (const updatedAt of invalidDates) {
    const encoded = encodeOpaque({
      ...ACTIVE_CURSOR,
      updatedAt,
    });
    assertApiError(
      () => decodeNoteCursor(encoded, "active"),
      400,
      `invalid cursor date ${JSON.stringify(updatedAt)}`,
    );
  }
});

test("rejects malformed cursor CUIDs", () => {
  const invalidIds: ReadonlyArray<readonly [string, unknown]> = [
    ["missing", undefined],
    ["null", null],
    ["number", 1],
    ["empty", ""],
    ["too short", `c${"a".repeat(23)}`],
    ["too long", `c${"a".repeat(25)}`],
    ["wrong prefix", `d${"a".repeat(24)}`],
    ["uppercase", `c${"A".repeat(24)}`],
    ["punctuation", `c${"a".repeat(23)}-`],
  ];

  for (const [description, id] of invalidIds) {
    const encoded = encodeOpaque({ ...ACTIVE_CURSOR, id });
    assertApiError(
      () => decodeNoteCursor(encoded, "active"),
      400,
      `invalid cursor CUID: ${description}`,
    );
  }
});

test("rejects cursors over 2,048 characters", () => {
  const oversized = "A".repeat(NOTE_CURSOR_MAX_LENGTH + 1);
  assertApiError(
    () => decodeNoteCursor(oversized, "active"),
    400,
    "oversized cursor",
  );
  assertApiError(
    () => parseListNotesQuery({ cursor: oversized }),
    400,
    "oversized list cursor",
  );
});

test("accepts empty and ten-item image order arrays", () => {
  const maximumOrder = Array.from({ length: NOTE_IMAGE_LIMIT }, (_, index) =>
    makeCuid(index),
  );

  assert.deepEqual(parseImageOrder({ imageIds: [] }), { imageIds: [] });
  assert.deepEqual(parseImageOrder({ imageIds: maximumOrder }), {
    imageIds: maximumOrder,
  });
});

test("rejects duplicate image IDs with 400", () => {
  assertApiError(
    () => parseImageOrder({ imageIds: [CUID_A, CUID_B, CUID_A] }),
    400,
    "duplicate image order",
    /duplicates/i,
  );
});

test("rejects malformed image order bodies and CUID arrays with 400", () => {
  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined body", undefined],
    ["null body", null],
    ["array body", []],
    ["missing imageIds", {}],
    ["null imageIds", { imageIds: null }],
    ["string imageIds", { imageIds: CUID_A }],
    ["object imageIds", { imageIds: {} }],
    ["non-string item", { imageIds: [CUID_A, 1] }],
    ["short CUID", { imageIds: ["c123"] }],
    ["uppercase CUID", { imageIds: [`c${"A".repeat(24)}`] }],
    ["extra field", { imageIds: [CUID_A], extra: true }],
  ];

  for (const [description, body] of malformed) {
    assertApiError(
      () => parseImageOrder(body),
      400,
      `malformed image order: ${description}`,
    );
  }
});

test("rejects image order arrays over ten items with 400", () => {
  const oversizedOrder = Array.from(
    { length: NOTE_IMAGE_LIMIT + 1 },
    (_, index) => makeCuid(index),
  );
  assertApiError(
    () => parseImageOrder({ imageIds: oversizedOrder }),
    400,
    "oversized image order",
    /at most 10/i,
  );
});

test("parses valid route IDs and rejects every malformed route ID with 400", () => {
  assert.equal(parseRouteId(CUID_A), CUID_A);
  assert.equal(parseRouteId(CUID_B, "imageId"), CUID_B);

  const invalidIds: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["number", 1],
    ["array", [CUID_A]],
    ["empty", ""],
    ["too short", `c${"a".repeat(23)}`],
    ["too long", `c${"a".repeat(25)}`],
    ["wrong prefix", `d${"a".repeat(24)}`],
    ["uppercase", `c${"A".repeat(24)}`],
    ["punctuation", `c${"a".repeat(23)}-`],
  ];

  for (const [description, id] of invalidIds) {
    assertApiError(
      () => parseRouteId(id, "noteId"),
      400,
      `invalid route ID: ${description}`,
      /invalid noteId parameter/i,
    );
  }
});
