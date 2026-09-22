import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, posix, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const COOKIE_NAME = "miska_1c_session";
const DEFAULT_FILE_LIMIT = 5 * 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = 256 * 1024 * 1024;
const SESSION_TTL_MS = 60 * 60 * 1000;

function env(name) {
  return process.env[name]?.trim() ?? "";
}

function enabled() {
  return env("ONEC_EXCHANGE_ENABLED").toLowerCase() === "true";
}

function positiveInt(name, fallback) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function fail(res, message, status = 400, headers = {}) {
  send(res, status, `failure\n${message}`, headers);
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseBasicAuth(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function sessionSecret() {
  const password = env("ONEC_EXCHANGE_PASSWORD");
  if (!password) throw new Error("ONEC_EXCHANGE_PASSWORD is not configured");
  return password;
}

function sign(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function createSessionToken() {
  const payload = `${Date.now()}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}

function parseCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [cookieName, ...rest] = part.trim().split("=");
    if (cookieName === name) return rest.join("=") || null;
  }
  return null;
}

function validSession(req) {
  const token = parseCookie(req, COOKIE_NAME);
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [issuedRaw, nonce, signature] = parts;
  const issued = Number(issuedRaw);
  const now = Date.now();
  if (!Number.isFinite(issued) || now - issued > SESSION_TTL_MS || issued > now + 60_000) return null;
  const expected = sign(`${issuedRaw}.${nonce}`);
  return constantTimeEqual(signature, expected) ? token : null;
}

function authenticated(req) {
  const credentials = parseBasicAuth(req);
  const username = env("ONEC_EXCHANGE_USERNAME");
  const password = env("ONEC_EXCHANGE_PASSWORD");
  return Boolean(
    credentials &&
      username &&
      password &&
      constantTimeEqual(credentials.username, username) &&
      constantTimeEqual(credentials.password, password),
  );
}

function safeRelativeFilename(raw) {
  const normalized = posix.normalize(String(raw ?? "").replaceAll("\\", "/")).replace(/^(\.\/)+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0")
  ) {
    throw new Error("invalid filename");
  }
  return normalized;
}

function sessionRoot(token) {
  const root = env("ONEC_EXCHANGE_STORAGE_DIR") || "/var/lib/onec-exchange";
  const sessionId = createHash("sha256").update(token).digest("hex").slice(0, 24);
  return resolve(root, sessionId);
}

function filePathFor(token, filename) {
  const root = sessionRoot(token);
  const target = resolve(root, safeRelativeFilename(filename));
  if (target !== root && !target.startsWith(root + sep)) throw new Error("invalid filename");
  return target;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error(`chunk exceeds file_limit=${limit}`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function appendChunk(token, filename, req) {
  const fileLimit = positiveInt("ONEC_EXCHANGE_FILE_LIMIT", DEFAULT_FILE_LIMIT);
  const body = await readBody(req, fileLimit);
  const target = filePathFor(token, filename);
  await mkdir(dirname(target), { recursive: true });

  let currentSize = 0;
  try {
    currentSize = (await stat(target)).size;
  } catch {
    currentSize = 0;
  }

  const maxSize = positiveInt("ONEC_EXCHANGE_MAX_FILE_SIZE", DEFAULT_MAX_FILE_SIZE);
  if (currentSize + body.length > maxSize) throw new Error(`file exceeds maximum size ${maxSize}`);

  const handle = await open(target, "a");
  try {
    await handle.write(body);
  } finally {
    await handle.close();
  }
}

async function markImported(token, filename) {
  const target = filePathFor(token, filename);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("exchange file not found");

  const root = sessionRoot(token);
  await mkdir(root, { recursive: true });
  const record = {
    filename: safeRelativeFilename(filename),
    size: info.size,
    accepted_at: new Date().toISOString(),
    state: "staged",
  };
  await appendFile(resolve(root, "imports.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

function logEvent(mode, filename, result) {
  const safeMode = String(mode ?? "unknown").replace(/[^a-z0-9_-]/gi, "");
  const safeFile = filename ? safeRelativeFilename(filename) : "";
  console.info("1C exchange", { mode: safeMode, filename: safeFile, result });
}

export async function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, "ok");
    return;
  }

  let url;
  try {
    url = new URL(req.url ?? "/", "http://onec-sync.local");
  } catch {
    fail(res, "invalid request URL");
    return;
  }

  if (url.pathname !== "/api/1c/exchange") {
    fail(res, "not found", 404);
    return;
  }
  if (!enabled()) {
    fail(res, "exchange disabled", 404);
    return;
  }

  const type = url.searchParams.get("type");
  const mode = url.searchParams.get("mode");
  if (type !== "catalog") {
    fail(res, "only catalog exchange is enabled");
    return;
  }

  if (mode === "checkauth") {
    if (!authenticated(req)) {
      fail(res, "authentication failed", 401, { "WWW-Authenticate": 'Basic realm="Miska 1C"' });
      return;
    }
    const token = createSessionToken();
    const cookie = `${COOKIE_NAME}=${token}; Path=/api/1c/exchange; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`;
    send(res, 200, `success\n${COOKIE_NAME}\n${token}`, { "Set-Cookie": cookie });
    logEvent(mode, "", "success");
    return;
  }

  const token = validSession(req);
  if (!token) {
    fail(res, "session is missing or expired", 401);
    return;
  }

  if (mode === "init") {
    const fileLimit = positiveInt("ONEC_EXCHANGE_FILE_LIMIT", DEFAULT_FILE_LIMIT);
    send(res, 200, `zip=no\nfile_limit=${fileLimit}`);
    logEvent(mode, "", "success");
    return;
  }

  const filename = url.searchParams.get("filename") ?? "";
  if (mode === "file") {
    if (req.method !== "POST") {
      fail(res, "file mode requires POST", 405);
      return;
    }
    try {
      await appendChunk(token, filename, req);
      send(res, 200, "success");
      logEvent(mode, filename, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "file write failed";
      fail(res, message);
      console.warn("1C exchange file rejected", { mode, reason: message });
    }
    return;
  }

  if (mode === "import") {
    try {
      await markImported(token, filename);
      send(res, 200, "success");
      logEvent(mode, filename, "staged");
    } catch (error) {
      const message = error instanceof Error ? error.message : "import staging failed";
      fail(res, message);
      console.warn("1C exchange import rejected", { mode, reason: message });
    }
    return;
  }

  fail(res, "unsupported exchange mode");
}

export function createExchangeServer() {
  return createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : "internal error";
      console.error("1C exchange unhandled error", { reason: message });
      if (!res.headersSent) fail(res, "internal error", 500);
      else res.destroy();
    });
  });
}

const executedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (executedDirectly) {
  const port = positiveInt("PORT", 8080);
  const server = createExchangeServer();
  server.listen(port, "0.0.0.0", () => {
    console.info(`1C exchange receiver listening on port ${port}`);
  });
}
