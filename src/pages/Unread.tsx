import { useCallback, useEffect, useState } from "react";
import { api, CALIBRE_FINISHED, Q, TEXT_BOOKS, type Book } from "../api";
import { BookCard } from "../components/Card";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle, useInView } from "../hooks";
import { progress, type ListKind } from "../progress";

const PAGE = 96;

/** A grid of books given by id (the user's marks live in the state service, not in calibre, so the
 * filtering happens here): all ids first, then the metadata page by page. */
function BookIdsPage({ title, intro, empty, loadIds }: {
  title: string;
  intro: string;
  empty: string;
  loadIds: () => Promise<number[]>;
}) {
  useDocumentTitle(title);
  const ids = useAsync(loadIds, []);
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
          <h1>{title}{ids.data && <span className="count">{all.length}</span>}</h1>
          <p className="intro muted">{intro}</p>
        </div>
      </header>
      {error && <ErrorState error={error} />}
      <div className="grid">{items.map((b) => <BookCard key={b.application_id} book={b} />)}</div>
      {ids.data && !all.length && <p className="muted center-state">{empty}</p>}
      {(busy || !ids.data) && <Spinner />}
      <div ref={sentinel} />
    </div>
  );
}

/** Books (no audiobooks, comics or magazines) that neither this user nor calibre's "Finished" column
 * marks as read, newest first. */
export function Unread() {
  return (
    <BookIdsPage
      title="Unread"
      intro="Books not marked finished, newest first · mark one on its page"
      empty="Everything is read."
      loadIds={async () => {
        const r = await api.search(Q.and(TEXT_BOOKS, Q.not(CALIBRE_FINISHED)), { num: 100000, sort: "timestamp", order: "desc" });
        return r.book_ids.filter((id) => !progress.get(id)?.finished);
      }}
    />
  );
}

/** The user's wishlist or favorites, most recently added first. Books no longer in the library are
 * left out. */
function ListPage({ list }: { list: ListKind }) {
  const wish = list === "wish";
  return (
    <BookIdsPage
      title={wish ? "Wishlist" : "Favorites"}
      intro={wish ? "Books you want to read, last added first · the star on a book's page" : "Books you liked, last added first · the heart on a book's page"}
      empty={wish ? "Nothing on the wishlist yet. Add a book with the star on its page." : "No favorites yet. Add a book with the heart on its page."}
      loadIds={async () => (await api.books(progress.listed(list).map((p) => p.id))).map((b) => b.application_id)}
    />
  );
}

export const Wishlist = () => <ListPage list="wish" />;
export const Favorites = () => <ListPage list="fav" />;
