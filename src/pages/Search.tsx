import { Link, useSearchParams } from "react-router-dom";
import { api, authorPath, Q, seriesPath, tagPath, type CategoryItem } from "../api";
import { BookCard } from "../components/Card";
import { Spinner } from "../components/States";
import { useAsync, useDebounced, useDocumentTitle } from "../hooks";
import { TagCloud } from "./Browse";

/** Full-text search over titles, authors, series, tags, descriptions and publishers (calibre's
 * search language does the matching), plus the authors, series and tags whose names match. */
export function Search() {
  const [sp] = useSearchParams();
  const q = useDebounced((sp.get("q") ?? "").trim(), 250);
  useDocumentTitle(q ? `Search: ${q}` : "Search");
  const books = useAsync(
    () => (q.length < 2 ? Promise.resolve(undefined) : api.list(Q.text(q), { num: 120, sort: "title" })),
    [q],
  );
  const cats = useAsync(
    () => Promise.all([api.categoryCached("authors"), api.categoryCached("series"), api.categoryCached("tags")]),
    [],
  );
  const match = (xs?: CategoryItem[]) => {
    if (!xs || q.length < 2) return [];
    const needle = q.toLocaleLowerCase();
    return xs.filter((x) => x.name.toLocaleLowerCase().includes(needle)).slice(0, 30);
  };
  const [authors, series, tags] = [match(cats.data?.[0]), match(cats.data?.[1]), match(cats.data?.[2])];
  const items = books.data?.items ?? [];
  const nothing = !items.length && !authors.length && !series.length && !tags.length;

  return (
    <div className="page search">
      {q.length < 2 ? (
        <section>
          <h2>Browse by Tag</h2>
          {cats.data ? <TagCloud tags={cats.data[2]} limit={60} /> : <Spinner />}
          <p className="muted browse-links">
            Or browse all <Link to="/authors">authors</Link>, <Link to="/series">series</Link> and <Link to="/tags">tags</Link>.
          </p>
        </section>
      ) : books.loading && !books.data ? (
        <Spinner />
      ) : nothing ? (
        <p className="muted center-state">No results for “{q}”.</p>
      ) : (
        <>
          <Matches title="Authors" items={authors} to={authorPath} />
          <Matches title="Series" items={series} to={seriesPath} />
          <Matches title="Tags" items={tags} to={tagPath} />
          {items.length > 0 && (
            <section>
              <h2>
                Books
                {books.data && books.data.total > items.length && <span className="count">first {items.length} of {books.data.total}</span>}
              </h2>
              <div className="grid">{items.map((b) => <BookCard key={b.application_id} book={b} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Matches({ title, items, to }: { title: string; items: CategoryItem[]; to: (name: string) => string }) {
  if (!items.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <div className="chips">
        {items.map((x) => (
          <Link key={x.name} to={to(x.name)} className="chip">
            {x.name} <span className="count">{x.count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
