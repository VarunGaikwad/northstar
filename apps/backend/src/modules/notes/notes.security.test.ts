import assert from "node:assert/strict";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { test, type TestContext } from "node:test";

type Runtime = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../db/prisma").prisma;
  app: typeof import("../../index").default;
  signAccessToken: typeof import("../../utils/jwt").signAccessToken;
  storageAdapter: typeof import("./notes.storage").storageAdapter;
  noteImageMaxBytes: number;
};

let runtime: Runtime;

const USER_ID = "c111111111111111111111111";
const NOTE_ID = "c222222222222222222222222";
const IMAGE_ID = "c333333333333333333333333";
const SESSION_ID = "c444444444444444444444444";
const CREATED_AT = new Date("2026-08-20T01:02:03.000Z");
const UPDATED_AT = new Date("2026-08-21T04:05:06.000Z");

type DependencyImplementation = (...args: never[]) => unknown;

type DependencyOverrides = Partial<{
  noteCreate: DependencyImplementation;
  noteFindMany: DependencyImplementation;
  noteFindFirst: DependencyImplementation;
  noteImageFindFirst: DependencyImplementation;
  transaction: DependencyImplementation;
  queryRaw: DependencyImplementation;
  createSignedUploadUrl: DependencyImplementation;
  createSignedReadUrls: DependencyImplementation;
  getObjectInfo: DependencyImplementation;
  removeObjects: DependencyImplementation;
}>;

type RouteRequest = {
  method: string;
  path: string;
  body?: unknown;
};

function mockMethod<F extends (...args: never[]) => unknown>(
  t: TestContext,
  target: object,
  methodName: string,
  implementation: F,
) {
  const original = Object.getOwnPropertyDescriptor(target, methodName);
  const mocked = t.mock.fn(implementation);
  Object.defineProperty(target, methodName, {
    ...original,
    configurable: true,
    value: mocked,
  });
  t.after(() => {
    if (original) {
      Object.defineProperty(target, methodName, original);
    } else {
      Reflect.deleteProperty(target, methodName);
    }
  });
  return mocked;
}

function unexpectedDependency(name: string): DependencyImplementation {
  return () => {
    throw new Error(`Unexpected downstream call: ${name}`);
  };
}

function installDownstreamMocks(
  t: TestContext,
  overrides: DependencyOverrides = {},
) {
  const noteCreate = mockMethod(
    t,
    runtime.prisma.note,
    "create",
    overrides.noteCreate ?? unexpectedDependency("prisma.note.create"),
  );
  const noteFindMany = mockMethod(
    t,
    runtime.prisma.note,
    "findMany",
    overrides.noteFindMany ?? unexpectedDependency("prisma.note.findMany"),
  );
  const noteFindFirst = mockMethod(
    t,
    runtime.prisma.note,
    "findFirst",
    overrides.noteFindFirst ?? unexpectedDependency("prisma.note.findFirst"),
  );
  const noteImageFindFirst = mockMethod(
    t,
    runtime.prisma.noteImage,
    "findFirst",
    overrides.noteImageFindFirst ??
      unexpectedDependency("prisma.noteImage.findFirst"),
  );
  const transaction = mockMethod(
    t,
    runtime.prisma,
    "$transaction",
    overrides.transaction ?? unexpectedDependency("prisma.$transaction"),
  );
  const queryRaw = mockMethod(
    t,
    runtime.prisma,
    "$queryRaw",
    overrides.queryRaw ?? unexpectedDependency("prisma.$queryRaw"),
  );
  const createSignedUploadUrl = mockMethod(
    t,
    runtime.storageAdapter,
    "createSignedUploadUrl",
    overrides.createSignedUploadUrl ??
      unexpectedDependency("storageAdapter.createSignedUploadUrl"),
  );
  const createSignedReadUrls = mockMethod(
    t,
    runtime.storageAdapter,
    "createSignedReadUrls",
    overrides.createSignedReadUrls ??
      unexpectedDependency("storageAdapter.createSignedReadUrls"),
  );
  const getObjectInfo = mockMethod(
    t,
    runtime.storageAdapter,
    "getObjectInfo",
    overrides.getObjectInfo ??
      unexpectedDependency("storageAdapter.getObjectInfo"),
  );
  const removeObjects = mockMethod(
    t,
    runtime.storageAdapter,
    "removeObjects",
    overrides.removeObjects ?? unexpectedDependency("storageAdapter.removeObjects"),
  );

  return {
    noteCreate,
    noteFindMany,
    noteFindFirst,
    noteImageFindFirst,
    transaction,
    queryRaw,
    createSignedUploadUrl,
    createSignedReadUrls,
    getObjectInfo,
    removeObjects,
    all: [
      ["prisma.note.create", noteCreate],
      ["prisma.note.findMany", noteFindMany],
      ["prisma.note.findFirst", noteFindFirst],
      ["prisma.noteImage.findFirst", noteImageFindFirst],
      ["prisma.$transaction", transaction],
      ["prisma.$queryRaw", queryRaw],
      ["storageAdapter.createSignedUploadUrl", createSignedUploadUrl],
      ["storageAdapter.createSignedReadUrls", createSignedReadUrls],
      ["storageAdapter.getObjectInfo", getObjectInfo],
      ["storageAdapter.removeObjects", removeObjects],
    ] as const,
  };
}

function assertNoDownstreamCalls(
  mocks: ReturnType<typeof installDownstreamMocks>,
): void {
  for (const [name, mocked] of mocks.all) {
    assert.equal(mocked.mock.calls.length, 0, `${name} should not be called`);
  }
}

function setTemporaryEnv(
  t: TestContext,
  key: string,
  value: string,
): void {
  const hadOriginal = Object.prototype.hasOwnProperty.call(process.env, key);
  const original = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (hadOriginal && original !== undefined) {
      process.env[key] = original;
    } else {
      Reflect.deleteProperty(process.env, key);
    }
  });
}

function accessAuthorization(): string {
  const { token } = runtime.signAccessToken({
    userId: USER_ID,
    email: "notes-security@example.com",
    role: "USER",
    sessionId: SESSION_ID,
  });
  return `Bearer ${token}`;
}

function requestInit(
  route: RouteRequest,
  authorization?: string,
  extraHeaders: Record<string, string> = {},
): RequestInit {
  const headers: Record<string, string> = { ...extraHeaders };
  if (authorization !== undefined) headers.Authorization = authorization;
  if (route.body !== undefined) headers["Content-Type"] = "application/json";

  return {
    method: route.method,
    headers,
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  };
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  assert.notEqual(text, "", "response should contain a JSON body");
  return JSON.parse(text) as unknown;
}

async function startServer(t: TestContext): Promise<string> {
  const server = createServer(runtime.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function rawRequest(
  baseUrl: string,
  route: RouteRequest,
  rawHeaders: string[],
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const url = new URL(route.path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: route.method,
        headers: ["Host", url.host, ...rawHeaders],
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function storedNote(
  images: Array<{
    id: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    position: number;
  }> = [],
) {
  return {
    id: NOTE_ID,
    title: "Security note",
    content: "Private content",
    color: "BLUE",
    isPinned: true,
    archivedAt: null,
    trashedAt: null,
    version: 7,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    images,
  };
}

function publicNote() {
  return {
    id: NOTE_ID,
    title: "Security note",
    content: "Private content",
    color: "BLUE",
    isPinned: true,
    archivedAt: null,
    trashedAt: null,
    version: 7,
    createdAt: CREATED_AT.toISOString(),
    updatedAt: UPDATED_AT.toISOString(),
    images: [],
  };
}

test("Notes HTTP security contract", async (t) => {
  const requiredEnvironment = {
    NODE_ENV: "test",
    DATABASE_URL:
      "postgresql://notes_security:notes_security@localhost:5432/notes_security",
    JWT_SECRET: "notes-security-access-secret",
    JWT_REFRESH_SECRET: "notes-security-refresh-secret-000000000000",
    UNSPLASH_ACCESS_KEY: "notes-security-unsplash-key",
    FRONTEND_URL: "https://notes-security.example",
    CHROME_EXTENSION_ORIGINS: "",
    SUPABASE_URL: "https://notes-security.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "notes-security-service-role-key",
    SUPABASE_NOTE_IMAGES_BUCKET: "notes-security-images",
    CRON_SECRET: "notes-security-default-cron-secret",
  };
  for (const [key, value] of Object.entries(requiredEnvironment)) {
    setTemporaryEnv(t, key, value);
  }

  const [envModule, prismaModule, appModule, jwtModule, storageModule, typesModule] =
    await Promise.all([
      import("../../config/env.js"),
      import("../../db/prisma.js"),
      import("../../index.js"),
      import("../../utils/jwt.js"),
      import("./notes.storage.js"),
      import("./notes.types.js"),
    ]);
  runtime = {
    env: envModule.env,
    prisma: prismaModule.prisma,
    app: appModule.default as unknown as Runtime["app"],
    signAccessToken: jwtModule.signAccessToken,
    storageAdapter: storageModule.storageAdapter,
    noteImageMaxBytes: typesModule.NOTE_IMAGE_MAX_BYTES,
  };
  const baseUrl = await startServer(t);

  await t.test("all 13 user routes reject missing authentication", async (t) => {
    const mocks = installDownstreamMocks(t);
    const routes: RouteRequest[] = [
      { method: "POST", path: "/api/notes", body: {} },
      { method: "GET", path: "/api/notes" },
      { method: "GET", path: `/api/notes/${NOTE_ID}` },
      {
        method: "PATCH",
        path: `/api/notes/${NOTE_ID}`,
        body: { title: "Updated" },
      },
      { method: "POST", path: `/api/notes/${NOTE_ID}/archive` },
      { method: "POST", path: `/api/notes/${NOTE_ID}/unarchive` },
      { method: "POST", path: `/api/notes/${NOTE_ID}/trash` },
      { method: "POST", path: `/api/notes/${NOTE_ID}/restore` },
      { method: "DELETE", path: `/api/notes/${NOTE_ID}` },
      {
        method: "POST",
        path: `/api/notes/${NOTE_ID}/images/upload-intents`,
        body: { mimeType: "image/png", sizeBytes: 1024 },
      },
      {
        method: "POST",
        path: `/api/notes/${NOTE_ID}/images/${IMAGE_ID}/confirm`,
      },
      {
        method: "PUT",
        path: `/api/notes/${NOTE_ID}/images/order`,
        body: { imageIds: [IMAGE_ID] },
      },
      {
        method: "DELETE",
        path: `/api/notes/${NOTE_ID}/images/${IMAGE_ID}`,
      },
    ];
    assert.equal(routes.length, 13);

    for (const route of routes) {
      const response = await fetch(
        `${baseUrl}${route.path}`,
        requestInit(route),
      );
      assert.equal(
        response.status,
        401,
        `${route.method} ${route.path} should reject missing auth`,
      );
      assert.deepEqual(await responseBody(response), {
        success: false,
        error: "Missing or invalid authorization header",
      });
    }

    assertNoDownstreamCalls(mocks);
  });

  await t.test("all versioned mutations require If-Match", async (t) => {
    const mocks = installDownstreamMocks(t);
    const authorization = accessAuthorization();
    const routes: RouteRequest[] = [
      {
        method: "PATCH",
        path: `/api/notes/${NOTE_ID}`,
        body: { title: "Updated" },
      },
      { method: "POST", path: `/api/notes/${NOTE_ID}/archive` },
      { method: "POST", path: `/api/notes/${NOTE_ID}/unarchive` },
      { method: "POST", path: `/api/notes/${NOTE_ID}/trash` },
      { method: "POST", path: `/api/notes/${NOTE_ID}/restore` },
      { method: "DELETE", path: `/api/notes/${NOTE_ID}` },
      {
        method: "POST",
        path: `/api/notes/${NOTE_ID}/images/${IMAGE_ID}/confirm`,
      },
      {
        method: "PUT",
        path: `/api/notes/${NOTE_ID}/images/order`,
        body: { imageIds: [IMAGE_ID] },
      },
      {
        method: "DELETE",
        path: `/api/notes/${NOTE_ID}/images/${IMAGE_ID}`,
      },
    ];

    for (const route of routes) {
      const response = await fetch(
        `${baseUrl}${route.path}`,
        requestInit(route, authorization),
      );
      assert.equal(
        response.status,
        428,
        `${route.method} ${route.path} should require If-Match`,
      );
      assert.deepEqual(await responseBody(response), {
        success: false,
        error: "If-Match header is required",
      });
    }

    assertNoDownstreamCalls(mocks);
  });

  await t.test("upload intents reject unsupported MIME and oversized images", async (t) => {
    const mocks = installDownstreamMocks(t);
    const authorization = accessAuthorization();
    const route = `/api/notes/${NOTE_ID}/images/upload-intents`;

    const unsupported = await fetch(
      `${baseUrl}${route}`,
      requestInit(
        {
          method: "POST",
          path: route,
          body: { mimeType: "image/gif", sizeBytes: 1024 },
        },
        authorization,
      ),
    );
    assert.equal(unsupported.status, 415);
    assert.deepEqual(await responseBody(unsupported), {
      success: false,
      error: "Unsupported image MIME type",
    });

    const oversized = await fetch(
      `${baseUrl}${route}`,
      requestInit(
        {
          method: "POST",
          path: route,
          body: {
            mimeType: "image/png",
            sizeBytes: runtime.noteImageMaxBytes + 1,
          },
        },
        authorization,
      ),
    );
    assert.equal(oversized.status, 413);
    assert.deepEqual(await responseBody(oversized), {
      success: false,
      error: `Image size exceeds the ${runtime.noteImageMaxBytes} byte limit`,
    });

    assertNoDownstreamCalls(mocks);
  });

  await t.test("malformed JSON returns a safe 400 without logging note content", async (t) => {
    const mocks = installDownstreamMocks(t);
    const logged = mockMethod(t, console, "error", () => undefined);
    const privateFragment = "private-note-content-that-must-not-be-logged";

    const response = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: {
        Authorization: accessAuthorization(),
        "Content-Type": "application/json",
      },
      body: `{"title":"${privateFragment}`,
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await responseBody(response), {
      success: false,
      error: "Invalid JSON body",
    });
    assert.equal(logged.mock.calls.length, 0);
    assertNoDownstreamCalls(mocks);
  });

  await t.test("cleanup auth is exact and cleanup I/O remains mocked", async (t) => {
    const cronSecret = "notes-security-cron-secret";
    setTemporaryEnv(t, "CRON_SECRET", cronSecret);
    const mocks = installDownstreamMocks(t, {
      queryRaw: () => Promise.resolve([]),
    });
    const route = "/api/internal/notes/cleanup";
    const rejectedHeaders = [
      undefined,
      `Basic ${cronSecret}`,
      `Bearer ${cronSecret}-wrong`,
    ];

    for (const authorization of rejectedHeaders) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "GET",
        headers:
          authorization === undefined ? undefined : { Authorization: authorization },
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await responseBody(response), {
        success: false,
        error: "Unauthorized",
      });
      assert.equal(mocks.queryRaw.mock.calls.length, 0);
    }

    const accepted = await fetch(`${baseUrl}${route}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await responseBody(accepted), {
      success: true,
      data: {
        claimedNotes: 0,
        purgedNotes: 0,
        deferredNotePurges: 0,
        failedNotePurges: 0,
        claimedUploads: 0,
        deletedImages: 0,
        deferredImageDeletes: 0,
        failedImageDeletes: 0,
      },
    });
    assert.equal(mocks.queryRaw.mock.calls.length, 4);

    const duplicate = await rawRequest(
      baseUrl,
      { method: "GET", path: route },
      [
        "Authorization",
        `Bearer ${cronSecret}`,
        "Authorization",
        `Bearer ${cronSecret}`,
      ],
    );
    assert.equal(duplicate.status, 401);
    assert.deepEqual(JSON.parse(duplicate.body) as unknown, {
      success: false,
      error: "Unauthorized",
    });
    assert.equal(mocks.queryRaw.mock.calls.length, 4);

    for (const [name, mocked] of mocks.all) {
      const expectedCalls = name === "prisma.$queryRaw" ? 4 : 0;
      assert.equal(
        mocked.mock.calls.length,
        expectedCalls,
        `${name} should have ${expectedCalls} calls`,
      );
    }
  });

  await t.test("trusted CORS preflight allows Notes headers and methods", async (t) => {
    const mocks = installDownstreamMocks(t);
    const trustedOrigin = runtime.env.FRONTEND_URLS[0];
    assert.ok(trustedOrigin);

    const response = await fetch(`${baseUrl}/api/notes/${NOTE_ID}`, {
      method: "OPTIONS",
      headers: {
        Origin: trustedOrigin,
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers":
          "authorization, content-type, if-match",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), trustedOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    const allowedHeaders = new Set(
      (response.headers.get("access-control-allow-headers") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase()),
    );
    assert.deepEqual(
      allowedHeaders,
      new Set(["content-type", "authorization", "if-match"]),
    );
    const allowedMethods = new Set(
      (response.headers.get("access-control-allow-methods") ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase()),
    );
    assert.deepEqual(
      allowedMethods,
      new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    );
    assert.equal(response.headers.get("access-control-expose-headers"), "ETag");
    assertNoDownstreamCalls(mocks);
  });

  await t.test("untrusted CORS origins are rejected before Notes I/O", async (t) => {
    const mocks = installDownstreamMocks(t);
    const response = await fetch(`${baseUrl}/api/notes/${NOTE_ID}`, {
      method: "GET",
      headers: {
        Authorization: accessAuthorization(),
        Origin: "https://northstar.example.evil.invalid",
      },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await responseBody(response), {
      success: false,
      error: "Origin is not allowed",
    });
    assertNoDownstreamCalls(mocks);
  });

  await t.test("single-note responses use an exact strong ETag", async (t) => {
    const mocks = installDownstreamMocks(t, {
      noteFindFirst: () => Promise.resolve(storedNote()),
    });
    const trustedOrigin = runtime.env.FRONTEND_URLS[0];
    assert.ok(trustedOrigin);

    const response = await fetch(`${baseUrl}/api/notes/${NOTE_ID}`, {
      method: "GET",
      headers: {
        Authorization: accessAuthorization(),
        Origin: trustedOrigin,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("etag"), '"7"');
    assert.equal(response.headers.get("access-control-expose-headers"), "ETag");
    assert.deepEqual(await responseBody(response), {
      success: true,
      data: publicNote(),
    });
    assert.equal(mocks.noteFindFirst.mock.calls.length, 1);
    assert.equal(mocks.createSignedReadUrls.mock.calls.length, 0);
  });

  await t.test("storage failures do not leak service keys or object paths", async (t) => {
    const serviceKey = "test-service-role-key-must-not-leak";
    const storagePath = `users/${USER_ID}/notes/${NOTE_ID}/${IMAGE_ID}.png`;
    setTemporaryEnv(t, "SUPABASE_SERVICE_ROLE_KEY", serviceKey);
    const mocks = installDownstreamMocks(t, {
      noteFindFirst: () =>
        Promise.resolve(
          storedNote([
            {
              id: IMAGE_ID,
              storagePath,
              mimeType: "image/png",
              sizeBytes: 1024,
              position: 0,
            },
          ]),
        ),
      createSignedReadUrls: () =>
        Promise.reject(new Error(`${serviceKey}: ${storagePath}`)),
    });

    const response = await fetch(`${baseUrl}/api/notes/${NOTE_ID}`, {
      method: "GET",
      headers: { Authorization: accessAuthorization() },
    });
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(body) as unknown, {
      success: false,
      error: "Storage service unavailable",
    });
    assert.equal(body.includes(serviceKey), false);
    assert.equal(body.includes(storagePath), false);
    assert.equal(mocks.noteFindFirst.mock.calls.length, 1);
    assert.equal(mocks.createSignedReadUrls.mock.calls.length, 1);
    assert.equal(mocks.removeObjects.mock.calls.length, 0);
  });
});
