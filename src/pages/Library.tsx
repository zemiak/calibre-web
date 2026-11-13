import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, formatIndex, Q, type Book, type Order, type SortKey } from "../api";
import { BookCard } from "../components/Card";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle, useInView } from "../hooks";

const SORTS: { key: SortKey; label: string; order: Order }[] = [
  { key: "title", label: "Title", order: "asc" },
  { key: "authors", label: "Author", order: "asc" },
  { key: "timestamp", label: "Date Added", order: "desc" },
  { key: "pubdate", label: "Published", order: "desc" },
  { key: "series", label: "Series", order: "asc" },
  { key: "rating", label: "Rating", order: "desc" },
  { key: "size", label: "Size", order: "desc" },
];

const FORMATS = ["epub", "pdf", "mobi", "azw3", "cbz", "mp3"];

const PAGE = 96;

interface Props {
  title: string;
  /** A fixed calibre search expression (author / series / tag pages). */
  base?: string;
  defaultSort?: SortKey;
  /** The second line of a card (default: the authors). */
  sub?: (b: Book) => string | undefined;
  /** Shown under the title. */
  intro?: ReactNode;
}

/** A cover grid with sort, tag, format and language filters, and infinite scrolling. */
export function LibraryGrid({ title, base, defaultSort = "title", sub, intro }: Props) {
  const [sp, setSp] = useSearchParams();
  const sortKey = sp.get("sort") ?? defaultSort;
  const sort = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];
  const tags = sp.getAll("tag");
  const format = sp.get("format") ?? "";
  const lang = sp.get("lang") ?? "";
  useDocumentTitle(title);

  const allTags = useAsync(() => api.categoryCached("tags"), []);
  const langs = useAsync(() => api.categoryCached("languages"), []);

  const query = Q.and(
    base,
    ...tags.map((t) => Q.eq("tags", t)),
    format && Q.has("formats", format),
    lang && Q.eq("languages", lang),
  );
  const key = `${query}|${sort.key}|${sort.order}`;

  const [items, setItems] = useState<Book[]>([]);
  const [total, setTotal] = useState<number>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setItems([]);
    setTotal(undefined);
    setError(undefined);
    setBusy(true);
    api
      .list(query, { offset: 0, num: PAGE, sort: sort.key, order: sort.order })
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const more = useCallback(() => {
    if (busy || total === undefined || items.length >= total) return;
    setBusy(true);
    api
      .list(query, { offset: items.length, num: PAGE, sort: sort.key, order: sort.order })
      .then((r) => setItems((xs) => [...xs, ...r.items]))
      .catch(setError)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, total, items.length, key]);
  const sentinel = useInView<HTMLDivElement>(more, total !== undefined && items.length < total);

  const update = (f: (n: URLSearchParams) => void) => {
    const n = new URLSearchParams(sp);
    f(n);
    setSp(n, { replace: true });
  };
  const set = (k: string, v: string, def: string) => update((n) => (v === def ? n.delete(k) : n.set(k, v)));
  const addTag = (t: string) => t && !tags.includes(t) && update((n) => n.append("tag", t));
  const removeTag = (t: string) => update((n) => { const rest = tags.filter((x) => x !== t); n.delete("tag"); rest.forEach((x) => n.append("tag", x)); });

  const subtitle = (b: Book) => {
    if (sub) return sub(b);
    if (sort.key === "rating" && b.rating) return `${"★".repeat(Math.round(b.rating))} · ${b.authors.join(", ")}`;
    if (sort.key === "series" && b.series) return `${b.series} #${formatIndex(b.series_index)}`;
    return undefined;
  };

  const tagOptions = (allTags.data ?? []).filter((t) => !tags.includes(t.name));

  return (
    <div className="page library">
      <header className="page-header">
        <div>
          <h1>
            {title}
            {total !== undefined && <span className="count">{total}</span>}
          </h1>
          {intro}
        </div>
        <div className="toolbar">
          {tagOptions.length > 0 && (
            <select value="" onChange={(e) => addTag(e.target.value)} aria-label="Filter by tag">
              <option value="">{tags.length ? "Add a tag…" : "All Tags"}</option>
              {tagOptions.map((t) => (
                <option key={t.name} value={t.name}>{t.name} ({t.count})</option>
              ))}
            </select>
          )}
          <select value={format} onChange={(e) => set("format", e.target.value, "")} aria-label="Format">
            <option value="">All Formats</option>
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
          {langs.data && langs.data.length > 1 && (
            <select value={lang} onChange={(e) => set("lang", e.target.value, "")} aria-label="Language">
              <option value="">All Languages</option>
              {langs.data.map((l) => <option key={l.name} value={l.name}>{l.name} ({l.count})</option>)}
            </select>
          )}
          <select value={sort.key} onChange={(e) => set("sort", e.target.value, defaultSort)} aria-label="Sort">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </header>
      {tags.length > 0 && (
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className="chip on" onClick={() => removeTag(t)} title="Remove this filter">
              {t} <span className="x">×</span>
            </button>
          ))}
          {tags.length > 1 && <span className="muted small">all of these</span>}
        </div>
      )}
      {error && <ErrorState error={error} />}
      <div className="grid">
        {items.map((b) => <BookCard key={b.application_id} book={b} sub={subtitle(b)} />)}
      </div>
      {total === 0 && !busy && <p className="muted center-state">Nothing here.</p>}
      {busy && <Spinner />}
      <div ref={sentinel} />
    </div>
  );
}

export function Library() {
  return <LibraryGrid title="Library" />;
}

export function TagPage() {
  const { name = "" } = useParams();
  return <LibraryGrid key={name} title={name} base={Q.eq("tags", name)} defaultSort="timestamp" intro={<p className="intro muted">Tag · <Link to="/tags">all tags</Link></p>} />;
}

export function AuthorPage() {
  const { name = "" } = useParams();
  return <LibraryGrid key={name} title={name} base={Q.eq("authors", name)} defaultSort="series" intro={<p className="intro muted">Author · <Link to="/authors">all authors</Link></p>} />;
}

export function SeriesPage() {
  const { name = "" } = useParams();
  return (
    <LibraryGrid
      key={name}
      title={name}
      base={Q.eq("series", name)}
      defaultSort="series"
      sub={(b) => (b.series_index !== null ? `#${formatIndex(b.series_index)} · ${b.authors.join(", ")}` : undefined)}
      intro={<p className="intro muted">Series · <Link to="/series">all series</Link></p>}
    />
  );
}
