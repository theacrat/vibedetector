class ApiError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const COOKIE = "vd_identity";
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";

function challengeConfig(
  bindings: Cloudflare.Env,
  hostname: string,
): { siteKey: string; secret: string; hostname: string; local: boolean } {
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const configuredSecret = bindings.TURNSTILE_SECRET_KEY ?? "";
  const useTestKeys = configuredSecret === "" && local;
  const siteKey = useTestKeys ? TEST_SITE_KEY : bindings.TURNSTILE_SITE_KEY;
  const secret = useTestKeys ? TEST_SECRET : configuredSecret;
  if (
    !siteKey ||
    !secret ||
    (!local &&
      (!bindings.TURNSTILE_HOSTNAME || /^[123]x0+/u.test(siteKey) || /^[123]x0+/u.test(secret)))
  ) {
    throw new ApiError(503, "Reporting is not configured");
  }
  return { hostname: local ? hostname : bindings.TURNSTILE_HOSTNAME, local, secret, siteKey };
}

async function browserIdentity(request: Request): Promise<{ hash: string; cookie: string | null }> {
  const raw = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const valid = raw !== undefined && /^[a-f0-9]{64}$/u.test(raw);
  const identity = valid
    ? raw
    : Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
  const encoded = new TextEncoder().encode(identity);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // No Set-Cookie is needed for an existing identity.
  const cookie = valid
    ? // oxlint-disable-next-line unicorn/no-null
      null
    : `${COOKIE}=${identity}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  return { cookie, hash };
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new ApiError(403, "Origin rejected");
  }
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new ApiError(415, "Expected application/json");
  }
  if (Number(request.headers.get("Content-Length")) > 4096) {
    throw new ApiError(413, "Body too large");
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = request.body?.getReader();
  if (!reader) {
    throw new ApiError(400, "Missing body");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // Stream reads are sequential to enforce the bound without buffering ahead.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > 4096) {
        // Cancellation must finish before releasing the stream lock.
        // oxlint-disable-next-line eslint/no-await-in-loop
        await reader.cancel();
        throw new ApiError(413, "Body too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
}

type VerifyFetch = (input: string, init: RequestInit) => Promise<Response>;

function validChallengeResult(result: object, hostname: string, dummy: boolean): boolean {
  if (dummy) {
    return (
      "metadata" in result &&
      typeof result.metadata === "object" &&
      result.metadata !== null &&
      "result_with_testing_key" in result.metadata &&
      result.metadata.result_with_testing_key === true
    );
  }
  return (
    "hostname" in result &&
    result.hostname === hostname &&
    "action" in result &&
    result.action === "report"
  );
}

async function verifyChallenge(
  config: ReturnType<typeof challengeConfig>,
  token: string,
  verifyFetch: VerifyFetch = fetch,
): Promise<void> {
  try {
    const response = await verifyFetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: new URLSearchParams({ response: token, secret: config.secret }),
        method: "POST",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      throw new Error("Verification unavailable");
    }
    const result: unknown = await response.json();
    const dummy = config.local && config.secret === TEST_SECRET;
    if (
      !result ||
      typeof result !== "object" ||
      !("success" in result) ||
      result.success !== true ||
      !validChallengeResult(result, config.hostname, dummy)
    ) {
      throw new ApiError(403, "Challenge rejected");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(503, "Challenge verification unavailable");
  }
}
export { ApiError, browserIdentity, challengeConfig, readJson, verifyChallenge };
export type { VerifyFetch };
