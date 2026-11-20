// Reading state: where the user is in each book, which ones they finished, and their wishlist and
// favorites.
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
  /** On the wishlist (to read) since then (ms since the epoch). */
  wish?: number;
  /** A favorite since then (ms since the epoch). */
  fav?: number;
}

/** The user's two lists: the wishlist (★, books to read) and favorites (♥, books they liked). */
export type ListKind = "wish" | "fav";

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

export interface Profile {
  name?: string; givenName?: string; familyName?: string; picture?: string; locale?: string; domain?: string;
  emailVerified?: boolean; subject?: string; issuer?: string; user?: string; preferredUsername?: string; groups?: string[];
}
export interface Activity { firstSeen?: number; lastSeen?: number; sessionStart?: number; previousSession?: number; sessions?: number }
export interface Account {
  user: string;
  profile: Profile | null;
  activity: Activity;
  downloads: { count: number; recent: { id: number; fmt: string; at: number; title?: string }[] };
}
type Me = Account & { books: Record<string, Omit<Progress, "id">> };

let user: string | null = null;
let account: Account | null = null;
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
    const s = (await r.json()) as Me;
    if (!s.user) return loadLocal();
    user = s.user;
    account = { user: s.user, profile: s.profile, activity: s.activity ?? {}, downloads: s.downloads ?? { count: 0, recent: [] } };
    remote = true;
    for (const [id, m] of Object.entries(s.books ?? {})) {
      books.set(Number(id), {
        id: Number(id), title: m.title ?? "", authors: m.authors ?? [], pct: m.pct ?? 0, at: m.at ?? 0, cfi: m.cfi, finished: m.finished,
        wish: m.wish, fav: m.fav,
      });
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
    // The server merges marks: a list the book was taken off has to be sent as null.
    init.body = JSON.stringify({ ...body, wish: p.wish ?? null, fav: p.fav ?? null });
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

  /** Profile, sessions and downloads (null without a sign-in). */
  get account() {
    return account;
  },

  /** The account data again from the server (the user page). */
  async refreshAccount(): Promise<Account | null> {
    if (!remote) return null;
    const r = await fetch("/state/me", { cache: "no-store", redirect: "manual" });
    if (!r.ok) return account;
    const s = (await r.json()) as Me;
    account = { user: s.user, profile: s.profile, activity: s.activity ?? {}, downloads: s.downloads ?? { count: 0, recent: [] } };
    return account;
  },

  get: (id: number) => books.get(id),

  /** A new position from the reader; keeps the finished flag and the lists. */
  set(p: Omit<Progress, "finished" | ListKind>) {
    const prev = books.get(p.id);
    store({ ...p, finished: prev?.finished, wish: prev?.wish, fav: prev?.fav });
  },

  setFinished(id: number, finished: boolean, meta: { title: string; authors: string[] }) {
    const prev = books.get(id);
    store({ pct: 0, ...prev, id, title: meta.title, authors: meta.authors, at: Date.now(), finished });
  },

  /** Puts the book on the wishlist or the favorites, or takes it off. Leaves `at` alone (it orders
   * Continue Reading). */
  setListed(id: number, list: ListKind, on: boolean, meta: { title: string; authors: string[] }) {
    const prev = books.get(id);
    store({ pct: 0, at: 0, ...prev, id, title: meta.title, authors: meta.authors, [list]: on ? Date.now() : undefined });
  },

  /** Books on the wishlist or the favorites, most recently added first. */
  listed(list: ListKind): Progress[] {
    return [...books.values()].filter((p) => p[list]).sort((a, b) => (b[list] ?? 0) - (a[list] ?? 0));
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
