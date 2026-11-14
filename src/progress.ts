// Reading state: where the user is in each book and which ones they finished.
//
// Behind the sign-in proxy it belongs to the signed-in user (the proxy's login email) and lives
// on the server (/state, see server/state.mjs), so it follows the user across devices. Without a
// sign-in (the internal hostname, development) it stays in this browser's localStorage.
// Positions are EPUB CFIs, so they survive window size changes.

export interface Progress {
  id: number;
  cfi?: string;
  /** 0–100 */
  pct: number;
  /** Last change (ms since the epoch). */
  at: number;
  title: string;
  authors: string[];
  /** Marked finished by the user (calibre's own "Finished" column is separate). */
  finished?: boolean;
}

export interface ReaderPrefs {
  theme: "dark" | "sepia" | "light";
  /** Percent of the book's own size. */
  fontSize: number;
}

const PREFIX = "read:";

function readLocal<T>(key: string): T | undefined {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full store: reading still works, it just won't be remembered.
  }
}

// ------------------------------------------------------------------ the store

let user: string | null = null;
let remote = false;
const books = new Map<number, Progress>();

function loadLocal() {
  remote = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const p = readLocal<Progress>(k);
      if (p?.id) books.set(p.id, p);
    }
  } catch {
    // ignore
  }
}

/** Loaded once before the app renders (main.tsx): the components read the store synchronously. */
export const stateLoaded: Promise<void> = fetch("/state/me", { redirect: "manual", cache: "no-store" })
  .then(async (r) => {
    if (r.type === "opaqueredirect") {
      window.location.reload(); // the sign-in session expired
      return;
    }
    if (!r.ok) return loadLocal();
    const s = (await r.json()) as { user: string | null; books: Record<string, Omit<Progress, "id">> };
    if (!s.user) return loadLocal();
    user = s.user;
    remote = true;
    for (const [id, m] of Object.entries(s.books ?? {})) {
      books.set(Number(id), { id: Number(id), title: m.title ?? "", authors: m.authors ?? [], pct: m.pct ?? 0, at: m.at ?? 0, cfi: m.cfi, finished: m.finished });
    }
  })
  .catch(loadLocal);

// Writes to the server are coalesced per book: the reader reports every page turn.
const pending = new Map<number, ReturnType<typeof setTimeout>>();

function push(id: number, keepalive = false) {
  const t = pending.get(id);
  if (t) clearTimeout(t);
  pending.delete(id);
  const p = books.get(id);
  const init: RequestInit = { method: p ? "PUT" : "DELETE", keepalive, redirect: "manual" };
  if (p) {
    const { id: _id, ...body } = p;
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  fetch(`/state/books/${id}`, init).catch(() => {});
}

function schedule(id: number, delay = 1500) {
  const t = pending.get(id);
  if (t) clearTimeout(t);
  pending.set(id, setTimeout(() => push(id), delay));
}

function flush() {
  for (const id of [...pending.keys()]) push(id, true);
}
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

function store(p: Progress) {
  books.set(p.id, p);
  if (remote) schedule(p.id);
  else writeLocal(PREFIX + p.id, p);
}

export const progress = {
  /** The signed-in user's email, or null when the marks are kept only in this browser. */
  get user() {
    return user;
  },

  get: (id: number) => books.get(id),

  /** A new position from the reader; keeps the finished flag. */
  set(p: Omit<Progress, "finished">) {
    store({ ...p, finished: books.get(p.id)?.finished });
  },

  setFinished(id: number, finished: boolean, meta: { title: string; authors: string[] }) {
    const prev = books.get(id);
    store({ pct: 0, ...prev, id, title: meta.title, authors: meta.authors, at: Date.now(), finished });
  },

  remove(id: number) {
    books.delete(id);
    if (remote) schedule(id, 0);
    else writeLocal(PREFIX + id, undefined);
  },

  /** Books started but not finished, most recent first. */
  list(): Progress[] {
    return [...books.values()].filter((p) => p.pct > 0 && p.pct < 100 && !p.finished).sort((a, b) => b.at - a.at);
  },

  /** Finished marks, most recent first. */
  finished(): Progress[] {
    return [...books.values()].filter((p) => p.finished).sort((a, b) => b.at - a.at);
  },

  /** epub.js "locations" (the pagination used for the progress slider): expensive to compute, the
   * same for everyone, so cached per browser. */
  locations: {
    get: (id: number) => readLocal<string>("loc:" + id),
    set: (id: number, s: string) => writeLocal("loc:" + id, s),
  },

  /** Theme and text size: a device preference, kept per browser. */
  prefs: {
    get: (): ReaderPrefs => ({ theme: "dark", fontSize: 100, ...readLocal<Partial<ReaderPrefs>>("reader:prefs") }),
    set: (p: ReaderPrefs) => writeLocal("reader:prefs", p),
  },
};
