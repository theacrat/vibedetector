export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const COOKIE = "vd_identity";
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";

export function challengeConfig(
  bindings: Cloudflare.Env,
  hostname: string,
): { siteKey: string; secret: string; hostname: string; local: boolean } {
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const siteKey = bindings.TURNSTILE_SITE_KEY || (local ? TEST_SITE_KEY : "");
  const secret = bindings.TURNSTILE_SECRET_KEY || (local ? TEST_SECRET : "");
  if (
    !siteKey ||
    !secret ||
    (!local &&
      (!bindings.TURNSTILE_HOSTNAME || /^[123]x0+/.test(siteKey) || /^[123]x0+/.test(secret)))
  ) {
    throw new ApiError(503, "Reporting is not configured");
  }
  return { hostname: local ? hostname : bindings.TURNSTILE_HOSTNAME, local, secret, siteKey };
}

export async function browserIdentity(
  request: Request,
): Promise<{ hash: string; cookie: string | null }> {
  const raw = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const valid = raw !== undefined && /^[a-f0-9]{64}$/.test(raw);
  const identity = valid
    ? raw
    : Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    cookie: valid
      ? null
      : `${COOKIE}=${identity}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    hash,
  };
}

export async function readJson(request: Request): Promise<unknown> {
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
  const reader = request.body?.getReader();
  if (!reader) {
    throw new ApiError(400, "Missing body");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > 4096) {
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

export type VerifyFetch = (input: string, init: RequestInit) => Promise<Response>;

export async function verifyChallenge(
  config: ReturnType<typeof challengeConfig>,
  token: string,
  verifyFetch: VerifyFetch = fetch,
): Promise<void> {
  try {
    const response = await verifyFetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: new URLSearchParams({ secret: config.secret, response: token }),
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
      !("hostname" in result) ||
      result.hostname !== (dummy ? "localhost" : config.hostname) ||
      !("action" in result) ||
      result.action !== (dummy ? "test" : "report")
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
