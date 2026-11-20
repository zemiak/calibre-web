// Per-user state: reading positions, finished marks, the wishlist and favorites, the user's profile from the sign-in
// (SSO), their sessions ("logins") and downloads. One JSON file per user under STATE_DIR.
//
// The user is whoever the sign-in proxy says: oauth2-proxy sets X-Forwarded-Email on every
// request it lets through, and with --pass-authorization-header also the Google ID token
// (Authorization: Bearer …), whose claims give the name and picture. Without the email header
// (the internal hostname has no login) requests get 401 and the app keeps its marks in the browser.
//
// Runs next to nginx (which proxies /state/ here) with no dependencies: node server/state.mjs
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { libraryStatus, serveLibrary, startLibrary } from "./library.mjs";

const DIR = process.env.STATE_DIR ?? "/data";
const PORT = Number(process.env.STATE_PORT ?? 8081);
const HOST = process.env.STATE_HOST ?? "127.0.0.1";
const MAX_BODY = 16 * 1024;
/** A request after this much quiet starts a new session (counted as a login). */
const SESSION_GAP_MS = 30 * 60 * 1000;
/** lastSeen is written at most this often (positions are written anyway). */
const SEEN_WRITE_MS = 5 * 60 * 1000;
const RECENT_DOWNLOADS = 50;

const fileOf = (email) => join(DIR, createHash("sha256").update(email.toLowerCase()).digest("hex") + ".json");

/**
 * @typedef {{ cfi?: string, pct?: number, at?: number, title?: string, authors?: string[], finished?: boolean, wish?: number, fav?: number }} Mark
 * (wish and fav: when the book went on the wishlist or the favorites; absent when it isn't on them)
 * @typedef {{ name?: string, givenName?: string, familyName?: string, picture?: string, locale?: string, domain?: string, emailVerified?: boolean, subject?: string, issuer?: string, user?: string, preferredUsername?: string, groups?: string[] }} Profile
 * @typedef {{ firstSeen?: number, lastSeen?: number, sessionStart?: number, previousSession?: number, sessions?: number }} Activity
 * @typedef {{ id: number, fmt: string, at: number, title?: string }} Download
 * @typedef {{ email: string, books: Record<string, Mark>, profile?: Profile, activity: Activity, downloads: { count: number, recent: Download[] }, savedSeen?: number }} UserState
 */

/** @type {Map<string, UserState>} */
const cache = new Map();
/** Writes to one user's file happen one after another. @type {Map<string, Promise<void>>} */
const queues = new Map();

async function load(email) {
  const key = email.toLowerCase();
  let s = cache.get(key);
  if (!s) {
    let parsed = {};
    try {
      parsed = JSON.parse(await readFile(fileOf(email), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    s = {
      email,
      books: parsed.books && typeof parsed.books === "object" ? parsed.books : {},
      profile: parsed.profile,
      activity: parsed.activity ?? {},
      downloads: { count: parsed.downloads?.count ?? 0, recent: parsed.downloads?.recent ?? [] },
    };
    s.savedSeen = s.activity.lastSeen;
    cache.set(key, s);
  }
  return s;
}

function save(state) {
  const key = state.email.toLowerCase();
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const file = fileOf(state.email);
      const tmp = file + ".tmp";
      const { email, books, profile, activity, downloads } = state;
      await writeFile(tmp, JSON.stringify({ email, updated: new Date().toISOString(), profile, activity, downloads, books }, null, 1));
      await rename(tmp, file);
      state.savedSeen = activity.lastSeen;
    });
  queues.set(key, next);
  return next;
}

/** The claims of a JWT, without checking its signature: it comes from the sign-in proxy, which is
 * trusted the same way as the email header. */
function jwtClaims(authorization) {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.[\w-]*$/.exec(authorization ?? "");
  if (!m) return undefined;
  try {
    return JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** What the sign-in tells about the user: the ID token's claims and oauth2-proxy's other headers. */
function profileFrom(req, email) {
  const c = jwtClaims(req.headers.authorization);
  if (c?.email && String(c.email).toLowerCase() !== email.toLowerCase()) return undefined; // not this user's token
  /** @type {Profile} */
  const p = {};
  const str = (v) => (typeof v === "string" && v ? v.slice(0, 500) : undefined);
  if (c) {
    p.name = str(c.name);
    p.givenName = str(c.given_name);
    p.familyName = str(c.family_name);
    p.picture = /^https:\/\//.test(c.picture ?? "") ? str(c.picture) : undefined;
    p.locale = str(c.locale);
    p.domain = str(c.hd);
    if (typeof c.email_verified === "boolean") p.emailVerified = c.email_verified;
    p.subject = str(c.sub);
    p.issuer = str(c.iss);
  }
  p.user = str(req.headers["x-forwarded-user"]);
  p.preferredUsername = str(req.headers["x-forwarded-preferred-username"]);
  const groups = str(req.headers["x-forwarded-groups"]);
  if (groups) p.groups = groups.split(",").map((g) => g.trim()).filter(Boolean);
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return Object.keys(p).length ? p : undefined;
}

/** Every authenticated request: sessions, last seen, the profile. Returns whether to save now. */
function touch(state, req) {
  const now = Date.now();
  const a = state.activity;
  let dirty = false;
  a.firstSeen ??= now;
  if (!a.lastSeen || now - a.lastSeen > SESSION_GAP_MS) {
    if (a.sessionStart) a.previousSession = a.sessionStart;
    a.sessionStart = now;
    a.sessions = (a.sessions ?? 0) + 1;
    dirty = true;
  }
  a.lastSeen = now;
  const p = profileFrom(req, state.email);
  if (p && JSON.stringify(p) !== JSON.stringify(state.profile)) {
    state.profile = p;
    dirty = true;
  }
  return dirty || now - (state.savedSeen ?? 0) > SEEN_WRITE_MS;
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
  // Wishlist and favorites: a time puts the book on the list, null (or false) takes it off.
  for (const k of ["wish", "fav"]) {
    if (body[k] === null || body[k] === false) m[k] = null;
    else if (typeof body[k] === "number" && isFinite(body[k])) m[k] = body[k];
  }
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

const view = (s) => ({ user: s.email, profile: s.profile ?? null, activity: s.activity, downloads: s.downloads, books: s.books });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/^\/state(?=\/|$)/, "") || "/";
  try {
    if (path === "/health") return send(res, 200, { ok: true, library: libraryStatus() });
    // The library (no sign-in needed: it's the same for everyone).
    if (path === "/library" && (req.method === "GET" || req.method === "HEAD")) return serveLibrary(req, res);

    const email = String(req.headers["x-forwarded-email"] ?? "").trim();
    const signedIn = !!email && email.includes("@");

    // A download: recorded for the user, then redirected to the file itself. Without a sign-in
    // it still redirects (the internal hostname), it just isn't counted.
    if (path === "/download" && req.method === "GET") {
      const to = url.searchParams.get("to") ?? "";
      if (!/^\/files\/[^?#]+$/.test(to) || to.includes("..")) return send(res, 400, { error: "not a book file" });
      if (signedIn) {
        const state = await load(email);
        touch(state, req);
        const id = url.searchParams.get("id");
        const fmt = (to.match(/\.(\w+)$/)?.[1] ?? "").toLowerCase();
        const title = url.searchParams.get("title")?.slice(0, 500) || undefined;
        state.downloads.count++;
        state.downloads.recent = [{ id: Number(id), fmt, at: Date.now(), title }, ...state.downloads.recent].slice(0, RECENT_DOWNLOADS);
        await save(state);
      }
      res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
      return res.end();
    }

    if (!signedIn) return send(res, 401, { user: null, error: "not signed in" });
    const state = await load(email);
    if (touch(state, req)) await save(state);

    if (path === "/me" && req.method === "GET") return send(res, 200, view(state));

    const m = path.match(/^\/books\/(\d{1,9})$/);
    if (m) {
      const id = m[1];
      if (req.method === "GET") return send(res, 200, state.books[id] ?? null);
      if (req.method === "PUT") {
        const mark = clean(await readBody(req));
        if (!mark) return send(res, 400, { error: "a JSON object is expected" });
        const merged = { ...state.books[id], ...mark };
        for (const k of ["wish", "fav"]) if (merged[k] === null) delete merged[k];
        state.books[id] = merged;
        await save(state);
        return send(res, 200, state.books[id]);
      }
      if (req.method === "DELETE") {
        delete state.books[id];
        await save(state);
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
startLibrary();
server.listen(PORT, HOST, () => console.log(`state service on http://${HOST}:${PORT}, files in ${DIR}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
