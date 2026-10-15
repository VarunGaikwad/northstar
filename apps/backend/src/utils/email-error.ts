const SAFE_CODES = new Set([
  "EAUTH", "ETIMEDOUT", "ECONNECTION", "ESOCKET", "EDNS", "ECONNREFUSED",
  "ECONNRESET", "EENVELOPE", "EMESSAGE", "ETLS", "EPROTOCOL",
  "ERESETURL", "ESMTPUNCONFIGURED", "ERECIPIENT",
]);

/** Never include provider messages, responses, recipients, credentials or URLs. */
export function emailErrorDetails(error: unknown): { code: string; responseCode?: number } {
  if (!error || typeof error !== "object") return { code: "UNKNOWN" };
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
  return {
    code: typeof code === "string" && SAFE_CODES.has(code) ? code : "UNKNOWN",
    ...(typeof responseCode === "number" && Number.isInteger(responseCode) && responseCode >= 400 && responseCode <= 599
      ? { responseCode }
      : {}),
  };
}
