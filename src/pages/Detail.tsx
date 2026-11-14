import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api, authorPath, coverUrl, fileUrl, formatDate, formatIndex, formatSize, hasFormat, identifierUrl, isFinished, languageName,
  Q, seriesPath, tagPath, thumbUrl, year, type Book,
} from "../api";
import { BookCard, Stars } from "../components/Card";
import { Img } from "../components/Img";
import { Shelf } from "../components/Shelf";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle } from "../hooks";
import { progress } from "../progress";
import { sanitizeHtml } from "../sanitize";

export function Detail() {
  const { id = "" } = useParams();
  const { data: b, error, loading, reload } = useAsync(() => api.book(id), [id]);
  useDocumentTitle(b?.title);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (error && !b) return <ErrorState error={error} retry={reload} />;
  if (loading && (!b || String(b.application_id) !== id)) return <Spinner />;
  if (!b) return null;

  return (
    <div className="detail">
      <div className="detail-bg" style={{ backgroundImage: `url("${thumbUrl(b.application_id, 300, 450)}")` }} />
      <div className="detail-shade" />
      <div className="detail-body">
        <Header b={b} />
        {b.series && <Related title={`More in ${b.series}`} query={Q.eq("series", b.series)} sort="series" more={seriesPath(b.series)} exclude={b.application_id} sub={(x) => `#${formatIndex(x.series_index)}`} />}
        {b.authors.slice(0, 2).map((a) => (
          <Related key={a} title={`More by ${a}`} query={Q.eq("authors", a)} sort="pubdate" order="desc" more={authorPath(a)} exclude={b.application_id} />
        ))}
        <Info b={b} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ header

function Header({ b }: { b: Book }) {
  const id = b.application_id;
  const html = useMemo(() => (b.comments ? sanitizeHtml(b.comments) : ""), [b.comments]);
  const [mark, setMark] = useState(() => progress.get(id));
  const p = mark;
  const done = isFinished(b) || mark?.finished;
  const toggleFinished = () => {
    progress.setFinished(id, !mark?.finished, { title: b.title, authors: b.authors });
    setMark(progress.get(id));
  };
  const y = year(b.pubdate);
  const audio = b.formats.find((f) => f === "mp3" || f === "m4b" || f === "m4a");
  return (
    <header className="detail-header">
      <div className="detail-poster">
        <div className="art poster">
          <Img src={coverUrl(id)} alt={b.title} fallback={b.title} eager />
        </div>
      </div>
      <div className="detail-info">
        {b.series && (
          <Link to={seriesPath(b.series)} className="series-link">
            {b.series}{b.series_index !== null && <span className="muted"> · Book {formatIndex(b.series_index)}</span>}
          </Link>
        )}
        <h1>{b.title}</h1>
        <div className="authors">
          {b.authors.map((a, i) => (
            <span key={a}>
              {i > 0 && ", "}
              <Link to={authorPath(a)}>{a}</Link>
            </span>
          ))}
        </div>
        <div className="meta-line">
          {y && <span>{y}</span>}
          {b.publisher && <span>{b.publisher}</span>}
          {b.languages.length > 0 && <span>{b.languages.map(languageName).join(", ")}</span>}
          {b.pages ? <span>{b.pages} pages</span> : null}
          <Stars n={b.rating} />
          {done && <span className="cert">Finished</span>}
        </div>
        {b.formats.length > 0 && (
          <div className="badges">
            {b.formats.map((f) => <span key={f} className="tech">{f.toUpperCase()}</span>)}
          </div>
        )}
        {b.tags.length > 0 && (
          <div className="genres">
            {b.tags.map((t) => <Link key={t} to={tagPath(t)}>{t}</Link>)}
          </div>
        )}
        {html ? <div className="overview" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="overview muted">No description.</p>}

        <div className="actions">
          {hasFormat(b, "epub") && (
            <Link className="btn btn-primary" to={`/read/${id}`}>
              {p && p.pct > 0 && p.pct < 100 ? `Continue Reading · ${Math.round(p.pct)}%` : "Read"}
            </Link>
          )}
          <button className={`btn icon ${mark?.finished ? "on" : ""}`} onClick={toggleFinished}
            title={mark?.finished ? "Mark as not finished" : "Mark as finished"} aria-pressed={!!mark?.finished}>
            ✓
          </button>
          {hasFormat(b, "pdf") && (
            <a className="btn" href={fileUrl(id, "pdf", true)} target="_blank" rel="noreferrer">Open PDF</a>
          )}
          {b.formats.map((f) => (
            <a key={f} className="btn" href={fileUrl(id, f)} title={`Download ${f.toUpperCase()}`} download>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3ZM4 19h16v2H4v-2Z" /></svg>
              {f.toUpperCase()}
              {b.format_metadata[f] && <span className="muted small">{formatSize(b.format_metadata[f].size)}</span>}
            </a>
          ))}
        </div>
        {p && p.pct > 0 && p.pct < 100 && !mark?.finished && (
          <div className="resume-bar">
            <div className="progress"><div style={{ width: `${p.pct}%` }} /></div>
            <span>{Math.round(p.pct)}% read</span>
          </div>
        )}
        {audio && (
          <div className="audio">
            <audio controls preload="none" src={fileUrl(id, audio, true)} />
          </div>
        )}
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ related shelves

function Related({ title, query, sort, order = "asc", more, exclude, sub }: {
  title: string;
  query: string;
  sort: "series" | "pubdate" | "title";
  order?: "asc" | "desc";
  more: string;
  exclude: number;
  sub?: (b: Book) => string | undefined;
}) {
  const res = useAsync(() => api.list(query, { num: 40, sort, order }), [query, sort, order]);
  const items = (res.data?.items ?? []).filter((x) => x.application_id !== exclude);
  if (!items.length) return null;
  return (
    <Shelf title={title} more={more}>
      {items.map((x) => <BookCard key={x.application_id} book={x} sub={sub?.(x)} />)}
    </Shelf>
  );
}

// ------------------------------------------------------------------ information

function Info({ b }: { b: Book }) {
  const rows: [string, ReactNode][] = [];
  if (b.authors.length > 1 || (b.authors[0] && b.author_sort_map[b.authors[0]] !== b.author_sort)) rows.push(["Author sort", b.author_sort]);
  const pub = formatDate(b.pubdate);
  if (pub) rows.push(["Published", pub]);
  rows.push(["Added", formatDate(b.timestamp) || "—"]);
  if (b.publisher) rows.push(["Publisher", b.publisher]);
  if (b.languages.length) rows.push(["Languages", b.languages.map(languageName).join(", ")]);
  const ids = Object.entries(b.identifiers ?? {});
  if (ids.length)
    rows.push([
      "Identifiers",
      <span className="links">
        {ids.map(([k, v]) => {
          const url = identifierUrl(k, v);
          const label = `${k}: ${v}`;
          return url ? <a key={k} href={url} target="_blank" rel="noreferrer">{label}</a> : <span key={k}>{label}</span>;
        })}
      </span>,
    ]);
  for (const f of Object.values(b.user_metadata ?? {})) {
    const v = f["#value#"];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    rows.push([f.name, f.datatype === "bool" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v)]);
  }
  const files = Object.entries(b.format_metadata ?? {});
  if (files.length)
    rows.push([
      "Files",
      <span className="file-list">
        {files.map(([f, m]) => <span key={f}>{f.toUpperCase()} · {formatSize(m.size)}</span>)}
      </span>,
    ]);
  rows.push(["calibre id", String(b.application_id)]);
  return (
    <section className="info">
      <h2>Information</h2>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}
