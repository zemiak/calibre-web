import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
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

const LONG_PRESS_MS = 600;
const MOVE_TOLERANCE = 10;

/** A cover card: progress bar when the book is being read, a tick when it's finished (calibre's
 * column or the user's own mark). A long press on the cover toggles the user's mark. */
export function BookCard({ book, sub }: { book: Book; sub?: string }) {
  const id = book.application_id;
  const [mark, setMark] = useState(() => progress.get(id));
  const [toast, setToast] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number }>(undefined);
  const fired = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    cancel();
    timer.current = setTimeout(() => {
      fired.current = true;
      const next = !progress.get(id)?.finished;
      progress.setFinished(id, next, { title: book.title, authors: book.authors });
      setMark(progress.get(id));
      setToast(next ? "Finished" : "Not finished");
      navigator.vibrate?.(30);
      setTimeout(() => setToast(undefined), 1300);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: RPointerEvent) => {
    const s = start.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
  };

  const done = isFinished(book) || mark?.finished;
  return (
    <Link
      to={bookPath(book)}
      className="card poster-card"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      // After a long press the release must not open the book (nor show the image menu on touch).
      onClick={(e) => fired.current && e.preventDefault()}
      onContextMenu={(e) => (timer.current || fired.current) && e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="art poster">
        <Img src={thumbUrl(id)} alt={book.title} fallback={book.title} />
        {done && <span className="badge-done" title="Finished">✓</span>}
        {isAudiobook(book) && <span className="badge-audio" title="Audiobook">♪</span>}
        {mark && mark.pct > 0 && mark.pct < 100 && !done && (
          <div className="progress">
            <div style={{ width: `${mark.pct}%` }} />
          </div>
        )}
        {toast && <span className="card-toast">{toast}</span>}
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
