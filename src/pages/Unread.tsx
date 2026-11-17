import { useCallback, useEffect, useState } from "react";
import { api, CALIBRE_FINISHED, Q, TEXT_BOOKS, type Book } from "../api";
import { BookCard } from "../components/Card";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle, useInView } from "../hooks";
import { progress } from "../progress";

const PAGE = 96;

/** Books (no audiobooks, comics or magazines) that neither this user nor calibre's "Finished" column marks as
 * read, newest first. The user's marks live in the state service, not in calibre, so the filtering
 * happens here: all matching ids first, then the metadata page by page. */
export function Unread() {
  useDocumentTitle("Unread");
  const ids = useAsync(async () => {
    const r = await api
      .search(Q.and(TEXT_BOOKS, Q.not(CALIBRE_FINISHED)), { num: 100000, sort: "timestamp", order: "desc" });
    return r.book_ids.filter((id) => !progress.get(id)?.finished);
  }, []);
  const [items, setItems] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const all = ids.data ?? [];

  const more = useCallback(() => {
    if (busy || !ids.data || items.length >= all.length) return;
    setBusy(true);
    api
      .books(all.slice(items.length, items.length + PAGE))
      .then((bs) => setItems((xs) => [...xs, ...bs]))
      .catch(setError)
      .finally(() => setBusy(false));
  }, [busy, ids.data, items.length, all]);

  useEffect(() => {
    if (ids.data && !items.length && all.length) more();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.data]);
  const sentinel = useInView<HTMLDivElement>(more, !!ids.data && items.length < all.length);

  if (ids.error && !ids.data) return <ErrorState error={ids.error} retry={ids.reload} />;
  return (
    <div className="page library">
      <header className="page-header">
        <div>
          <h1>Unread{ids.data && <span className="count">{all.length}</span>}</h1>
          <p className="intro muted">Books not marked finished, newest first · mark one on its page</p>
        </div>
      </header>
      {error && <ErrorState error={error} />}
      <div className="grid">{items.map((b) => <BookCard key={b.application_id} book={b} />)}</div>
      {ids.data && !all.length && <p className="muted center-state">Everything is read.</p>}
      {(busy || !ids.data) && <Spinner />}
      <div ref={sentinel} />
    </div>
  );
}
