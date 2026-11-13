// A client for the calibre content server's AJAX API (calibre-server with --disable-auth). Everything
// goes through /api, proxied by nginx (production) or the Vite dev server (development).

export const API = "/api";

export interface FormatInfo {
  path: string;
  size: number;
  mtime: string;
}

export interface CustomField {
  name: string;
  datatype: string;
  is_category: boolean;
  is_multiple: unknown;
  "#value#": unknown;
}

export interface Book {
  application_id: number;
  uuid: string;
  title: string;
  title_sort: string;
  authors: string[];
  author_sort: string;
  author_sort_map: Record<string, string>;
  tags: string[];
  series: string | null;
  series_index: number | null;
  /** Stars, 0–5. */
  rating: number;
  /** HTML. */
  comments: string | null;
  publisher: string | null;
  pubdate: string;
  /** When the book was added. */
  timestamp: string;
  last_modified: string;
  languages: string[];
  identifiers: Record<string, string>;
  /** Lower-case format names (epub, pdf, mp3, …). */
  formats: string[];
  format_metadata: Record<string, FormatInfo>;
  main_format: Record<string, string>;
  other_formats: Record<string, string>;
  pages?: number | null;
  user_metadata: Record<string, CustomField>;
}

export interface CategoryItem {
  name: string;
  count: number;
  average_rating: number;
  url: string;
  has_children: boolean;
}

export type Category = "authors" | "series" | "tags" | "languages" | "publisher" | "rating";
export type SortKey = "title" | "authors" | "timestamp" | "pubdate" | "rating" | "series" | "size" | "last_modified";
export type Order = "asc" | "desc";

export interface SearchOpts {
  num?: number;
  offset?: number;
  sort?: SortKey;
  order?: Order;
}

export interface SearchResult {
  total_num: number;
  offset: number;
  num: number;
  book_ids: number[];
}

export interface Page {
  items: Book[];
  total: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? "?" + s : "";
}

let reloading = false;
/** Behind a sign-in proxy an expired session turns API calls into redirects to the login page:
 * reload the page, which goes through the login and comes back. */
function sessionExpired(): never {
  if (!reloading) {
    reloading = true;
    window.location.reload();
  }
  throw new ApiError(401, "Signed out");
}

async function get<T>(path: string, q?: Query): Promise<T> {
  const res = await fetch(API + path + qs(q), { redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 401) sessionExpired();
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new ApiError(res.status, text.slice(0, 200) || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// The library: calibre-server can serve several; this UI shows the default one. Loaded once before
// the app renders (main.tsx); an empty id makes the server use its default anyway.
let lib = "";
export const libraryLoaded: Promise<void> = get<{ default_library: string }>("/ajax/library-info")
  .then((i) => void (lib = i.default_library ?? ""))
  .catch(() => {});

/** Category names travel hex-encoded in the URL (calibre's convention). */
const hex = (s: string) =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

const categoryCache = new Map<string, Promise<CategoryItem[]>>();

export const api = {
  search: (query: string, o: SearchOpts = {}) =>
    get<SearchResult>(`/ajax/search/${lib}`, {
      query,
      num: o.num ?? 50,
      offset: o.offset ?? 0,
      sort: o.sort ?? "title",
      sort_order: o.order ?? "asc",
    }),

  /** Metadata of several books, in the order of `ids` (missing ones are skipped). */
  books: async (ids: number[]): Promise<Book[]> => {
    if (!ids.length) return [];
    const r = await get<Record<string, Book>>(`/ajax/books/${lib}`, { ids: ids.join(",") });
    return ids.map((id) => r[String(id)]).filter(Boolean);
  },

  book: (id: number | string) => get<Book>(`/ajax/book/${id}/${lib}`),

  /** Search, then the matching books' metadata: one page of results. */
  list: async (query: string, o: SearchOpts = {}): Promise<Page> => {
    const r = await api.search(query, o);
    return { items: await api.books(r.book_ids), total: r.total_num };
  },

  category: (name: Category, o: { sort?: "name" | "popularity" | "rating"; order?: Order; num?: number } = {}) =>
    get<{ total_num: number; items: CategoryItem[] }>(`/ajax/category/${hex(name)}/${lib}`, {
      num: o.num ?? 10000,
      sort: o.sort ?? "name",
      sort_order: o.order ?? (o.sort && o.sort !== "name" ? "desc" : "asc"),
    }).then((r) => r.items),

  /** The whole category, fetched once per page load (they are small: a few hundred entries). */
  categoryCached: (name: Category): Promise<CategoryItem[]> => {
    let p = categoryCache.get(name);
    if (!p) {
      p = api.category(name).catch((e) => {
        categoryCache.delete(name);
        throw e;
      });
      categoryCache.set(name, p);
    }
    return p;
  },
};

// ------------------------------------------------------------------ calibre search expressions

const quote = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

/** Builders for calibre's search language (https://manual.calibre-ebook.com/gui.html#the-search-interface). */
export const Q = {
  /** Exact match: tags:"=Fantasy". */
  eq: (field: string, value: string) => `${field}:${quote("=" + value)}`,
  /** Contains: authors:"Child". */
  has: (field: string, value: string) => `${field}:${quote(value)}`,
  and: (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(" and "),
  or: (...parts: (string | false | undefined | null)[]) => {
    const ps = parts.filter(Boolean);
    return ps.length > 1 ? "(" + ps.join(" or ") + ")" : (ps[0] ?? "");
  },
  /** Free text: every word must appear in the title, authors, series, tags, description or publisher. */
  text: (term: string) => {
    const words = term.trim().split(/\s+/).filter(Boolean);
    const fields = ["title", "authors", "series", "tags", "comments", "publisher"];
    return Q.and(...words.map((w) => Q.or(...fields.map((f) => Q.has(f, w)))));
  },
};

// ------------------------------------------------------------------ URLs

/** A cover scaled to fit w×h (calibre keeps the aspect ratio). */
export const thumbUrl = (id: number, w = 400, h = 600) => `${API}/get/thumb/${id}/${lib}?sz=${w}x${h}`;
export const coverUrl = (id: number) => `${API}/get/cover/${id}/${lib}`;
/** The book file; `inline` makes the browser show it (PDF viewer, audio) instead of saving it. */
export const fileUrl = (id: number, fmt: string, inline = false) =>
  `${API}/get/${fmt}/${id}/${lib}` + (inline ? "?content_disposition=inline" : "");

// ------------------------------------------------------------------ formatting

export const bookPath = (b: Book | number) => `/book/${typeof b === "number" ? b : b.application_id}`;
export const authorPath = (name: string) => `/author/${encodeURIComponent(name)}`;
export const seriesPath = (name: string) => `/series/${encodeURIComponent(name)}`;
export const tagPath = (name: string) => `/tag/${encodeURIComponent(name)}`;

/** calibre stores "no date" as year 101: treat anything before 1000 as unknown. */
export function year(date?: string | null): number | undefined {
  if (!date) return undefined;
  const y = Number(date.slice(0, 4));
  return y >= 1000 ? y : undefined;
}

export function formatDate(date?: string | null): string {
  if (!year(date)) return "";
  return new Date(date!).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatIndex(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function seriesLabel(b: Book): string {
  if (!b.series) return "";
  const i = formatIndex(b.series_index);
  return i ? `${b.series} #${i}` : b.series;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

export const authorsLine = (b: Book) => b.authors.join(", ");

export const hasFormat = (b: Book, fmt: string) => b.formats.includes(fmt);
export const isAudiobook = (b: Book) => hasFormat(b, "mp3") || hasFormat(b, "m4b");

/** The "Finished" custom column (a yes/no column), if the library has one. */
export function isFinished(b: Book): boolean {
  for (const f of Object.values(b.user_metadata ?? {})) {
    if (f.datatype === "bool" && /finish|read/i.test(f.name) && f["#value#"] === true) return true;
  }
  return false;
}

export function stripHtml(html?: string | null): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

const LANGS: Record<string, string> = {
  eng: "English", ces: "Czech", cze: "Czech", slk: "Slovak", slo: "Slovak", deu: "German", ger: "German",
  fra: "French", fre: "French", spa: "Spanish", ita: "Italian", rus: "Russian", pol: "Polish", hun: "Hungarian",
  jpn: "Japanese", por: "Portuguese", nld: "Dutch", dut: "Dutch", swe: "Swedish", nor: "Norwegian", dan: "Danish",
  fin: "Finnish", ukr: "Ukrainian", hrv: "Croatian", zho: "Chinese", chi: "Chinese", kor: "Korean", tur: "Turkish",
  ara: "Arabic", lat: "Latin", ell: "Greek", gre: "Greek", heb: "Hebrew", und: "Unknown",
};

export const languageName = (code: string) => LANGS[code.toLowerCase()] ?? code;

/** Where an identifier points on the web. */
export function identifierUrl(kind: string, value: string): string | undefined {
  switch (kind.toLowerCase()) {
    case "isbn": return `https://openlibrary.org/isbn/${value}`;
    case "amazon": case "mobi-asin": case "asin": return `https://www.amazon.com/dp/${value}`;
    case "goodreads": return `https://www.goodreads.com/book/show/${value}`;
    case "google": return `https://books.google.com/books?id=${value}`;
    case "doi": return `https://doi.org/${value}`;
    case "databazeknih": return `https://www.databazeknih.cz/knihy/${value}`;
    case "uri": case "url": return value;
    default: return undefined;
  }
}

export function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
