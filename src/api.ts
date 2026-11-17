// The calibre library, loaded whole from /state/library (server/library.mjs reads calibre's
// metadata.db and keeps it in memory) and searched, sorted and counted here in the browser.
// Covers (/covers/) and book files (/files/) come straight from the library folder through nginx.

export interface FormatInfo {
  size: number;
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
  pages?: number | null;
  user_metadata: Record<string, CustomField>;
  /** The book's folder in the library, and its files there by format. */
  path: string;
  has_cover: boolean;
  files: Record<string, string>;
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

// ------------------------------------------------------------------ the library

let books: Book[] = [];
let byId = new Map<number, Book>();

let reloading = false;
/** Behind a sign-in proxy an expired session turns requests into redirects to the login page:
 * reload the page, which goes through the login and comes back. */
function sessionExpired(): never {
  if (!reloading) {
    reloading = true;
    window.location.reload();
  }
  throw new ApiError(401, "Signed out");
}

async function fetchLibrary(): Promise<void> {
  // no-cache semantics come from the server: the browser revalidates (a 304 when nothing changed).
  const res = await fetch("/state/library", { redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 401) sessionExpired();
  if (!res.ok) throw new ApiError(res.status, `The library didn't load: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { books: Book[] };
  books = data.books;
  byId = new Map(books.map((b) => [b.application_id, b]));
  haystacks.clear();
  categoryCache.clear();
}

/** Loaded once before the app renders (main.tsx). A failure is shown by the pages (api calls retry). */
let libraryPromise: Promise<void> = fetchLibrary();
export const libraryLoaded: Promise<void> = libraryPromise.catch(() => {});
const ready = () =>
  libraryPromise.catch(() => {
    libraryPromise = fetchLibrary();
    return libraryPromise;
  });

// ------------------------------------------------------------------ filters (calibre's search, in memory)

/** A search expression: what calibre's search language did, as data. */
export type Filter =
  | { and: Filter[] }
  | { or: Filter[] }
  | { not: Filter }
  | { eq: [string, string] }
  | { has: [string, string] }
  | { text: string };

type Part = Filter | false | undefined | null | "";

export const Q = {
  /** Exact match, case-insensitive: tags = "Fantasy"; for custom columns "#finished" = "true". */
  eq: (field: string, value: string): Filter => ({ eq: [field, value] }),
  /** Contains, case- and accent-insensitive (formats: has that format). */
  has: (field: string, value: string): Filter => ({ has: [field, value] }),
  and: (...parts: Part[]): Filter => {
    const ps = parts.filter(Boolean) as Filter[];
    return ps.length === 1 ? ps[0] : { and: ps };
  },
  or: (...parts: Part[]): Filter => {
    const ps = parts.filter(Boolean) as Filter[];
    return ps.length === 1 ? ps[0] : { or: ps };
  },
  not: (f: Filter): Filter => ({ not: f }),
  /** Free text: every word must appear in the title, authors, series, tags, description or publisher. */
  text: (term: string): Filter => ({ text: term }),
};

/** A stable string for a filter (React keys and effect dependencies). */
export const filterKey = (f?: Filter) => JSON.stringify(f ?? null);

/** Lower case without accents: "Čierny" matches "cierny". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const haystacks = new Map<number, string>();
function haystack(b: Book): string {
  let h = haystacks.get(b.application_id);
  if (h === undefined) {
    h = fold([b.title, ...b.authors, b.series ?? "", ...b.tags, stripHtml(b.comments), b.publisher ?? ""].join("\n"));
    haystacks.set(b.application_id, h);
  }
  return h;
}

/** The values of a field, as strings. */
function values(b: Book, field: string): string[] {
  switch (field) {
    case "tags": return b.tags;
    case "authors": return b.authors;
    case "series": return b.series ? [b.series] : [];
    case "publisher": return b.publisher ? [b.publisher] : [];
    case "title": return [b.title];
    case "comments": return [stripHtml(b.comments)];
    case "formats": return b.formats;
    case "languages": return b.languages.flatMap((c) => [c, languageName(c)]);
    case "identifiers": return Object.entries(b.identifiers).map(([k, v]) => `${k}:${v}`);
    default:
      if (field.startsWith("#")) {
        const v = b.user_metadata[field]?.["#value#"];
        if (v === null || v === undefined) return [];
        return Array.isArray(v) ? v.map(String) : [String(v)];
      }
      return [];
  }
}

function matches(b: Book, f: Filter): boolean {
  if ("and" in f) return f.and.every((x) => matches(b, x));
  if ("or" in f) return f.or.some((x) => matches(b, x));
  if ("not" in f) return !matches(b, f.not);
  if ("eq" in f) {
    const want = f.eq[1].toLowerCase();
    return values(b, f.eq[0]).some((v) => v.toLowerCase() === want);
  }
  if ("has" in f) {
    const want = fold(f.has[1]);
    return f.has[0] === "formats" ? b.formats.includes(want) : values(b, f.has[0]).some((v) => fold(v).includes(want));
  }
  const words = fold(f.text).split(/\s+/).filter(Boolean);
  const h = haystack(b);
  return words.every((w) => h.includes(w));
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const time = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);
const size = (b: Book) => Math.max(0, ...Object.values(b.format_metadata).map((m) => m.size));

function comparator(sort: SortKey): (a: Book, b: Book) => number {
  const byTitle = (a: Book, b: Book) => collator.compare(a.title_sort, b.title_sort);
  const then = (f: (a: Book, b: Book) => number) => (a: Book, b: Book) => f(a, b) || byTitle(a, b);
  switch (sort) {
    case "authors": return then((a, b) => collator.compare(a.author_sort, b.author_sort));
    case "timestamp": return then((a, b) => time(a.timestamp) - time(b.timestamp));
    case "pubdate": return then((a, b) => time(a.pubdate) - time(b.pubdate));
    case "last_modified": return then((a, b) => time(a.last_modified) - time(b.last_modified));
    case "rating": return then((a, b) => a.rating - b.rating);
    case "size": return then((a, b) => size(a) - size(b));
    case "series":
      // Books in a series first (by name, then index), the rest after.
      return then((a, b) => {
        if (!a.series !== !b.series) return a.series ? -1 : 1;
        return collator.compare(a.series ?? "", b.series ?? "") || (a.series_index ?? 0) - (b.series_index ?? 0);
      });
    default: return byTitle;
  }
}

function run(filter: Filter | undefined, o: SearchOpts): { all: Book[]; page: Book[] } {
  const found = filter ? books.filter((b) => matches(b, filter)) : [...books];
  const cmp = comparator(o.sort ?? "title");
  const sorted = (o.order ?? "asc") === "desc" ? found.sort((a, b) => cmp(b, a)) : found.sort(cmp);
  const offset = o.offset ?? 0;
  return { all: sorted, page: sorted.slice(offset, offset + (o.num ?? 50)) };
}

const categoryCache = new Map<string, CategoryItem[]>();

function categoryItems(name: Category): CategoryItem[] {
  const cached = categoryCache.get(name);
  if (cached) return cached;
  const counts = new Map<string, { count: number; rated: number; sum: number }>();
  const add = (k: string, b: Book) => {
    const c = counts.get(k) ?? { count: 0, rated: 0, sum: 0 };
    c.count++;
    if (b.rating) {
      c.rated++;
      c.sum += b.rating;
    }
    counts.set(k, c);
  };
  for (const b of books) {
    switch (name) {
      case "authors": b.authors.forEach((a) => add(a, b)); break;
      case "tags": b.tags.forEach((t) => add(t, b)); break;
      case "series": if (b.series) add(b.series, b); break;
      case "publisher": if (b.publisher) add(b.publisher, b); break;
      case "languages": b.languages.forEach((l) => add(languageName(l), b)); break;
      case "rating": if (b.rating) add("★".repeat(Math.round(b.rating)), b); break;
    }
  }
  const items = [...counts].map(([n, c]) => ({ name: n, count: c.count, average_rating: c.rated ? c.sum / c.rated : 0, url: "", has_children: false }));
  categoryCache.set(name, items);
  return items;
}

export const api = {
  search: async (filter: Filter | undefined, o: SearchOpts = {}): Promise<SearchResult> => {
    await ready();
    const { all, page } = run(filter, o);
    return { total_num: all.length, offset: o.offset ?? 0, num: page.length, book_ids: page.map((b) => b.application_id) };
  },

  /** Metadata of several books, in the order of `ids` (missing ones are skipped). */
  books: async (ids: number[]): Promise<Book[]> => {
    await ready();
    return ids.map((id) => byId.get(id)).filter((b): b is Book => !!b);
  },

  book: async (id: number | string): Promise<Book> => {
    await ready();
    const b = byId.get(Number(id));
    if (!b) throw new ApiError(404, "There's no such book in the library.");
    return b;
  },

  /** One page of matching books. */
  list: async (filter: Filter | undefined, o: SearchOpts = {}): Promise<Page> => {
    await ready();
    const { all, page } = run(filter, o);
    return { items: page, total: all.length };
  },

  category: async (name: Category, o: { sort?: "name" | "popularity" | "rating"; order?: Order; num?: number } = {}): Promise<CategoryItem[]> => {
    await ready();
    const sort = o.sort ?? "name";
    const order = o.order ?? (sort === "name" ? "asc" : "desc");
    const cmp =
      sort === "popularity" ? (a: CategoryItem, b: CategoryItem) => a.count - b.count || collator.compare(b.name, a.name)
      : sort === "rating" ? (a: CategoryItem, b: CategoryItem) => a.average_rating - b.average_rating
      : (a: CategoryItem, b: CategoryItem) => collator.compare(a.name, b.name);
    const items = [...categoryItems(name)].sort((a, b) => (order === "desc" ? cmp(b, a) : cmp(a, b)));
    return items.slice(0, o.num ?? 10000);
  },

  categoryCached: (name: Category) => api.category(name),
};

/** The library's own split: comics and magazines have their own pages; everything else is "books"
 * (the home screen shows only those). */
export const COMICS = Q.eq("tags", "komix");
export const MAGAZINES = Q.eq("tags", "magazine");
export const BOOKS_ONLY = Q.and(Q.not(COMICS), Q.not(MAGAZINES));
const AUDIO_FORMATS = ["mp3", "m4b", "m4a"];
/** Books to read: no comics, magazines or audiobooks. */
export const TEXT_BOOKS = Q.and(BOOKS_ONLY, ...AUDIO_FORMATS.map((f) => Q.not(Q.has("formats", f))));
/** Audiobooks: any book with an audio file (comics and magazines aside). */
export const AUDIOBOOKS = Q.and(BOOKS_ONLY, Q.or(...AUDIO_FORMATS.map((f) => Q.has("formats", f))));
/** Marked finished in calibre's own "Finished" column. */
export const CALIBRE_FINISHED = Q.eq("#finished", "true");

// ------------------------------------------------------------------ URLs

/** Path segments, each percent-encoded (the folder and file names have spaces, commas, …). */
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
/** Changes when the book is edited in calibre: covers are cached for a year under this. */
const version = (b: Book) => (time(b.last_modified) / 1000).toString(36);

/** A cover `w` pixels wide (nginx scales and caches it; the height follows the cover). */
export function thumbUrl(id: number, w = 400, _h?: number): string | undefined {
  const b = byId.get(id);
  if (!b?.has_cover) return undefined;
  // A few fixed widths, so the cache holds few variants of each cover.
  const width = [120, 200, 300, 400, 600, 800, 1000].find((x) => x >= w) ?? 1000;
  return `/covers/${width}/${enc(b.path)}?v=${version(b)}`;
}
export const coverUrl = (id: number) => thumbUrl(id, 800);
/** The book file; `inline` makes the browser show it (PDF viewer, audio) instead of saving it. */
export function fileUrl(id: number, fmt: string, inline = false): string {
  const b = byId.get(id);
  const name = b?.files[fmt];
  if (!b || !name) return "#";
  return `/files/${enc(b.path)}/${enc(name)}` + (inline ? "?inline=1" : "");
}
/** A download link: through the state service, which counts it for the signed-in user and redirects
 * to the file. */
export const downloadUrl = (id: number, fmt: string, title?: string) =>
  `/state/download?to=${encodeURIComponent(fileUrl(id, fmt))}&id=${id}` + (title ? `&title=${encodeURIComponent(title)}` : "");

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
export const isAudiobook = (b: Book) => ["mp3", "m4b", "m4a"].some((f) => hasFormat(b, f));

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
