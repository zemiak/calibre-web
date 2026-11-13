// Reading state lives in this browser's localStorage: calibre-server (with --disable-auth) has no
// per-user state to put it in. Positions are EPUB CFIs, so they survive window size changes.

export interface Progress {
  id: number;
  cfi: string;
  /** 0–100 */
  pct: number;
  /** Last read (ms since the epoch). */
  at: number;
  title: string;
  authors: string[];
}

export interface ReaderPrefs {
  theme: "dark" | "sepia" | "light";
  /** Percent of the book's own size. */
  fontSize: number;
}

const PREFIX = "read:";

function read<T>(key: string): T | undefined {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full store: reading still works, it just won't be remembered.
  }
}

export const progress = {
  get: (id: number) => read<Progress>(PREFIX + id),
  set: (p: Progress) => write(PREFIX + p.id, p),
  remove: (id: number) => write(PREFIX + id, undefined),

  /** Books started but not finished, most recent first. */
  list(): Progress[] {
    const out: Progress[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(PREFIX)) continue;
        const p = read<Progress>(k);
        if (p && p.pct > 0 && p.pct < 100) out.push(p);
      }
    } catch {
      // ignore
    }
    return out.sort((a, b) => b.at - a.at);
  },

  /** epub.js "locations" (the pagination used for the progress slider), expensive to compute. */
  locations: {
    get: (id: number) => read<string>("loc:" + id),
    set: (id: number, s: string) => write("loc:" + id, s),
  },

  prefs: {
    get: (): ReaderPrefs => ({ theme: "dark", fontSize: 100, ...read<Partial<ReaderPrefs>>("reader:prefs") }),
    set: (p: ReaderPrefs) => write("reader:prefs", p),
  },
};
