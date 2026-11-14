import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api, authorPath, authorsLine, BOOKS_ONLY, bookPath, formatDate, TEXT_BOOKS, hasFormat, Q, seriesLabel, seriesPath, shuffle, stripHtml, tagPath, thumbUrl, year,
  type Book, type CategoryItem,
} from "../api";
import { BookCard, SeriesCard, Stars } from "../components/Card";
import { Shelf } from "../components/Shelf";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle } from "../hooks";
import { progress } from "../progress";

interface HomeData {
  featured: Book[];
  unread: Book[];
  newest: Book[];
  reading: Book[];
  recent: Book[];
  series: CategoryItem[];
  tagShelves: { tag: string; items: Book[] }[];
  audiobooks: Book[];
  random: Book[];
}

const newSub = (b: Book) => [formatDate(b.pubdate), b.authors.join(", ")].filter(Boolean).join(" · ");

/** Home shows books only: comics and magazines have their own pages in the nav bar. */
const only = (q?: string) => Q.and(BOOKS_ONLY, q);

async function loadHome(): Promise<HomeData> {
  // Every book id, newest first: the shelves below are slices of it (there's no random sort server-side).
  const all = await api.search(only(), { num: 100000, sort: "timestamp", order: "desc" });
  const ids = all.book_ids;
  const randomIds = shuffle(ids.slice(24)).slice(0, 48);
  // Unread (no audiobooks): neither marked finished by this user nor in calibre's own "Finished" column; newest first.
  const notInCalibre = await api.search(Q.and(TEXT_BOOKS, "not #finished:true"), { num: 100000, sort: "timestamp", order: "desc" })
    .then((r) => r.book_ids)
    .catch(() => api.search(TEXT_BOOKS, { num: 100000, sort: "timestamp", order: "desc" }).then((r) => r.book_ids)); // a library without that column
  const unreadIds = notInCalibre.filter((id) => !progress.get(id)?.finished).slice(0, 30);
  const [unread, newest, recent, random, tags, seriesCandidates, reading, audiobooks] = await Promise.all([
    api.books(unreadIds),
    // New: by publication date, books to read only (no audiobooks either).
    api.list(TEXT_BOOKS, { num: 24, sort: "pubdate", order: "desc" }).then((r) => r.items),
    api.books(ids.slice(0, 24)),
    api.books(randomIds),
    api.category("tags", { sort: "popularity" }),
    api.category("series", { sort: "popularity", num: 40 }),
    api.books(progress.list().slice(0, 20).map((p) => p.id)),
    api.list(only(Q.has("formats", "mp3")), { num: 24, sort: "timestamp", order: "desc" }).then((r) => r.items),
  ]);
  // The hero: random books that have a description; filled up with others if there are too few.
  const withText = random.filter((b) => stripHtml(b.comments).length > 80);
  const featured = [...withText, ...random.filter((b) => !withText.includes(b))].slice(0, 6);
  // Series and tag shelves: only those that still have books once comics and magazines are left out.
  const series = (
    await Promise.all(
      seriesCandidates.map(async (s) => {
        const n = (await api.search(only(Q.eq("series", s.name)), { num: 1 })).total_num;
        return n ? { ...s, count: n } : undefined;
      }),
    )
  ).filter((s): s is CategoryItem => !!s).slice(0, 14);
  const candidates = tags.filter((t) => t.count >= 8 && t.name !== "komix" && t.name !== "magazine").slice(0, 10);
  const tagShelves = (
    await Promise.all(
      candidates.map(async (t) => ({
        tag: t.name,
        items: (await api.list(only(Q.eq("tags", t.name)), { num: 24, sort: "timestamp", order: "desc" })).items,
      })),
    )
  ).filter((s) => s.items.length >= 4).slice(0, 4);
  return { featured, unread, newest, reading, recent, series, tagShelves, audiobooks, random: random.slice(0, 24) };
}

const ROTATE_MS = 9000;
const PAUSE_AFTER_TOUCH_MS = 20000;

/** The featured books: a horizontal snap scroller (swipe, trackpad, the dots or the arrows), which
 * also advances on its own until the user takes over. */
function Hero({ items }: { items: Book[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const pausedUntil = useRef(0);

  const go = (n: number, smooth = true) => {
    const el = track.current;
    if (!el || !items.length) return;
    const idx = ((n % items.length) + items.length) % items.length;
    el.scrollTo({ left: idx * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };
  const userTouched = () => void (pausedUntil.current = Date.now() + PAUSE_AFTER_TOUCH_MS);

  // The current slide follows the scroll position (one slide per viewport width).
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [items.length]);

  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current || document.hidden) return;
      const el = track.current;
      if (!el) return;
      go(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) + 1);
    }, ROTATE_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (!items.length) return <div className="hero hero-empty" />;
  return (
    <section className="hero">
      <div className="hero-track" ref={track} onPointerDown={userTouched} onTouchStart={userTouched} onWheel={userTouched}>
        {items.map((b) => {
          const id = b.application_id;
          const y = year(b.pubdate);
          return (
            <article className="hero-slide" key={id}>
              <div className="hero-bg" style={{ backgroundImage: `url("${thumbUrl(id, 600, 900)}")` }} />
              <Link to={bookPath(b)} className="hero-art" style={{ backgroundImage: `url("${thumbUrl(id, 1000, 1500)}")` }} aria-label={b.title} />
              <div className="hero-shade" />
              <div className="hero-content">
                <div className="hero-text">
                  <h1>{b.title}</h1>
                  <div className="meta-line">
                    <span>
                      {b.authors.map((a, n) => (
                        <span key={a}>
                          {n > 0 && ", "}
                          <Link to={authorPath(a)}>{a}</Link>
                        </span>
                      ))}
                    </span>
                    {y && <span>{y}</span>}
                    {b.series && <Link to={seriesPath(b.series)}>{seriesLabel(b)}</Link>}
                    <Stars n={b.rating} />
                  </div>
                  {b.tags.length > 0 && (
                    <div className="genres">
                      {b.tags.slice(0, 4).map((t) => <Link key={t} to={tagPath(t)}>{t}</Link>)}
                    </div>
                  )}
                  <p className="hero-overview">{stripHtml(b.comments)}</p>
                  <div className="actions">
                    {hasFormat(b, "epub") && <Link className="btn btn-primary" to={`/read/${id}`}>Read</Link>}
                    <Link className="btn" to={bookPath(b)}>Details</Link>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {items.length > 1 && (
        <div className="hero-nav">
          <button className="hero-arrow" onClick={() => { userTouched(); go(i - 1); }} aria-label="Previous">‹</button>
          <div className="hero-dots">
            {items.map((x, n) => (
              <button key={x.application_id} className={n === i ? "active" : ""} onClick={() => { userTouched(); go(n); }} aria-label={x.title} />
            ))}
          </div>
          <button className="hero-arrow" onClick={() => { userTouched(); go(i + 1); }} aria-label="Next">›</button>
        </div>
      )}
    </section>
  );
}

export function Home() {
  useDocumentTitle();
  const { data, error, loading, reload } = useAsync(loadHome, []);
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  return (
    <div className="home">
      <Hero items={data.featured} />
      <div className="shelves">
        {data.unread.length > 0 && (
          <Shelf title="Unread" more="/unread">
            {data.unread.map((b) => <BookCard key={b.application_id} book={b} />)}
          </Shelf>
        )}
        {data.newest.length > 0 && (
          <Shelf title="New" more="/new">
            {data.newest.map((b) => <BookCard key={b.application_id} book={b} sub={newSub(b)} />)}
          </Shelf>
        )}
        {data.reading.length > 0 && (
          <Shelf title="Continue Reading">
            {data.reading.map((b) => {
              const p = progress.get(b.application_id);
              return <BookCard key={b.application_id} book={b} sub={p ? `${Math.round(p.pct)}% · ${authorsLine(b)}` : undefined} />;
            })}
          </Shelf>
        )}
        <Shelf title="Recently Added" more="/books?sort=timestamp">
          {data.recent.map((b) => <BookCard key={b.application_id} book={b} />)}
        </Shelf>
        {data.series.length > 0 && (
          <Shelf title="Series" more="/series">
            {data.series.map((s) => <SeriesCard key={s.name} series={s} />)}
          </Shelf>
        )}
        {data.tagShelves.map(({ tag, items }) =>
          items.length ? (
            <Shelf key={tag} title={tag} more={tagPath(tag)}>
              {items.map((b) => <BookCard key={b.application_id} book={b} />)}
            </Shelf>
          ) : null,
        )}
        {data.audiobooks.length > 0 && (
          <Shelf title="Audiobooks" more="/books?format=mp3&sort=timestamp">
            {data.audiobooks.map((b) => <BookCard key={b.application_id} book={b} />)}
          </Shelf>
        )}
        {data.random.length > 0 && (
          <Shelf title="Something to Read">
            {data.random.map((b) => <BookCard key={b.application_id} book={b} />)}
          </Shelf>
        )}
      </div>
    </div>
  );
}
