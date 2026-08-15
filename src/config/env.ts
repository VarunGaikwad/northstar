import "dotenv/config";

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
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

// FRONTEND_URL may be a single URL or a comma-separated list of allowed
// frontend origins (CORS). The first entry is the canonical URL used for
// password-reset email links (src/utils/email.ts).
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

  // Optional SMTP config. If omitted, password-reset emails are logged to the
  // console instead of being sent.
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM ?? "no-reply@northstar.app",

  // First/canonical frontend URL (used in password-reset email links).
  FRONTEND_URL: frontendUrls[0],
  // All allowed frontend origins, for CORS. One or more comma-separated URLs.
  FRONTEND_URLS: frontendUrls,
  CHROME_EXTENSION_ORIGINS: chromeExtensionOrigins,
  TRUSTED_ORIGINS: [...frontendUrls, ...chromeExtensionOrigins],

  UNSPLASH_ACCESS_KEY: getEnvVar("UNSPLASH_ACCESS_KEY"),

  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,
};
