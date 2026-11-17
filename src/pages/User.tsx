import { Link } from "react-router-dom";
import { api, AUDIOBOOKS, bookPath, CALIBRE_FINISHED, COMICS, MAGAZINES, Q, TEXT_BOOKS, thumbUrl, type Filter } from "../api";
import { Img } from "../components/Img";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle } from "../hooks";
import { progress, type Account } from "../progress";

interface Stats {
  total: number;
  books: number;
  audio: number;
  comics: number;
  magazines: number;
  finished: number;
  unread: number;
  reading: number;
}

const count = (q?: Filter) => api.search(q, { num: 1 }).then((r) => r.total_num);

async function loadStats(): Promise<Stats> {
  const [total, audio, comics, magazines, textIds, calibreFinished] = await Promise.all([
    count(),
    count(AUDIOBOOKS),
    count(COMICS),
    count(MAGAZINES),
    api.search(TEXT_BOOKS, { num: 100000 }).then((r) => r.book_ids),
    api.search(Q.and(TEXT_BOOKS, CALIBRE_FINISHED), { num: 100000 }).then((r) => new Set(r.book_ids)),
  ]);
  const unread = textIds.filter((id) => !calibreFinished.has(id) && !progress.get(id)?.finished).length;
  return {
    total, books: textIds.length, audio, comics, magazines,
    finished: textIds.length - unread, unread, reading: progress.list().length,
  };
}

const when = (ms?: number) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function ago(ms?: number): string {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function Stat({ n, label, to }: { n?: number; label: string; to?: string }) {
  const body = (
    <>
      <span className="stat-n">{n === undefined ? "…" : n.toLocaleString()}</span>
      <span className="stat-label">{label}</span>
    </>
  );
  return to ? <Link to={to} className="stat link">{body}</Link> : <div className="stat">{body}</div>;
}

/** The signed-in user: who the sign-in says they are, their activity and reading, and the library's size. */
export function UserPage() {
  useDocumentTitle("Account");
  const stats = useAsync(loadStats, []);
  const acc = useAsync<Account | null>(() => progress.refreshAccount(), []);
  const a = acc.data ?? progress.account;
  const s = stats.data;
  const p = a?.profile;
  const name = p?.name ?? a?.user ?? "Not signed in";

  return (
    <div className="page user-page">
      <header className="user-header">
        <div className="avatar large">
          {p?.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" /> : <span>{(a?.user ?? "?")[0].toUpperCase()}</span>}
        </div>
        <div>
          <h1>{name}</h1>
          {a ? (
            <p className="muted">
              {a.user}
              {p?.emailVerified && <span className="verified" title="Verified by the sign-in provider"> ✓ verified</span>}
            </p>
          ) : (
            <p className="muted">Reading marks are kept in this browser only.</p>
          )}
        </div>
      </header>

      <section className="user-section">
        <h2>Your Reading</h2>
        <div className="stats">
          <Stat n={s?.unread} label="Unread" to="/unread" />
          <Stat n={s?.reading} label="Reading" to="/" />
          <Stat n={s?.finished} label="Finished" />
          {a && <Stat n={a.downloads.count} label="Downloads" />}
        </div>
        <p className="muted small">
          Books only: audiobooks, comics and magazines don't count. Finished means marked by you or in calibre's Finished column.
        </p>
      </section>

      <section className="user-section">
        <h2>Library</h2>
        <div className="stats">
          <Stat n={s?.total} label="Total" />
          <Stat n={s?.books} label="Books" to="/books" />
          <Stat n={s?.audio} label="Audiobooks" to="/books?format=mp3" />
          <Stat n={s?.comics} label="Comics" to="/comics" />
          <Stat n={s?.magazines} label="Magazines" to="/magazines" />
        </div>
        {stats.error && <ErrorState error={stats.error} retry={stats.reload} />}
      </section>

      {a && (
        <section className="user-section info">
          <h2>Sign-in</h2>
          <dl>
            <div><dt>Last login</dt><dd>{a.activity.previousSession ? `${when(a.activity.previousSession)} · ${ago(a.activity.previousSession)}` : "This is the first one"}</dd></div>
            <div><dt>This session since</dt><dd>{when(a.activity.sessionStart)}</dd></div>
            <div><dt>Sessions</dt><dd>{a.activity.sessions ?? 0}</dd></div>
            <div><dt>First seen</dt><dd>{when(a.activity.firstSeen)}</dd></div>
            {p?.givenName && <div><dt>Given name</dt><dd>{p.givenName}</dd></div>}
            {p?.familyName && <div><dt>Family name</dt><dd>{p.familyName}</dd></div>}
            {p?.domain && <div><dt>Domain</dt><dd>{p.domain}</dd></div>}
            {p?.locale && <div><dt>Locale</dt><dd>{p.locale}</dd></div>}
            {p?.issuer && <div><dt>Provider</dt><dd>{p.issuer.replace(/^https?:\/\//, "")}</dd></div>}
            {p?.subject && <div><dt>Account id</dt><dd>{p.subject}</dd></div>}
            {p?.groups?.length ? <div><dt>Groups</dt><dd>{p.groups.join(", ")}</dd></div> : null}
          </dl>
          <p className="muted small">A session starts with the first visit after 30 minutes away.</p>
        </section>
      )}

      {a && a.downloads.recent.length > 0 && (
        <section className="user-section">
          <h2>Recent Downloads</h2>
          <div className="download-list">
            {a.downloads.recent.slice(0, 20).map((d) => (
              <Link key={`${d.id}-${d.at}`} to={bookPath(d.id)} className="download-item">
                <div className="art poster"><Img src={thumbUrl(d.id, 120, 180)} alt="" fallback={d.title ?? ""} /></div>
                <div>
                  <div className="card-title">{d.title ?? `Book ${d.id}`}</div>
                  <div className="card-sub">{d.fmt.toUpperCase()} · {when(d.at)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      {(acc.loading && !a) && <Spinner />}
    </div>
  );
}
