import { useState } from "react";
import { Link } from "react-router-dom";
import { api, authorsLine, bookPath, isAudiobook, isFinished, Q, seriesPath, thumbUrl, type Book, type CategoryItem } from "../api";
import { useInView } from "../hooks";
import { progress } from "../progress";
import { Img } from "./Img";

export function Stars({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={`stars ${className ?? ""}`} title={`${n} of 5`} aria-label={`${n} of 5 stars`}>
      {"★".repeat(Math.round(n))}
      <span className="dim">{"★".repeat(5 - Math.round(n))}</span>
    </span>
  );
}

/** A cover card: progress bar when the book is being read, a tick when it's finished (calibre's
 * column or the user's own mark, set on the book page). */
export function BookCard({ book, sub }: { book: Book; sub?: string }) {
  const id = book.application_id;
  const mark = progress.get(id);
  const done = isFinished(book) || mark?.finished;
  return (
    <Link to={bookPath(book)} className="card poster-card">
      <div className="art poster">
        <Img src={thumbUrl(id)} alt={book.title} fallback={book.title} />
        {done && <span className="badge-done" title="Finished">✓</span>}
        {isAudiobook(book) && <span className="badge-audio" title="Audiobook">♪</span>}
        {mark && mark.pct > 0 && mark.pct < 100 && !done && (
          <div className="progress">
            <div style={{ width: `${mark.pct}%` }} />
          </div>
        )}
      </div>
      <div className="card-title">{book.title}</div>
      <div className="card-sub">{sub ?? authorsLine(book)}</div>
    </Link>
  );
}
/** A series: a small stack of its first covers, loaded when the card scrolls into view. */
export function SeriesCard({ series }: { series: CategoryItem }) {
  const [books, setBooks] = useState<Book[]>();
  const ref = useInView<HTMLAnchorElement>(
    () => {
      api
        .list(Q.eq("series", series.name), { num: 3, sort: "series" })
        .then((r) => setBooks(r.items))
        .catch(() => setBooks([]));
    },
    books === undefined,
    "400px",
  );
  const covers = books ?? [];
  return (
    <Link ref={ref} to={seriesPath(series.name)} className="card series-card">
      <div className="stack">
        {covers.length ? (
          [...covers].reverse().map((b, i) => (
            <div key={b.application_id} className="art poster" style={{ "--i": covers.length - 1 - i } as React.CSSProperties}>
              <Img src={thumbUrl(b.application_id, 300, 450)} alt={b.title} fallback={b.title} />
            </div>
          ))
        ) : (
          <div className="art poster" style={{ "--i": 0 } as React.CSSProperties}>
            <Img alt={series.name} fallback={series.name} />
          </div>
        )}
      </div>
      <div className="card-title">{series.name}</div>
      <div className="card-sub">{series.count} {series.count === 1 ? "book" : "books"}</div>
    </Link>
  );
}
