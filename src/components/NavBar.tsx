import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { progress } from "../progress";

/** The nav links; on a phone they show only their icon (and Home goes: the brand icon is home). */
const LINKS = [
  { to: "/books", label: "Library", icon: "M4 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6 0h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm5.6 1.7 2.9-.78a1 1 0 0 1 1.22.7l4.14 15.46a1 1 0 0 1-.7 1.22l-2.9.78a1 1 0 0 1-1.22-.7L14.9 5.92a1 1 0 0 1 .7-1.22Z" },
  { to: "/wishlist", label: "Wishlist", icon: "m12 2.5 2.9 6.06 6.6.8-4.87 4.56 1.25 6.58L12 17.3l-5.88 3.2 1.25-6.58L2.5 9.36l6.6-.8L12 2.5Z" },
  { to: "/favorites", label: "Favorites", icon: "M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21Z" },
  { to: "/comics", label: "Comics", icon: "M12 3c5.5 0 10 3.6 10 8s-4.5 8-10 8c-1.1 0-2.2-.14-3.2-.4L4 21l1.2-4.1C3.2 15.5 2 13.4 2 11c0-4.4 4.5-8 10-8Z" },
  { to: "/magazines", label: "Magazines", icon: "M4 3h13a1 1 0 0 1 1 1v3h2a1 1 0 0 1 1 1v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1Zm14 6v9a1 1 0 0 0 2 0V9h-2ZM6 6v4h5V6H6Zm7 0v1.5h3V6h-3Zm0 3v1h3V9h-3Zm-7 3v1.5h10V12H6Zm0 3v1.5h10V15H6Z" },
  { to: "/authors", label: "Authors", icon: "M16.6 2.6a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L10 18.8 4.5 20.2a.6.6 0 0 1-.7-.7L5.2 14 16.6 2.6ZM3 21.5h18V23H3v-1.5Z" },
  { to: "/series", label: "Series", icon: "m12 2 10 5-10 5L2 7l10-5Zm-7.76 8.62L12 14.5l7.76-3.88L22 11.74 12 16.74 2 11.74l2.24-1.12Zm0 4.76L12 19.26l7.76-3.88L22 16.5l-10 5-10-5 2.24-1.12Z" },
  { to: "/tags", label: "Tags", icon: "M3 3h8.17a2 2 0 0 1 1.42.59l8.5 8.5a2 2 0 0 1 0 2.82l-6.18 6.18a2 2 0 0 1-2.82 0l-8.5-8.5A2 2 0 0 1 3 11.17V3Zm4.5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" },
];

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
        <NavLink to="/" end className="nav-home">Home</NavLink>
        {LINKS.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} title={label} aria-label={label}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={icon} /></svg>
            <span>{label}</span>
          </NavLink>
        ))}
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
      <NavLink to="/me" className="user-chip" title={progress.user ? `Signed in as ${progress.user}` : "Account and statistics"} aria-label="Account">
        {progress.account?.profile?.picture ? (
          <img src={progress.account.profile.picture} alt="" referrerPolicy="no-referrer" />
        ) : progress.user ? (
          progress.user[0].toUpperCase()
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" /></svg>
        )}
      </NavLink>
    </nav>
  );
}
