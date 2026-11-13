import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, authorPath, tagPath, type CategoryItem } from "../api";
import { SeriesCard } from "../components/Card";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle } from "../hooks";

const byName = (a: CategoryItem, b: CategoryItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const byCount = (a: CategoryItem, b: CategoryItem) => b.count - a.count || byName(a, b);

function letterOf(name: string): string {
  const c = name.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(c) ? c.normalize("NFD").replace(/\p{M}/gu, "") : "#";
}

/** Authors, grouped by first letter, with a filter box. */
export function AuthorsIndex() {
  useDocumentTitle("Authors");
  const { data, error, reload } = useAsync(() => api.categoryCached("authors"), []);
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const f = filter.trim().toLocaleLowerCase();
    const list = (data ?? []).filter((a) => !f || a.name.toLocaleLowerCase().includes(f)).sort(byName);
    const g = new Map<string, CategoryItem[]>();
    for (const a of list) {
      const l = letterOf(a.name);
      g.set(l, [...(g.get(l) ?? []), a]);
    }
    return [...g.entries()];
  }, [data, filter]);

  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="page browse">
      <header className="page-header">
        <h1>Authors<span className="count">{data.length}</span></h1>
        <div className="toolbar">
          <label className="search-box inline">
            <input type="search" placeholder="Filter authors" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
      </header>
      {groups.length === 0 && <p className="muted center-state">No authors match.</p>}
      {groups.length > 3 && (
        <div className="letters">
          {groups.map(([l]) => <a key={l} href={`#authors-${l}`}>{l}</a>)}
        </div>
      )}
      {groups.map(([letter, authors]) => (
        <section key={letter} className="letter-group" id={`authors-${letter}`}>
          <h2>{letter}</h2>
          <div className="name-list">
            {authors.map((a) => (
              <Link key={a.name} to={authorPath(a.name)} className="name-item">
                <span>{a.name}</span>
                <span className="count">{a.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Series as cover stacks, by name or by size. */
export function SeriesIndex() {
  useDocumentTitle("Series");
  const { data, error, reload } = useAsync(() => api.categoryCached("series"), []);
  const [order, setOrder] = useState<"name" | "count">("name");
  const [filter, setFilter] = useState("");
  const list = useMemo(() => {
    const f = filter.trim().toLocaleLowerCase();
    return (data ?? []).filter((s) => !f || s.name.toLocaleLowerCase().includes(f)).sort(order === "name" ? byName : byCount);
  }, [data, order, filter]);
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="page browse">
      <header className="page-header">
        <h1>Series<span className="count">{data.length}</span></h1>
        <div className="toolbar">
          <label className="search-box inline">
            <input type="search" placeholder="Filter series" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="segmented">
            <button className={order === "name" ? "active" : ""} onClick={() => setOrder("name")}>Name</button>
            <button className={order === "count" ? "active" : ""} onClick={() => setOrder("count")}>Most Books</button>
          </div>
        </div>
      </header>
      {list.length === 0 && <p className="muted center-state">No series match.</p>}
      <div className="grid series-grid">
        {list.map((s) => <SeriesCard key={s.name} series={s} />)}
      </div>
    </div>
  );
}

/** A tag cloud, bigger for tags with more books. */
export function TagCloud({ tags, limit }: { tags: CategoryItem[]; limit?: number }) {
  const list = useMemo(() => {
    const xs = limit ? [...tags].sort(byCount).slice(0, limit) : [...tags];
    return xs.sort(byName);
  }, [tags, limit]);
  const max = Math.max(1, ...list.map((t) => Math.log(t.count + 1)));
  return (
    <div className="tag-cloud">
      {list.map((t) => {
        const w = Math.log(t.count + 1) / max; // 0..1
        return (
          <Link key={t.name} to={tagPath(t.name)} style={{ fontSize: `${13 + w * 15}px`, opacity: 0.6 + w * 0.4 }}>
            {t.name} <span className="count">{t.count}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function TagsIndex() {
  useDocumentTitle("Tags");
  const { data, error, reload } = useAsync(() => api.categoryCached("tags"), []);
  const [filter, setFilter] = useState("");
  if (error && !data) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Spinner />;
  const f = filter.trim().toLocaleLowerCase();
  const list = data.filter((t) => !f || t.name.toLocaleLowerCase().includes(f));
  return (
    <div className="page browse">
      <header className="page-header">
        <h1>Tags<span className="count">{data.length}</span></h1>
        <div className="toolbar">
          <label className="search-box inline">
            <input type="search" placeholder="Filter tags" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
      </header>
      {list.length === 0 ? <p className="muted center-state">No tags match.</p> : <TagCloud tags={list} />}
    </div>
  );
}
