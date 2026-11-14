import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { progress } from "../progress";

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(loc.search).get("q") ?? "");

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 10);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    if (!loc.pathname.startsWith("/search")) setQ("");
  }, [loc.pathname]);

  const onSearch = (v: string) => {
    setQ(v);
    const to = v.trim() ? `/search?q=${encodeURIComponent(v)}` : "/search";
    nav(to, { replace: loc.pathname.startsWith("/search") });
  };

  return (
    <nav className={`navbar ${scrolled ? "scrolled" : ""}`}>
      <NavLink to="/" className="brand" aria-label="Home">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M4 3h6a3 3 0 0 1 2 .76A3 3 0 0 1 14 3h6a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-6a1 1 0 0 0-1 1h-2a1 1 0 0 0-1-1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm1 2v13h5a3 3 0 0 1 1 .17V6a1 1 0 0 0-1-1H5Zm14 0h-5a1 1 0 0 0-1 1v12.17A3 3 0 0 1 14 18h5V5Z" />
        </svg>
        <span>Books</span>
      </NavLink>
      <div className="nav-links">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/books">Library</NavLink>
        <NavLink to="/authors">Authors</NavLink>
        <NavLink to="/series">Series</NavLink>
        <NavLink to="/tags">Tags</NavLink>
      </div>
      <label className="search-box">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
        </svg>
        <input
          type="search"
          placeholder="Search"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          onFocus={() => !loc.pathname.startsWith("/search") && q === "" && nav("/search")}
        />
      </label>
      {progress.user && (
        <span className="user-chip" title={`Signed in as ${progress.user}: reading marks are yours`} aria-label={`Signed in as ${progress.user}`}>
          {progress.user[0].toUpperCase()}
        </span>
      )}
    </nav>
  );
}
