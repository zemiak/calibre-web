import { useState } from "react";
import { Link } from "react-router-dom";
import { api, authorsLine, bookById, bookPath, isAudiobook, isFinished, Q, seriesPath, thumbUrl, type Book, type CategoryItem } from "../api";
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

export const StarIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="currentColor" d="m12 2.5 2.9 6.06 6.6.8-4.87 4.56 1.25 6.58L12 17.3l-5.88 3.2 1.25-6.58L2.5 9.36l6.6-.8L12 2.5Z" />
  </svg>
);
export const HeartIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21Z" />
  </svg>
);

/** What a cover shows about the book in the top corner: on the wishlist (★), a favorite (♥),
 * unread (●: neither calibre's Finished column nor the user's own mark, set on the book page, says
 * it's finished), an audiobook (♪, which gets no unread mark, like on the Unread page). */
export function CoverBadges({ id, book = bookById(id) }: { id: number; book?: Book }) {
  const mark = progress.get(id);
  const audio = !!book && isAudiobook(book);
  const unread = !!book && !audio && !isFinished(book) && !mark?.finished;
  if (!mark?.wish && !mark?.fav && !unread && !audio) return null;
  return (
    <div className="cover-badges">
      {mark?.wish ? <span className="badge badge-wish" title="On the wishlist"><StarIcon size={14} /></span> : null}
      {mark?.fav ? <span className="badge badge-fav" title="Favorite"><HeartIcon size={14} /></span> : null}
      {unread && <span className="badge badge-unread" title="Unread"><i /></span>}
      {audio && <span className="badge badge-audio" title="Audiobook">♪</span>}
    </div>
  );
}

/** A cover card: the badges above, and a progress bar when the book is being read. */
export function BookCard({ book, sub }: { book: Book; sub?: string }) {
  const id = book.application_id;
  const mark = progress.get(id);
  const done = isFinished(book) || mark?.finished;
  return (
    <Link to={bookPath(book)} className="card poster-card">
      <div className="art poster">
        <Img src={thumbUrl(id)} alt={book.title} fallback={book.title} />
        <CoverBadges id={id} book={book} />
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
