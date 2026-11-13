import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api, authorPath, authorsLine, bookPath, hasFormat, Q, seriesLabel, seriesPath, shuffle, stripHtml, tagPath, thumbUrl, year,
  type Book, type CategoryItem,
} from "../api";
import { BookCard, SeriesCard, Stars } from "../components/Card";
import { Shelf } from "../components/Shelf";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle } from "../hooks";
import { progress } from "../progress";

interface HomeData {
  featured: Book[];
  reading: Book[];
  recent: Book[];
  series: CategoryItem[];
  tagShelves: { tag: string; items: Book[] }[];
  audiobooks: Book[];
  random: Book[];
}

async function loadHome(): Promise<HomeData> {
  // Every book id, newest first: the shelves below are slices of it (there's no random sort server-side).
  const all = await api.search("", { num: 100000, sort: "timestamp", order: "desc" });
  const ids = all.book_ids;
  const randomIds = shuffle(ids.slice(24)).slice(0, 48);
  const [recent, random, tags, series, reading, audiobooks] = await Promise.all([
    api.books(ids.slice(0, 24)),
    api.books(randomIds),
    api.category("tags", { sort: "popularity" }),
    api.category("series", { sort: "popularity", num: 14 }),
    api.books(progress.list().slice(0, 20).map((p) => p.id)),
    api.list(Q.has("formats", "mp3"), { num: 24, sort: "timestamp", order: "desc" }).then((r) => r.items),
  ]);
  // The hero: random books that have a description; filled up with others if there are too few.
  const withText = random.filter((b) => stripHtml(b.comments).length > 80);
  const featured = [...withText, ...random.filter((b) => !withText.includes(b))].slice(0, 6);
  const topTags = tags.filter((t) => t.count >= 8).slice(0, 4);
  const tagShelves = await Promise.all(
    topTags.map(async (t) => ({
      tag: t.name,
      items: (await api.list(Q.eq("tags", t.name), { num: 24, sort: "timestamp", order: "desc" })).items,
    })),
  );
  return { featured, reading, recent, series, tagShelves, audiobooks, random: random.slice(0, 24) };
}

function Hero({ items }: { items: Book[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 9000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return <div className="hero hero-empty" />;
  const b = items[i];
  const id = b.application_id;
  const y = year(b.pubdate);
  return (
    <section className="hero">
      {items.map((x, n) => (
        <div
          key={x.application_id}
          className={`hero-bg ${n === i ? "active" : ""}`}
          style={{ backgroundImage: `url("${thumbUrl(x.application_id, 600, 900)}")` }}
        />
      ))}
      <div className="hero-shade" />
      <div className="hero-content" key={id}>
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
        <Link to={bookPath(b)} className="hero-cover">
          <div className="art poster">
            <img src={thumbUrl(id, 600, 900)} alt={b.title} className="loaded" />
          </div>
        </Link>
      </div>
      <div className="hero-dots">
        {items.map((x, n) => (
          <button key={x.application_id} className={n === i ? "active" : ""} onClick={() => setI(n)} aria-label={x.title} />
        ))}
      </div>
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
