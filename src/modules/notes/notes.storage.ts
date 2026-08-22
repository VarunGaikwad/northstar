import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";

const STORAGE_UNAVAILABLE_MESSAGE = "Storage service unavailable";

type ProviderResult<T> = {
  data: T | null;
  error: unknown;
};

export type SignedUpload = {
  signedUrl: string;
  expiresAt: Date;
};

export type StorageObjectInfo = {
  size: number | undefined;
  contentType: string | undefined;
};

class ProviderFailure extends Error {
  readonly status: number | undefined;

  constructor(status?: number) {
    super("Storage provider request failed");
    this.name = "ProviderFailure";
    this.status = status;
  }
}

type ClientCache = {
  url: string;
  key: string;
  client: ReturnType<typeof createClient>;
};

let clientCache: ClientCache | undefined;

function getClient(): ReturnType<typeof createClient> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientCache || clientCache.url !== url || clientCache.key !== key) {
    clientCache = {
      url,
      key,
      client: createClient(url, key, {
        auth: {
          persistSession: false,
          detectSessionInUrl: false,
          autoRefreshToken: false,
        },
      }),
    };
  }

  return clientCache.client;
}

function getBucket() {
  return getClient().storage.from(env.SUPABASE_NOTE_IMAGES_BUCKET);
}

function numericProviderStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  try {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" && Number.isInteger(status) ? status : undefined;
  } catch {
    return undefined;
  }
}

async function providerData<T>(request: () => Promise<ProviderResult<T>>): Promise<T> {
  try {
    const result = await request();
    if (result.error !== null) {
      throw new ProviderFailure(numericProviderStatus(result.error));
    }
    if (result.data === null || result.data === undefined) {
      throw new ProviderFailure();
    }
    return result.data;
  } catch (error) {
    if (error instanceof ProviderFailure) {
      throw error;
    }
    throw new ProviderFailure(numericProviderStatus(error));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidProviderResponse(): never {
  throw new ProviderFailure();
}

function expectedUploadUrlPath(path: string): { origin: string; pathname: string } {
  const providerUrl = new URL(env.SUPABASE_URL);
  const basePath = providerUrl.pathname.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return {
    origin: providerUrl.origin,
    pathname: `${basePath}/storage/v1/object/upload/sign/${env.SUPABASE_NOTE_IMAGES_BUCKET}/${encodedPath}`,
  };
}

function storageUnavailable(): ApiError {
  return new ApiError(STORAGE_UNAVAILABLE_MESSAGE, 503);
}

function parseTokenExpiry(token: string): Date {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return invalidProviderResponse();
  }

  let payload: unknown;
  try {
    const payloadBytes = Buffer.from(parts[1], "base64url");
    if (payloadBytes.toString("base64url") !== parts[1]) {
      return invalidProviderResponse();
    }
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return invalidProviderResponse();
  }

  if (!isRecord(payload)) {
    return invalidProviderResponse();
  }

  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= 0) {
    return invalidProviderResponse();
  }

  const expiresAt = new Date(exp * 1000);
  if (!Number.isFinite(expiresAt.getTime())) {
    return invalidProviderResponse();
  }
  return expiresAt;
}

async function createSignedUploadUrl(path: string): Promise<SignedUpload> {
  try {
    const data: unknown = await providerData(() =>
      getBucket().createSignedUploadUrl(path, { upsert: false }),
    );

    if (
      !isRecord(data) ||
      data.path !== path ||
      !isNonBlankString(data.signedUrl) ||
      !isNonBlankString(data.token)
    ) {
      return invalidProviderResponse();
    }

    let signedUrl: URL;
    try {
      signedUrl = new URL(data.signedUrl);
    } catch {
      return invalidProviderResponse();
    }
    const urlTokens = signedUrl.searchParams.getAll("token");
    const expectedUrl = expectedUploadUrlPath(path);
    if (
      (signedUrl.protocol !== "http:" && signedUrl.protocol !== "https:") ||
      signedUrl.origin !== expectedUrl.origin ||
      signedUrl.pathname !== expectedUrl.pathname ||
      urlTokens.length !== 1 ||
      urlTokens[0] !== data.token
    ) {
      return invalidProviderResponse();
    }

    return {
      signedUrl: data.signedUrl,
      expiresAt: parseTokenExpiry(data.token),
    };
  } catch {
    throw storageUnavailable();
  }
}

async function createSignedReadUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) {
    return new Map();
  }

  try {
    if (paths.some((path) => !isNonBlankString(path)) || new Set(paths).size !== paths.length) {
      return invalidProviderResponse();
    }

    const expiresInSeconds = Math.ceil(env.NOTE_IMAGE_READ_URL_TTL_MS / 1000);
    const data: unknown = await providerData(() =>
      getBucket().createSignedUrls(paths, expiresInSeconds),
    );
    if (!Array.isArray(data) || data.length !== paths.length) {
      return invalidProviderResponse();
    }

    const requestedPaths = new Set(paths);
    const urlsByPath = new Map<string, string>();
    for (const item of data as unknown[]) {
      if (
        !isRecord(item) ||
        item.error !== null ||
        typeof item.path !== "string" ||
        !requestedPaths.has(item.path) ||
        urlsByPath.has(item.path) ||
        !isNonBlankString(item.signedUrl)
      ) {
        return invalidProviderResponse();
      }
      urlsByPath.set(item.path, item.signedUrl);
    }

    const reassociated = new Map<string, string>();
    for (const path of paths) {
      const signedUrl = urlsByPath.get(path);
      if (signedUrl === undefined) {
        return invalidProviderResponse();
      }
      reassociated.set(path, signedUrl);
    }
    return reassociated;
  } catch {
    throw storageUnavailable();
  }
}

async function getObjectInfo(path: string): Promise<StorageObjectInfo | null> {
  try {
    const data: unknown = await providerData(() => getBucket().info(path));
    if (!isRecord(data)) {
      return invalidProviderResponse();
    }

    return {
      size: typeof data.size === "number" ? data.size : undefined,
      contentType: typeof data.contentType === "string" ? data.contentType : undefined,
    };
  } catch (error) {
    if (error instanceof ProviderFailure && error.status === 404) {
      return null;
    }
    throw storageUnavailable();
  }
}

async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  try {
    const data: unknown = await providerData(() => getBucket().remove(paths));
    if (!Array.isArray(data)) {
      return invalidProviderResponse();
    }
  } catch (error) {
    if (error instanceof ProviderFailure && error.status === 404) {
      return;
    }
    throw storageUnavailable();
  }
}

// The object itself is intentionally mutable so focused tests can replace
// provider-facing methods without initializing Supabase.
export const storageAdapter = {
  createSignedUploadUrl,
  createSignedReadUrls,
  getObjectInfo,
  removeObjects,
};
