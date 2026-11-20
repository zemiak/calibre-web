# History

What changed in each version, newest first. The version is in `package.json`; the account page
shows it and links to this page. Versions before 1.3.0 were numbered afterwards.

## 2026-11-20 — 1.3.2: Icon nav bar on phones

- On a phone the nav bar shows icons instead of names (the names are tooltips), and the Home link
  is gone: the book icon on the left is home. The desktop nav bar is unchanged.

## 2026-11-20 — 1.3.1: Home shelf order

- Home page: the Wishlist shelf comes first, then Unread, then Favorites.

## 2026-11-20 — 1.3.0: Wishlist, favorites, unread marks, Goodreads

- **Wishlist and favorites**: a star (books to read) and a heart (books you liked) on the book page.
  Kept per user with the reading marks. Each list has its own page in the nav bar and a shelf on the
  home page, and the account page counts them.
- **Marks on every cover**: ★ wishlist, ♥ favorite, ● unread (not marked finished by you or in
  calibre's Finished column), ♪ audiobook. They replace the tick that marked finished books.
- **Goodreads link** on the book page: the book's page by its Goodreads id or ISBN, otherwise a search
  for the title and author. Goodreads closed its API in 2020, so a link is as far as it goes.
- **Version and history** on the account page (this page).

## 2026-11-18 — 1.2.1: Dependency updates

- Dependabot watches the npm packages; `@xmldom/xmldom` (used by the EPUB reader) patched.
- `gh` added to the devbox environment.

## 2026-11-17 — 1.2.0: The library straight from metadata.db

- The state service reads calibre's `metadata.db` (read-only) and keeps the library in memory; the
  app loads it whole and searches, sorts and counts in the browser. calibre-server isn't needed any
  more, and the `/api` proxy to it is gone.
- Covers are scaled and cached by nginx; book files come straight from the library folder.
- The library loads as soon as `metadata.db` appears, notices when the file is replaced (a sync),
  re-reads it every night, and open tabs pick up a changed library when they come back into view.

## 2026-11-14 — 1.1.0: Reading marks, account page, new pages

- Reading positions and *Finished* marks per signed-in user, kept on the server so they follow you
  across devices (in the browser without a sign-in).
- Home: a hero carousel of featured books that can be scrolled by hand; Home shows books only.
- New pages: Comics, Magazines, Unread, New, and the account page (profile, sessions, statistics,
  recent downloads).
- A long press on covers to mark them finished was tried and removed again: it broke the horizontal
  scrolling of the shelves.

## 2026-11-13 — 1.0.0: First version

- A cover-first web UI for a calibre library: Home shelves, Library with sort and filters, Authors,
  Series, Tags, search, book pages with downloads, and an inline EPUB reader.
