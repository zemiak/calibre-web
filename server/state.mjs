// Per-user reading state: which books a user has started, how far they got (an EPUB CFI and a
// percentage) and which ones they marked finished. One JSON file per user under STATE_DIR.
//
// The user is whoever the sign-in proxy says: oauth2-proxy sets X-Forwarded-Email on every
// request it lets through. Without that header (the internal hostname has no login) requests get
// 401 and the app keeps its marks in the browser instead.
//
// Runs next to nginx (which proxies /state/ here) with no dependencies: node server/state.mjs
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const DIR = process.env.STATE_DIR ?? "/data";
const PORT = Number(process.env.STATE_PORT ?? 8081);
const HOST = process.env.STATE_HOST ?? "127.0.0.1";
const MAX_BODY = 16 * 1024;

/** @typedef {{ cfi?: string, pct?: number, at?: number, title?: string, authors?: string[], finished?: boolean }} Mark */

const fileOf = (email) => join(DIR, createHash("sha256").update(email.toLowerCase()).digest("hex") + ".json");

/** @type {Map<string, { email: string, books: Record<string, Mark> }>} */
const cache = new Map();
/** Writes to one user's file happen one after another. @type {Map<string, Promise<void>>} */
const queues = new Map();

async function load(email) {
  const key = email.toLowerCase();
  let s = cache.get(key);
  if (!s) {
    try {
      const parsed = JSON.parse(await readFile(fileOf(email), "utf8"));
      s = { email, books: parsed.books && typeof parsed.books === "object" ? parsed.books : {} };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      s = { email, books: {} };
    }
    cache.set(key, s);
  }
  return s;
}

function save(email, state) {
  const key = email.toLowerCase();
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const file = fileOf(email);
      const tmp = file + ".tmp";
      await writeFile(tmp, JSON.stringify({ email: state.email, updated: new Date().toISOString(), books: state.books }, null, 1));
      await rename(tmp, file);
    });
  queues.set(key, next);
  return next;
}

/** Keeps only the fields the app sends, with sane types. @returns {Mark | undefined} */
function clean(body) {
  if (!body || typeof body !== "object") return undefined;
  /** @type {Mark} */
  const m = {};
  if (typeof body.cfi === "string" && body.cfi.length < 2000) m.cfi = body.cfi;
  if (typeof body.pct === "number" && isFinite(body.pct)) m.pct = Math.min(100, Math.max(0, body.pct));
  if (typeof body.at === "number" && isFinite(body.at)) m.at = body.at;
  if (typeof body.title === "string") m.title = body.title.slice(0, 500);
  if (Array.isArray(body.authors)) m.authors = body.authors.filter((a) => typeof a === "string").slice(0, 20);
  if (typeof body.finished === "boolean") m.finished = body.finished;
  return m;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/^\/state(?=\/|$)/, "") || "/";
  try {
    if (path === "/health") return send(res, 200, { ok: true });

    const email = String(req.headers["x-forwarded-email"] ?? "").trim();
    if (!email || !email.includes("@")) return send(res, 401, { user: null, error: "not signed in" });
    const state = await load(email);

    if (path === "/me" && req.method === "GET") return send(res, 200, { user: state.email, books: state.books });

    const m = path.match(/^\/books\/(\d{1,9})$/);
    if (m) {
      const id = m[1];
      if (req.method === "GET") return send(res, 200, state.books[id] ?? null);
      if (req.method === "PUT") {
        const mark = clean(await readBody(req));
        if (!mark) return send(res, 400, { error: "a JSON object is expected" });
        state.books[id] = { ...state.books[id], ...mark };
        await save(email, state);
        return send(res, 200, state.books[id]);
      }
      if (req.method === "DELETE") {
        delete state.books[id];
        await save(email, state);
        return send(res, 204);
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    const status = e.status ?? 500;
    if (status >= 500) console.error(new Date().toISOString(), req.method, req.url, e);
    send(res, status, { error: e.message });
  }
});

await mkdir(DIR, { recursive: true });
server.listen(PORT, HOST, () => console.log(`state service on http://${HOST}:${PORT}, files in ${DIR}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
