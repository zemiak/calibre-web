// The calibre library, read straight from its metadata.db (read-only) and kept in memory.
//
// calibre-server answers single requests quickly but needs many of them per page, each with a
// database round-trip and JSON building in Python on a small CPU allowance. This reads the whole
// library once (a few thousand books are ~1 MB of JSON), hands it to the browser in one compressed
// response, and reloads it when metadata.db changes. The app then filters, sorts and searches in
// memory. Books come out in the shape of calibre's own /ajax/book, so the app's types still fit,
// plus `path` and `files` (where cover.jpg and the book files are on disk).
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

const DIR = process.env.LIBRARY_DIR ?? "/library";
const DB = join(DIR, "metadata.db");
const POLL_MS = Number(process.env.LIBRARY_POLL_MS ?? 15000);

/** calibre's "2026-11-10 07:41:35.840021+00:00" as ISO 8601; its "no date" (year 101) stays as is. */
const iso = (s) => (s ? String(s).replace(" ", "T").replace(/\.\d+(?=[+-]\d\d:\d\d$)/, "") : null);

function read() {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const all = (sql) => db.prepare(sql).all();
    /** Rows of (book, value) into book → value[] (in row order). */
    const group = (rows, value = (r) => r.v) => {
      const m = new Map();
      for (const r of rows) {
        const xs = m.get(r.book);
        if (xs) xs.push(value(r));
        else m.set(r.book, [value(r)]);
      }
      return m;
    };
    const authors = all("select l.book, a.name v, a.sort s from books_authors_link l join authors a on a.id = l.author order by l.id");
    const authorsBy = group(authors, (r) => ({ name: r.v, sort: r.s }));
    const tagsBy = group(all("select l.book, t.name v from books_tags_link l join tags t on t.id = l.tag order by t.name collate nocase"));
    const seriesBy = new Map(all("select l.book, s.name v from books_series_link l join series s on s.id = l.series").map((r) => [r.book, r.v]));
    const publisherBy = new Map(all("select l.book, p.name v from books_publishers_link l join publishers p on p.id = l.publisher").map((r) => [r.book, r.v]));
    const ratingBy = new Map(all("select l.book, r.rating v from books_ratings_link l join ratings r on r.id = l.rating").map((r) => [r.book, (r.v ?? 0) / 2]));
    const langsBy = group(all("select l.book, g.lang_code v from books_languages_link l join languages g on g.id = l.lang_code order by l.item_order"));
    const commentsBy = new Map(all("select book, text v from comments").map((r) => [r.book, r.v]));
    const idsBy = group(all("select book, type, val from identifiers"), (r) => [r.type, r.val]);
    const dataBy = group(all("select book, format, uncompressed_size size, name from data"), (r) => r);
    let pagesBy = new Map();
    try {
      pagesBy = new Map(all("select book, pages v from books_pages_link where pages > 0").map((r) => [r.book, r.v]));
    } catch {
      // older calibre: no page counts
    }

    // Custom columns: plain ones (one value per book in custom_column_N) and normalized ones
    // (values in custom_column_N, linked by books_custom_column_N_link).
    const customs = [];
    for (const c of all("select id, label, name, datatype, is_multiple, normalized from custom_columns where mark_for_delete = 0")) {
      let values;
      try {
        values = c.normalized
          ? group(all(`select l.book, v.value v from books_custom_column_${c.id}_link l join custom_column_${c.id} v on v.id = l.value`))
          : new Map(all(`select book, value v from custom_column_${c.id}`).map((r) => [r.book, [r.v]]));
      } catch {
        continue;
      }
      customs.push({ c, values });
    }

    const books = [];
    for (const b of all("select id, title, sort, timestamp, pubdate, series_index, author_sort, path, uuid, has_cover, last_modified from books order by id")) {
      const as = authorsBy.get(b.id) ?? [];
      const data = dataBy.get(b.id) ?? [];
      const series = seriesBy.get(b.id) ?? null;
      const user_metadata = {};
      for (const { c, values } of customs) {
        const v = values.get(b.id);
        let value = v ? (c.is_multiple ? v : v[0]) : null;
        if (c.datatype === "bool" && value !== null) value = !!value;
        if (c.datatype === "rating" && typeof value === "number") value = value / 2;
        user_metadata["#" + c.label] = { name: c.name, datatype: c.datatype, is_category: !!c.normalized, is_multiple: c.is_multiple ? {} : null, "#value#": value };
      }
      books.push({
        application_id: b.id,
        uuid: b.uuid,
        title: b.title,
        title_sort: b.sort ?? b.title,
        authors: as.map((a) => a.name),
        author_sort: b.author_sort ?? "",
        author_sort_map: Object.fromEntries(as.map((a) => [a.name, a.sort])),
        tags: tagsBy.get(b.id) ?? [],
        series,
        series_index: series ? b.series_index : null,
        rating: ratingBy.get(b.id) ?? 0,
        comments: commentsBy.get(b.id) ?? null,
        publisher: publisherBy.get(b.id) ?? null,
        pubdate: iso(b.pubdate),
        timestamp: iso(b.timestamp),
        last_modified: iso(b.last_modified),
        languages: langsBy.get(b.id) ?? [],
        identifiers: Object.fromEntries(idsBy.get(b.id) ?? []),
        formats: data.map((d) => d.format.toLowerCase()),
        format_metadata: Object.fromEntries(data.map((d) => [d.format.toLowerCase(), { size: d.size ?? 0 }])),
        pages: pagesBy.get(b.id) ?? null,
        user_metadata,
        // Not in calibre's JSON: where the files are, for /covers/ and /files/.
        path: b.path,
        has_cover: !!b.has_cover,
        files: Object.fromEntries(data.map((d) => [d.format.toLowerCase(), `${d.name}.${d.format.toLowerCase()}`])),
      });
    }
    return books;
  } finally {
    db.close();
  }
}

/** @type {{ json: Buffer, gzip: Buffer, etag: string, count: number, loadedAt: number, mtimeMs: number } | undefined} */
let current;
let loading;

async function load(reason) {
  const st = await stat(DB);
  const t0 = Date.now();
  let books;
  // calibre may be writing (it locks the database briefly): try again a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      books = read();
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const json = Buffer.from(JSON.stringify({ library: "books", loadedAt: new Date().toISOString(), books }));
  const etag = `"${createHash("sha1").update(json).digest("base64url").slice(0, 20)}"`;
  current = { json, gzip: gzipSync(json, { level: 9 }), etag, count: books.length, loadedAt: Date.now(), mtimeMs: st.mtimeMs };
  console.log(`${new Date().toISOString()} library (${reason}): ${books.length} books, ${Math.round(json.length / 1024)} kB (${Math.round(current.gzip.length / 1024)} kB gzipped), ${Date.now() - t0} ms`);
}

/** Loads once, then watches metadata.db's modification time. */
export function startLibrary() {
  loading = load("start").catch((e) => {
    console.error(new Date().toISOString(), "library: can't read", DB, e.message);
  });
  let lastSeen;
  setInterval(async () => {
    try {
      const { mtimeMs } = await stat(DB);
      // Not loaded yet (no metadata.db at start, or unreadable): try again now that it's there.
      if (!current) return await load("appeared");
      if (mtimeMs === current.mtimeMs) return;
      // Wait until calibre is done writing: the same mtime on two polls in a row.
      if (lastSeen !== mtimeMs) {
        lastSeen = mtimeMs;
        return;
      }
      await load("changed");
    } catch (e) {
      // A missing file is already reported at start; don't repeat it every poll.
      if (e.code !== "ENOENT") console.error(new Date().toISOString(), "library: reload failed:", e.message);
    }
  }, POLL_MS).unref();
}

/** GET /state/library: the whole library, gzipped when the client accepts it, with an ETag. */
export async function serveLibrary(req, res) {
  await loading;
  if (!current) {
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "10" });
    return res.end(JSON.stringify({ error: "the library isn't loaded (see the state container's log)" }));
  }
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    // Revalidated on every app start: a 304 when nothing changed.
    "Cache-Control": "no-cache",
    ETag: current.etag,
    Vary: "Accept-Encoding",
  };
  if (req.headers["if-none-match"] === current.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const gz = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  const body = gz ? current.gzip : current.json;
  res.writeHead(200, { ...headers, ...(gz ? { "Content-Encoding": "gzip" } : {}), "Content-Length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
}

export const libraryStatus = () => (current ? { books: current.count, loadedAt: new Date(current.loadedAt).toISOString(), kB: Math.round(current.gzip.length / 1024) } : null);
