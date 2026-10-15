import "dotenv/config";

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getNonBlankEnvVar(key: string): string {
  const value = getEnvVar(key).trim();
  if (!value) {
    throw new Error(`${key} must not be blank`);
  }
  return value;
}

const DURATION_MULTIPLIERS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

export function parseDurationMs(key: string, value: string): number {
  const match = /^([1-9]\d*)(ms|s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`${key} must be a positive duration with an explicit unit (ms, s, m, h, or d)`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_MULTIPLIERS;
  const duration = amount * DURATION_MULTIPLIERS[unit];
  if (!Number.isSafeInteger(duration) || duration < 1000) {
    throw new Error(`${key} must be a duration of at least 1s`);
  }
  return duration;
}

function parseNoteDurationMs(key: string, value: string): number {
  const match = /^([1-9]\d*)(ms|s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`${key} must be a positive duration with an explicit unit (ms, s, m, h, or d)`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_MULTIPLIERS;
  const duration = amount * DURATION_MULTIPLIERS[unit];
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error(`${key} must be a positive safe duration`);
  }
  return duration;
}

function getNoteDurationEnvVar(key: string, defaultValue: string): string {
  const value = getEnvVar(key, defaultValue);
  parseNoteDurationMs(key, value);
  return value;
}

function getHttpUrlEnvVar(key: string): string {
  const value = getNonBlankEnvVar(key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${key} must be a valid HTTP(S) URL`);
  }
  return value;
}

function getNoteImagesBucket(): string {
  const bucket = getNonBlankEnvVar("SUPABASE_NOTE_IMAGES_BUCKET");
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket)) {
    throw new Error(
      "SUPABASE_NOTE_IMAGES_BUCKET must match [a-z0-9][a-z0-9._-]{0,99}",
    );
  }
  return bucket;
}

function parseWebOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        throw new Error(`FRONTEND_URL contains an invalid origin: ${entry}`);
      }

      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (url.pathname !== "/" && url.pathname !== "") ||
        url.search ||
        url.hash
      ) {
        throw new Error(`FRONTEND_URL must contain exact HTTP(S) origins without paths: ${entry}`);
      }
      return url.origin;
    });

  return [...new Set(origins)];
}

function parseExtensionOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const origin of origins) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      throw new Error(`CHROME_EXTENSION_ORIGINS contains an invalid exact extension origin: ${origin}`);
    }
  }

  return [...new Set(origins)];
}

// FRONTEND_URL contains frontend origins for CORS, not recovery-page links.
const frontendUrls = parseWebOrigins(process.env.FRONTEND_URL ?? "http://localhost:5173");
if (frontendUrls.length === 0) {
  frontendUrls.push("http://localhost:5173");
}

const chromeExtensionOrigins = parseExtensionOrigins(process.env.CHROME_EXTENSION_ORIGINS ?? "");
const jwtSecret = getEnvVar("JWT_SECRET");
const jwtRefreshSecret = getEnvVar("JWT_REFRESH_SECRET");
if (Buffer.byteLength(jwtRefreshSecret, "utf8") < 32) {
  throw new Error("JWT_REFRESH_SECRET must be at least 32 bytes");
}
if (jwtRefreshSecret === jwtSecret) {
  throw new Error("JWT_REFRESH_SECRET must be different from JWT_SECRET");
}

const jwtExpiresIn = getEnvVar("JWT_EXPIRES_IN", "15m");
const authSessionIdleExpiresIn = getEnvVar("AUTH_SESSION_IDLE_EXPIRES_IN", "30d");
const authSessionAbsoluteExpiresIn = getEnvVar("AUTH_SESSION_ABSOLUTE_EXPIRES_IN", "180d");
const jwtExpiresInMs = parseDurationMs("JWT_EXPIRES_IN", jwtExpiresIn);
const authSessionIdleExpiresInMs = parseDurationMs(
  "AUTH_SESSION_IDLE_EXPIRES_IN",
  authSessionIdleExpiresIn,
);
const authSessionAbsoluteExpiresInMs = parseDurationMs(
  "AUTH_SESSION_ABSOLUTE_EXPIRES_IN",
  authSessionAbsoluteExpiresIn,
);
if (authSessionAbsoluteExpiresInMs < authSessionIdleExpiresInMs) {
  throw new Error("AUTH_SESSION_ABSOLUTE_EXPIRES_IN must not be shorter than AUTH_SESSION_IDLE_EXPIRES_IN");
}

export const env = {
  NODE_ENV: getEnvVar("NODE_ENV", "development"),
  PORT: Number(getEnvVar("PORT", "3000")),

  DATABASE_URL: getEnvVar("DATABASE_URL"),

  JWT_SECRET: jwtSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
  JWT_EXPIRES_IN: jwtExpiresIn,
  JWT_EXPIRES_IN_MS: jwtExpiresInMs,
  AUTH_SESSION_IDLE_EXPIRES_IN: authSessionIdleExpiresIn,
  AUTH_SESSION_IDLE_EXPIRES_IN_MS: authSessionIdleExpiresInMs,
  AUTH_SESSION_ABSOLUTE_EXPIRES_IN: authSessionAbsoluteExpiresIn,
  AUTH_SESSION_ABSOLUTE_EXPIRES_IN_MS: authSessionAbsoluteExpiresInMs,

  BCRYPT_SALT_ROUNDS: Number(getEnvVar("BCRYPT_SALT_ROUNDS", "12")),

  // SMTP is required for production recovery. Development can log reset links.
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM ?? "no-reply@northstar.app",

  // Lazy to avoid blocking unrelated endpoints when recovery is unconfigured.
  get PUBLIC_BACKEND_URL(): string {
    const value = process.env.PUBLIC_BACKEND_URL ??
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
    const origins = parseWebOrigins(value);
    if (origins.length !== 1 ||
        (process.env.NODE_ENV === "production" && !origins[0].startsWith("https://"))) {
      throw new Error("PUBLIC_BACKEND_URL must be one public HTTPS origin in production");
    }
    return origins[0];
  },

  FRONTEND_URL: frontendUrls[0],
  // All allowed frontend origins, for CORS. One or more comma-separated URLs.
  FRONTEND_URLS: frontendUrls,
  CHROME_EXTENSION_ORIGINS: chromeExtensionOrigins,
  TRUSTED_ORIGINS: [...frontendUrls, ...chromeExtensionOrigins],

  UNSPLASH_ACCESS_KEY: getEnvVar("UNSPLASH_ACCESS_KEY"),

  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,

  // Notes-only settings stay lazy so non-image Notes operations and unrelated
  // modules do not require Supabase or cleanup configuration.
  get SUPABASE_URL(): string {
    return getHttpUrlEnvVar("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return getNonBlankEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  },
  get SUPABASE_NOTE_IMAGES_BUCKET(): string {
    return getNoteImagesBucket();
  },
  get NOTE_IMAGE_READ_URL_TTL(): string {
    return getNoteDurationEnvVar("NOTE_IMAGE_READ_URL_TTL", "15m");
  },
  get NOTE_IMAGE_READ_URL_TTL_MS(): number {
    return parseNoteDurationMs(
      "NOTE_IMAGE_READ_URL_TTL",
      getNoteDurationEnvVar("NOTE_IMAGE_READ_URL_TTL", "15m"),
    );
  },
  get NOTE_TRASH_RETENTION(): string {
    return getNoteDurationEnvVar("NOTE_TRASH_RETENTION", "7d");
  },
  get NOTE_TRASH_RETENTION_MS(): number {
    return parseNoteDurationMs(
      "NOTE_TRASH_RETENTION",
      getNoteDurationEnvVar("NOTE_TRASH_RETENTION", "7d"),
    );
  },
  get CRON_SECRET(): string {
    return getNonBlankEnvVar("CRON_SECRET");
  },
};
