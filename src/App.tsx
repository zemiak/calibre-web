import { lazy, Suspense, useEffect, useState } from "react";
import { onLibraryChange } from "./api";
import { Route, Routes, useLocation } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { Spinner } from "./components/States";
import { AuthorsIndex, SeriesIndex, TagsIndex } from "./pages/Browse";
import { Detail } from "./pages/Detail";
import { Home } from "./pages/Home";
import { AuthorPage, Comics, Library, Magazines, NewBooks, SeriesPage, TagPage } from "./pages/Library";
import { Search } from "./pages/Search";
import { Unread } from "./pages/Unread";
import { UserPage } from "./pages/User";

// epub.js (and jszip) are only needed to read a book: loaded when the reader opens.
const Reader = lazy(() => import("./pages/Reader").then((m) => ({ default: m.Reader })));

export function App() {
  const loc = useLocation();
  const reading = loc.pathname.startsWith("/read/");
  // A newer library (changed on the server): the pages read it again. Not the reader, which would
  // lose its place.
  const [libVersion, setLibVersion] = useState(0);
  useEffect(() => onLibraryChange(() => setLibVersion((v) => v + 1)), []);
  return (
    <>
      {!reading && <NavBar />}
      <main className={reading ? "" : "with-nav"}>
        <Routes key={reading ? "reader" : libVersion}>
          <Route path="/" element={<Home />} />
          <Route path="/books" element={<Library />} />
          <Route path="/unread" element={<Unread />} />
          <Route path="/me" element={<UserPage />} />
          <Route path="/new" element={<NewBooks />} />
          <Route path="/comics" element={<Comics />} />
          <Route path="/magazines" element={<Magazines />} />
          <Route path="/authors" element={<AuthorsIndex />} />
          <Route path="/author/:name" element={<AuthorPage />} />
          <Route path="/series" element={<SeriesIndex />} />
          <Route path="/series/:name" element={<SeriesPage />} />
          <Route path="/tags" element={<TagsIndex />} />
          <Route path="/tag/:name" element={<TagPage />} />
          <Route path="/book/:id" element={<Detail />} />
          <Route path="/read/:id" element={<Suspense fallback={<Spinner />}><Reader /></Suspense>} />
          <Route path="/search" element={<Search />} />
          <Route path="*" element={<p className="center-state muted">Not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
