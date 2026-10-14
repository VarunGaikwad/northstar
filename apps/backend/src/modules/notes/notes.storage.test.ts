import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, test, type TestContext } from "node:test";

type StorageAdapter = typeof import("./notes.storage").storageAdapter;

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
};

type StorageMockContext = {
  baseUrl: string;
  bucket: string;
  serviceKey: string;
  requests: CapturedRequest[];
};

type SetupResponse = {
  status: number;
  body: unknown;
};

type SetupCall = {
  url: string;
  method: string;
  body: string | null;
};

const REQUIRED_ENV_DEFAULTS = {
  DATABASE_URL: "postgresql://notes-storage-test.invalid/database",
  JWT_SECRET: "notes-storage-test-jwt-secret",
  JWT_REFRESH_SECRET: "notes-storage-test-refresh-secret-at-least-32-bytes",
  UNSPLASH_ACCESS_KEY: "notes-storage-test-unsplash-key",
} as const;

const STORAGE_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_NOTE_IMAGES_BUCKET",
  "NOTE_IMAGE_READ_URL_TTL",
] as const;

const SETUP_SUCCESS_MESSAGE = "Note image storage bucket is configured.";
const originalRequiredEnvironment = snapshotEnvironment(Object.keys(REQUIRED_ENV_DEFAULTS));

let storageAdapter: StorageAdapter;
let importFetchCalls = 0;
let clientSequence = 0;

before(async () => {
  for (const [key, fallback] of Object.entries(REQUIRED_ENV_DEFAULTS)) {
    process.env[key] ??= fallback;
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    importFetchCalls++;
    return Promise.reject(new Error("Storage import unexpectedly called fetch"));
  };

  try {
    const storageModule = await import("./notes.storage.js") as typeof import("./notes.storage");
    storageAdapter = storageModule.storageAdapter;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

after(() => {
  restoreEnvironment(originalRequiredEnvironment);
});

function snapshotEnvironment(keys: readonly string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot: ReadonlyMap<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function blockStorageFetch(t: TestContext): { callCount: () => number } {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = snapshotEnvironment(STORAGE_ENV_KEYS);
  let calls = 0;

  for (const key of STORAGE_ENV_KEYS) delete process.env[key];
  globalThis.fetch = () => {
    calls++;
    return Promise.reject(new Error("A zero-call storage operation unexpectedly called fetch"));
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnvironment(originalEnvironment);
  });

  return { callCount: () => calls };
}

function installStorageMock(
  t: TestContext,
  responder: (request: CapturedRequest, callIndex: number) => Response | Promise<Response>,
): StorageMockContext {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = snapshotEnvironment(STORAGE_ENV_KEYS);
  const sequence = ++clientSequence;
  const baseUrl = `https://notes-storage-${sequence}.example.test`;
  const serviceKey = `notes-storage-service-role-secret-${sequence}`;
  const bucket = "note-images";
  const requests: CapturedRequest[] = [];

  // The adapter caches by URL/key, so each test pair forces a fresh real Supabase client.
  process.env.SUPABASE_URL = baseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.SUPABASE_NOTE_IMAGES_BUCKET = bucket;
  process.env.NOTE_IMAGE_READ_URL_TTL = "1501ms";

  globalThis.fetch = async (input, init) => {
    const request: CapturedRequest = {
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    const callIndex = requests.length;
    requests.push(request);
    return responder(request, callIndex);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnvironment(originalEnvironment);
  });

  return { baseUrl, bucket, serviceKey, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestJson(request: CapturedRequest): unknown {
  const { body } = request;
  assert.ok(body !== null);
  return JSON.parse(body) as unknown;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createProviderJwt(exp: number): string {
  return `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson({ exp })}.test-signature`;
}

async function assertStorageUnavailable(
  operation: Promise<unknown>,
  forbiddenValues: readonly string[] = [],
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    const publicError = error as Error & {
      statusCode?: unknown;
      isOperational?: unknown;
      cause?: unknown;
    };

    assert.equal(publicError.message, "Storage service unavailable");
    assert.equal(publicError.statusCode, 503);
    assert.equal(publicError.isOperational, true);
    assert.equal(publicError.cause, undefined);

    const exposed = [
      publicError.name,
      publicError.message,
      publicError.stack ?? "",
      JSON.stringify({
        statusCode: publicError.statusCode,
        isOperational: publicError.isOperational,
        cause: publicError.cause,
      }),
    ].join("\n");
    for (const forbiddenValue of forbiddenValues) {
      assert.equal(
        exposed.includes(forbiddenValue),
        false,
        `storage error exposed forbidden value: ${forbiddenValue}`,
      );
    }
    return true;
  });
}

function setupProbeSource(responses: readonly SetupResponse[]): string {
  return `
const responses = ${JSON.stringify(responses)};
const calls = [];

globalThis.fetch = async (input, init = {}) => {
  const response = responses.shift();
  if (!response) throw new Error("Unexpected setup storage request");
  calls.push({
    url: String(input),
    method: init.method ?? "GET",
    body: typeof init.body === "string" ? init.body : null,
  });
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
};

let finish;
const completed = new Promise((resolve) => { finish = resolve; });
const timeout = setTimeout(() => {
  console.error("Timed out waiting for note storage setup");
  process.exitCode = 1;
  finish();
}, 3000);

console.log = (message) => {
  if (message === ${JSON.stringify(SETUP_SUCCESS_MESSAGE)}) {
    clearTimeout(timeout);
    process.stdout.write("SETUP_CALLS:" + JSON.stringify(calls));
    finish();
  }
};

await import("./scripts/setup_note_storage.ts");
await completed;
`;
}

async function runSetupProbe(responses: readonly SetupResponse[]): Promise<SetupCall[]> {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: "postgresql://notes-storage-setup.invalid/database",
    JWT_SECRET: "notes-storage-setup-jwt-secret",
    JWT_REFRESH_SECRET: "notes-storage-setup-refresh-secret-at-least-32-bytes",
    UNSPLASH_ACCESS_KEY: "notes-storage-setup-unsplash-key",
    SUPABASE_URL: "https://notes-storage-setup.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "notes-storage-setup-service-role-secret",
    SUPABASE_NOTE_IMAGES_BUCKET: "note-images",
  };

  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", setupProbeSource(responses)],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: childEnvironment,
          timeout: 10_000,
          windowsHide: true,
        },
        (error, childStdout, childStderr) => {
          if (error) {
            reject(new Error(`Note storage setup probe failed: ${childStderr}`, { cause: error }));
            return;
          }
          resolve({ stdout: childStdout, stderr: childStderr });
        },
      );
    },
  );

  const marker = "SETUP_CALLS:";
  const markerIndex = stdout.lastIndexOf(marker);
  assert.notEqual(markerIndex, -1, `setup probe produced no result: ${stderr}`);
  const parsed = JSON.parse(stdout.slice(markerIndex + marker.length)) as unknown;
  assert.ok(Array.isArray(parsed));
  return parsed as SetupCall[];
}

test("storage initialization and empty signed reads are lazy zero-call operations", async (t) => {
  const blockedFetch = blockStorageFetch(t);

  assert.equal(importFetchCalls, 0);
  assert.deepEqual([...await storageAdapter.createSignedReadUrls([])], []);
  assert.equal(blockedFetch.callCount(), 0);
});

test("signed upload uses the exact path, no upsert, its matching token, and JWT expiry", async (t) => {
  const path = "users/user-a/images/image.png";
  const exp = 1_800_000_123;
  const token = createProviderJwt(exp);
  const providerUrl = `/object/upload/sign/note-images/${path}?token=${token}`;
  const mock = installStorageMock(t, () => jsonResponse({ url: providerUrl }));

  const result = await storageAdapter.createSignedUploadUrl(path);

  assert.equal(mock.requests.length, 1);
  const request = mock.requests[0];
  assert.equal(
    request.url,
    `${mock.baseUrl}/storage/v1/object/upload/sign/${mock.bucket}/${path}`,
  );
  assert.equal(request.method, "POST");
  assert.deepEqual(requestJson(request), {});
  assert.equal(request.headers.get("x-upsert"), null);
  assert.equal(request.headers.get("apikey"), mock.serviceKey);
  assert.equal(request.headers.get("authorization"), `Bearer ${mock.serviceKey}`);
  assert.equal(result.signedUrl, `${mock.baseUrl}/storage/v1${providerUrl}`);
  assert.equal(new URL(result.signedUrl).searchParams.get("token"), token);
  assert.equal(result.expiresAt.getTime(), exp * 1000);
});

test("signed upload rejects a provider URL for a different object path", async (t) => {
  const requestedPath = "users/user-a/images/requested.png";
  const token = createProviderJwt(1_800_000_123);
  const mock = installStorageMock(t, () =>
    jsonResponse({
      url: `/object/upload/sign/note-images/users/user-a/images/different.png?token=${token}`,
    }),
  );

  await assertStorageUnavailable(
    storageAdapter.createSignedUploadUrl(requestedPath),
    [token],
  );
  assert.equal(mock.requests.length, 1);
});

test("signed upload rejects multiple URL tokens as a generic 503", async (t) => {
  const path = "users/user-a/images/image.png";
  const token = createProviderJwt(1_800_000_123);
  const secondToken = "provider-second-token-secret";
  const mock = installStorageMock(t, () =>
    jsonResponse({
      url: `/object/upload/sign/note-images/${path}?token=${token}&token=${secondToken}`,
    }),
  );

  await assertStorageUnavailable(storageAdapter.createSignedUploadUrl(path), [secondToken]);
  assert.equal(mock.requests.length, 1);
});

test("opaque and malformed upload tokens fail with the same generic 503", async (t) => {
  const path = "users/user-a/images/image.png";
  const opaqueToken = "opaque-provider-token-secret";
  const malformedToken = `${encodeJson({ alg: "none" })}.${Buffer.from("{", "utf8").toString("base64url")}.sig`;
  const tokens = [opaqueToken, malformedToken];
  const mock = installStorageMock(t, (_request, callIndex) =>
    jsonResponse({
      url: `/object/upload/sign/note-images/${path}?token=${tokens[callIndex]}`,
    }),
  );

  for (const token of tokens) {
    await assertStorageUnavailable(storageAdapter.createSignedUploadUrl(path), [token]);
  }
  assert.equal(mock.requests.length, tokens.length);
});

test("signed reads use rounded-up TTL and reassociate out-of-order provider paths", async (t) => {
  const paths = ["users/user-a/first.png", "users/user-a/second.png"];
  const signedPath = (path: string, token: string) =>
    `/object/sign/note-images/${path}?token=${token}`;
  const mock = installStorageMock(t, () =>
    jsonResponse([
      { error: null, path: paths[1], signedURL: signedPath(paths[1], "read-token-2") },
      { error: null, path: paths[0], signedURL: signedPath(paths[0], "read-token-1") },
    ]),
  );

  const result = await storageAdapter.createSignedReadUrls(paths);

  assert.equal(mock.requests.length, 1);
  const request = mock.requests[0];
  assert.equal(request.url, `${mock.baseUrl}/storage/v1/object/sign/${mock.bucket}`);
  assert.equal(request.method, "POST");
  assert.deepEqual(requestJson(request), { expiresIn: 2, paths });
  assert.deepEqual([...result], [
    [paths[0], `${mock.baseUrl}/storage/v1${signedPath(paths[0], "read-token-1")}`],
    [paths[1], `${mock.baseUrl}/storage/v1${signedPath(paths[1], "read-token-2")}`],
  ]);
});

test("Notes duration getters accept positive sub-second values", async (t) => {
  const path = "users/user-a/sub-second.png";
  const mock = installStorageMock(t, () =>
    jsonResponse([
      {
        error: null,
        path,
        signedURL: `/object/sign/note-images/${path}?token=read-token`,
      },
    ]),
  );
  process.env.NOTE_IMAGE_READ_URL_TTL = "1ms";

  await storageAdapter.createSignedReadUrls([path]);

  assert.deepEqual(requestJson(mock.requests[0]), { expiresIn: 1, paths: [path] });
});

test("signed reads reject a provider count mismatch", async (t) => {
  const paths = ["users/user-a/first.png", "users/user-a/second.png"];
  const mock = installStorageMock(t, () =>
    jsonResponse([
      {
        error: null,
        path: paths[0],
        signedURL: `/object/sign/note-images/${paths[0]}?token=read-token-1`,
      },
    ]),
  );

  await assertStorageUnavailable(storageAdapter.createSignedReadUrls(paths));
  assert.equal(mock.requests.length, 1);
});

test("one signed-read item error makes the whole operation fail without partial data", async (t) => {
  const paths = ["users/user-a/first.png", "users/user-a/second.png"];
  const providerError = "raw provider read failure secret";
  const mock = installStorageMock(t, () =>
    jsonResponse([
      {
        error: null,
        path: paths[0],
        signedURL: `/object/sign/note-images/${paths[0]}?token=read-token-1`,
      },
      { error: providerError, path: paths[1], signedURL: null },
    ]),
  );

  await assertStorageUnavailable(storageAdapter.createSignedReadUrls(paths), [providerError]);
  assert.equal(mock.requests.length, 1);
});

test("signed reads reject duplicate inputs before fetch and duplicate provider paths", async (t) => {
  const firstPath = "users/user-a/first.png";
  const secondPath = "users/user-a/second.png";
  const mock = installStorageMock(t, () =>
    jsonResponse([
      {
        error: null,
        path: firstPath,
        signedURL: `/object/sign/note-images/${firstPath}?token=read-token-1`,
      },
      {
        error: null,
        path: firstPath,
        signedURL: `/object/sign/note-images/${firstPath}?token=read-token-2`,
      },
    ]),
  );

  await assertStorageUnavailable(storageAdapter.createSignedReadUrls([firstPath, firstPath]));
  assert.equal(mock.requests.length, 0);

  await assertStorageUnavailable(storageAdapter.createSignedReadUrls([firstPath, secondPath]));
  assert.equal(mock.requests.length, 1);
});

test("object metadata maps only the provider's top-level size and content type", async (t) => {
  const path = "users/user-a/image.webp";
  const mock = installStorageMock(t, () =>
    jsonResponse({
      id: "object-id",
      version: "object-version",
      name: path,
      bucket_id: "note-images",
      created_at: "2026-08-22T00:00:00.000Z",
      size: 321,
      content_type: "image/webp",
      metadata: { size: 999, mimetype: "application/provider-secret" },
    }),
  );

  const result = await storageAdapter.getObjectInfo(path);

  assert.deepEqual(result, { size: 321, contentType: "image/webp" });
  assert.equal(mock.requests.length, 1);
  assert.equal(
    mock.requests[0].url,
    `${mock.baseUrl}/storage/v1/object/info/${mock.bucket}/${path}`,
  );
  assert.equal(mock.requests[0].method, "GET");
});

test("a numeric provider 404 maps missing object metadata to null", async (t) => {
  const path = "users/user-a/absent.png";
  const mock = installStorageMock(t, () =>
    jsonResponse(
      { statusCode: "404", error: "not_found", message: "raw provider absence detail" },
      404,
    ),
  );

  assert.equal(await storageAdapter.getObjectInfo(path), null);
  assert.equal(mock.requests.length, 1);
});

test("generic metadata failures return 503 without provider diagnostics or service keys", async (t) => {
  const path = "users/user-a/image.png";
  const providerDiagnostic = "raw metadata provider diagnostic secret";
  const mock = installStorageMock(t, (request) =>
    jsonResponse(
      {
        statusCode: "500",
        error: "provider_failure",
        message: `${providerDiagnostic}:${request.headers.get("apikey")}`,
      },
      500,
    ),
  );

  await assertStorageUnavailable(storageAdapter.getObjectInfo(path), [
    providerDiagnostic,
    mock.serviceKey,
  ]);
  assert.equal(mock.requests.length, 1);
});

test("empty remove is a zero-fetch operation even without storage configuration", async (t) => {
  const blockedFetch = blockStorageFetch(t);

  await storageAdapter.removeObjects([]);

  assert.equal(blockedFetch.callCount(), 0);
});

test("removing an already absent object is idempotent on numeric 404", async (t) => {
  const paths = ["users/user-a/absent.png"];
  const mock = installStorageMock(t, () =>
    jsonResponse(
      { statusCode: "404", error: "not_found", message: "raw provider absence detail" },
      404,
    ),
  );

  await storageAdapter.removeObjects(paths);

  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].method, "DELETE");
  assert.deepEqual(requestJson(mock.requests[0]), { prefixes: paths });
});

test("remove accepts a successful empty provider result", async (t) => {
  const paths = ["users/user-a/image.png"];
  const mock = installStorageMock(t, () => jsonResponse([]));

  await storageAdapter.removeObjects(paths);

  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].method, "DELETE");
  assert.deepEqual(requestJson(mock.requests[0]), { prefixes: paths });
});

test("all storage boundary failures hide raw provider errors and credentials", async (t) => {
  const providerDiagnostic = "raw-cross-boundary-provider-secret";
  const mock = installStorageMock(t, (request) => {
    throw new Error(`${providerDiagnostic}:${request.headers.get("apikey")}`);
  });
  const forbidden = [providerDiagnostic, mock.serviceKey];

  await assertStorageUnavailable(
    storageAdapter.createSignedUploadUrl("users/user-a/upload.png"),
    forbidden,
  );
  await assertStorageUnavailable(
    storageAdapter.createSignedReadUrls(["users/user-a/read.png"]),
    forbidden,
  );
  await assertStorageUnavailable(storageAdapter.getObjectInfo("users/user-a/info.png"), forbidden);
  await assertStorageUnavailable(storageAdapter.removeObjects(["users/user-a/remove.png"]), forbidden);

  assert.equal(mock.requests.length, 4);
});

test("note storage setup creates once and updates only after a create conflict", async () => {
  const bucketOptions = {
    id: "note-images",
    name: "note-images",
    public: false,
    file_size_limit: 10 * 1024 * 1024,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  };

  const created = await runSetupProbe([{ status: 200, body: { name: "note-images" } }]);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    url: "https://notes-storage-setup.example.test/storage/v1/bucket",
    method: "POST",
    body: JSON.stringify(bucketOptions),
  });

  const updated = await runSetupProbe([
    {
      status: 409,
      body: { statusCode: "409", error: "Conflict", message: "Bucket already exists" },
    },
    { status: 200, body: { message: "Successfully updated" } },
  ]);
  assert.deepEqual(updated, [
    {
      url: "https://notes-storage-setup.example.test/storage/v1/bucket",
      method: "POST",
      body: JSON.stringify(bucketOptions),
    },
    {
      url: "https://notes-storage-setup.example.test/storage/v1/bucket/note-images",
      method: "PUT",
      body: JSON.stringify(bucketOptions),
    },
  ]);
});
