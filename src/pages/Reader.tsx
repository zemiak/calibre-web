import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ePub, { type Book as EpubBook, type Location, type NavItem, type Rendition } from "epubjs";
import { api, authorsLine, bookPath, fileUrl, formatSize, hasFormat, thumbUrl, type Book } from "../api";
import { ErrorState, Spinner } from "../components/States";
import { useAsync, useDocumentTitle } from "../hooks";
import { progress, type ReaderPrefs } from "../progress";

/** The inline EPUB reader (epub.js). The book file is downloaded whole, then paginated in an iframe;
 * the position (an EPUB CFI) and the reader settings are kept in this browser's localStorage. */
export function Reader() {
  const { id = "" } = useParams();
  const book = useAsync(() => api.book(id), [id]);
  useDocumentTitle(book.data?.title);
  if (book.error && !book.data) return <div className="reader-page dark"><ErrorState error={book.error} retry={book.reload} /></div>;
  if (!book.data || String(book.data.application_id) !== id) return <div className="reader-page dark"><Spinner /></div>;
  if (!hasFormat(book.data, "epub")) {
    return (
      <div className="reader-page dark">
        <div className="center-state">
          <p className="muted">This book has no EPUB to read here ({book.data.formats.map((f) => f.toUpperCase()).join(", ") || "no files"}).</p>
          <Link className="btn" to={bookPath(book.data)}>Back to the book</Link>
        </div>
      </div>
    );
  }
  return <EpubReader key={id} book={book.data} />;
}

type Phase =
  | { state: "download"; got: number; total: number }
  | { state: "open" }
  | { state: "ready" }
  | { state: "error"; message: string };

interface Loc {
  cfi: string;
  href: string;
  /** 0–100 */
  pct: number;
  atStart: boolean;
  atEnd: boolean;
}

const THEMES: ReaderPrefs["theme"][] = ["dark", "sepia", "light"];

async function download(url: string, onProgress: (got: number, total: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal, redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 401) {
    window.location.reload();
    throw new Error("Signed out");
  }
  if (!res.ok) throw new Error(`Couldn't download the book: ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

function registerThemes(r: Rendition) {
  // Books often set their own text colours: for the dark themes they have to be overridden.
  const text = "body, p, div, span, h1, h2, h3, h4, h5, h6, li, td, th, dd, dt, blockquote, pre, code";
  r.themes.register("dark", {
    body: { background: "#0d0b10" },
    [text]: { color: "#e6e2ea !important" },
    "a, a *": { color: "#f0b04a !important" },
  });
  r.themes.register("sepia", {
    body: { background: "#f3ead8" },
    [text]: { color: "#4b3b2f !important" },
    "a, a *": { color: "#8a5a1b !important" },
  });
  r.themes.register("light", {
    body: { background: "#ffffff" },
    "a, a *": { color: "#1a5fb4" },
  });
}

/** The table-of-contents entry for a spine item (the deepest one whose file matches). */
function chapterOf(toc: NavItem[], href?: string): NavItem | undefined {
  if (!href) return undefined;
  const file = href.split("#")[0];
  let found: NavItem | undefined;
  const walk = (items: NavItem[]) => {
    for (const it of items) {
      const f = it.href.split("#")[0];
      if (f === file || file.endsWith("/" + f) || f.endsWith("/" + file)) found = it;
      if (it.subitems?.length) walk(it.subitems);
    }
  };
  walk(toc);
  return found;
}

function EpubReader({ book }: { book: Book }) {
  const id = book.application_id;
  const nav = useNavigate();
  const viewer = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const epub = useRef<EpubBook | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: "download", got: 0, total: 0 });
  const [toc, setToc] = useState<NavItem[]>([]);
  const [loc, setLoc] = useState<Loc>();
  const [hasLocations, setHasLocations] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => progress.prefs.get());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const next = useCallback(() => void rendition.current?.next(), []);
  const prev = useCallback(() => void rendition.current?.prev(), []);
  const goTo = useCallback((target: string) => void rendition.current?.display(target), []);

  // Keyboard, both on the page and inside the book's iframe (epub.js forwards those events).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
    switch (e.key) {
      case "ArrowLeft": case "PageUp": case "h": prev(); break;
      case "ArrowRight": case "PageDown": case " ": case "l": e.preventDefault(); next(); break;
      case "Escape": if (showToc) setShowToc(false); else nav(bookPath(id)); break;
      case "t": setShowToc((x) => !x); break;
      case "u": setShowUi((x) => !x); break;
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // Open the book once per id.
  useEffect(() => {
    const el = viewer.current;
    if (!el) return;
    const ctrl = new AbortController();
    let alive = true;
    let r: Rendition | undefined;
    let b: EpubBook | undefined;
    let touchX: number | undefined;

    const located = (l: Location) => {
      if (!alive || !b) return;
      const spineLength = (b.spine as unknown as { length?: number }).length ?? 0;
      const paginated = b.locations.length() > 0;
      let pct = paginated ? l.start.percentage * 100 : spineLength ? (l.start.index / spineLength) * 100 : 0;
      if (l.atEnd) pct = 100;
      else if (!l.atStart && pct < 0.5) pct = 0.5;
      setLoc({ cfi: l.start.cfi, href: l.start.href, pct, atStart: l.atStart, atEnd: l.atEnd });
      progress.set({ id, cfi: l.start.cfi, pct, at: Date.now(), title: book.title, authors: book.authors });
    };

    (async () => {
      try {
        const data = await download(fileUrl(id, "epub"), (got, total) => alive && setPhase({ state: "download", got, total }), ctrl.signal);
        if (!alive) return;
        setPhase({ state: "open" });
        b = ePub(data);
        epub.current = b;
        r = b.renderTo(el, { width: "100%", height: "100%", flow: "paginated", spread: "auto", minSpreadWidth: 1000, allowScriptedContent: false });
        rendition.current = r;
        registerThemes(r);
        r.themes.select(prefsRef.current.theme);
        r.themes.fontSize(`${prefsRef.current.fontSize}%`);
        r.on("relocated", located);
        r.on("keydown", (e: KeyboardEvent) => keyRef.current(e));
        // A tap in the text shows or hides the controls; a swipe turns the page.
        r.on("click", (e: MouseEvent) => {
          if ((e.target as HTMLElement | null)?.closest?.("a")) return;
          setShowUi((x) => !x);
        });
        r.on("touchstart", (e: TouchEvent) => void (touchX = e.changedTouches[0]?.screenX));
        r.on("touchend", (e: TouchEvent) => {
          const x = e.changedTouches[0]?.screenX;
          if (touchX === undefined || x === undefined) return;
          const dx = x - touchX;
          if (dx < -60) next();
          else if (dx > 60) prev();
        });
        b.loaded.navigation.then((n) => alive && setToc(n.toc ?? []));
        await r.display(progress.get(id)?.cfi || undefined);
        if (!alive) return;
        setPhase({ state: "ready" });

        // "Locations" split the book into equal pieces for the progress slider. They take a while
        // for a long book, so they're computed in the background and cached.
        await b.ready;
        const cached = progress.locations.get(id);
        if (cached) b.locations.load(cached);
        else {
          await b.locations.generate(1200);
          if (!alive) return;
          progress.locations.set(id, b.locations.save());
        }
        if (!alive) return;
        setHasLocations(true);
        const cur = r.currentLocation() as unknown as Location | undefined;
        if (cur?.start) located(cur);
      } catch (e) {
        if (alive && !ctrl.signal.aborted) setPhase({ state: "error", message: (e as Error).message || String(e) });
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
      try { r?.destroy(); } catch { /* already gone */ }
      try { b?.destroy(); } catch { /* already gone */ }
      rendition.current = null;
      epub.current = null;
    };
  }, [id, book.title, book.authors, next, prev]);

  // Settings apply live and are remembered.
  useEffect(() => {
    progress.prefs.set(prefs);
    const r = rendition.current;
    if (!r) return;
    r.themes.select(prefs.theme);
    r.themes.fontSize(`${prefs.fontSize}%`);
  }, [prefs]);

  const seek = (v: number) => {
    const b = epub.current;
    if (!b || !hasLocations) return;
    goTo(b.locations.cfiFromPercentage(Math.min(0.999, Math.max(0, v / 1000))));
  };

  const chapter = chapterOf(toc, loc?.href);
  const pct = loc?.pct ?? 0;
  const ready = phase.state === "ready";
  const uiClass = showUi || !ready ? "" : "hide-ui";

  return (
    <div className={`reader-page ${prefs.theme} ${uiClass}`}>
      <div className="reader-view" ref={viewer} />

      {!ready && (
        <div className="reader-loading">
          {phase.state === "error" ? (
            <div className="center-state">
              <p className="muted">{phase.message}</p>
              <Link className="btn" to={bookPath(id)}>Back to the book</Link>
            </div>
          ) : (
            <>
              <div className="art poster reader-cover"><img src={thumbUrl(id, 300, 450)} alt="" className="loaded" /></div>
              <div className="reader-loading-text">
                <strong>{book.title}</strong>
                <span className="muted">{authorsLine(book)}</span>
                {phase.state === "download" ? (
                  <>
                    <div className="progress"><div style={{ width: `${phase.total ? (phase.got / phase.total) * 100 : 5}%` }} /></div>
                    <span className="muted small">
                      Downloading{phase.total ? ` ${formatSize(phase.got)} of ${formatSize(phase.total)}` : "…"}
                    </span>
                  </>
                ) : (
                  <span className="muted small">Opening…</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="reader-top">
        <Link className="pbtn" to={bookPath(id)} aria-label="Back to the book">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M15.4 5.4 9.8 11l5.6 5.6-1.4 1.4-7-7 7-7z" /></svg>
        </Link>
        <div className="reader-title">
          <Link to={bookPath(id)}>{book.title}</Link>
          <span>{chapter?.label.trim() || authorsLine(book)}</span>
        </div>
        <button className={`pbtn ${showToc ? "on" : ""}`} onClick={() => setShowToc((x) => !x)} aria-label="Contents" title="Contents (t)" disabled={!toc.length}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h10v2H4v-2Z" /></svg>
        </button>
      </div>

      <div className="reader-bottom">
        <div className="reader-row">
          <button className="pbtn" onClick={prev} aria-label="Previous page" disabled={!ready || loc?.atStart}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M15.4 5.4 9.8 11l5.6 5.6-1.4 1.4-7-7 7-7z" /></svg>
          </button>
          <input
            className="reader-slider"
            type="range"
            min={0}
            max={1000}
            value={Math.round(pct * 10)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!hasLocations}
            aria-label="Position in the book"
            title={hasLocations ? `${Math.round(pct)}%` : "Paginating…"}
          />
          <span className="reader-pct">{hasLocations || loc ? `${Math.round(pct)}%` : "…"}</span>
          <button className="pbtn" onClick={next} aria-label="Next page" disabled={!ready || loc?.atEnd}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="m8.6 5.4 5.6 5.6-5.6 5.6 1.4 1.4 7-7-7-7z" /></svg>
          </button>
        </div>
        <div className="reader-row secondary">
          <button className="pill" onClick={() => setPrefs((p) => ({ ...p, fontSize: Math.max(60, p.fontSize - 10) }))} title="Smaller text">A−</button>
          <button className="pill" onClick={() => setPrefs((p) => ({ ...p, fontSize: Math.min(220, p.fontSize + 10) }))} title="Larger text">A+</button>
          <span className="muted small">{prefs.fontSize}%</span>
          <span className="spacer" />
          <div className="segmented">
            {THEMES.map((t) => (
              <button key={t} className={prefs.theme === t ? "active" : ""} onClick={() => setPrefs((p) => ({ ...p, theme: t }))}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showToc && (
        <aside className="reader-toc">
          <h3>Contents</h3>
          <TocList items={toc} active={chapter} onPick={(href) => { goTo(href); setShowToc(false); }} />
        </aside>
      )}
    </div>
  );
}

function TocList({ items, active, onPick, depth = 0 }: { items: NavItem[]; active?: NavItem; onPick: (href: string) => void; depth?: number }) {
  return (
    <ul className="toc-list">
      {items.map((it) => (
        <li key={it.id + it.href}>
          <button className={it === active ? "sel" : ""} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => onPick(it.href)}>
            {it.label.trim() || it.href}
          </button>
          {it.subitems && it.subitems.length > 0 && <TocList items={it.subitems} active={active} onPick={onPick} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}
