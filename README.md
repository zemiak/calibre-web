# calibre-web

A web UI for a [calibre](https://calibre-ebook.com) library served by `calibre-server`, styled after
[movies-frontend](https://github.com/zemiak/movies-frontend): dark, cover-first, with shelves and an
inline EPUB reader.

- **Home**: a rotating hero of random books with their description, then *Continue Reading*,
  *Recently Added*, *Series*, shelves for the biggest tags, *Audiobooks* and a random pick.
- **Library**: a cover grid with sort (title, author, date added, published, series, rating, size),
  tag filters (several at once, all must match), format and language filters, and infinite scrolling.
  Author, series and tag pages use the same grid; series pages are ordered by series index.
- **Authors**, **Series**, **Tags**: browse pages. Authors are grouped by letter, series show a stack of
  their first covers, tags are a cloud sized by book count.
- **Book pages**: cover, authors, series, tags, rating, description, *Read* (EPUB), *Open PDF* (in the
  browser), an audio player for MP3 audiobooks, downloads of every format, *More in this series*,
  *More by the author* and the metadata (identifiers link to Open Library, Amazon, Goodreads, …;
  custom columns such as *Finished* are shown too).
- **Reader**: EPUBs open inline ([epub.js](https://github.com/futurepress/epub.js)), paginated, with a
  table of contents, a progress slider, three themes (dark, sepia, light) and adjustable text size.
  The position is remembered per book in the browser (the server has no users), which feeds
  *Continue Reading* on the home page.
- **Search**: every word must appear in the title, authors, series, tags, description or publisher
  (calibre's own search language does the matching), plus the authors, series and tags whose names
  match. With an empty search box: a tag cloud.

Keyboard shortcuts in the reader: ←/→ or PageUp/PageDown or space turn pages, t contents, u hide the
controls, Esc back. A tap on the text hides and shows the controls; a swipe turns the page.

Everything comes from the content server's AJAX API (`/ajax/search`, `/ajax/books`, `/ajax/category`,
`/get/thumb`, `/get/<format>`); nothing is read from `metadata.db` directly, so the library can be
edited in calibre while this runs. The server must run with `--disable-auth` (or sit behind
something that signs the user in, like an oauth2-proxy; an expired session reloads the page).

## Development

Tooling comes from [devbox](https://www.jetify.com/devbox) (Node 22).

```sh
devbox run -- npm install
devbox run -- npm run dev                                           # http://localhost:5173, API: http://localhost:8080
CALIBRE_API=https://calibre.example.com devbox run -- npm run dev   # another calibre-server
devbox run -- npm run build                                         # typecheck + dist/
```

`/api/*` is proxied to calibre-server (`vite.config.ts` in development, nginx in production), so the
app and the API share an origin and the reader can fetch book files.

## Deployment

`Dockerfile`: builds the app and serves it with nginx. Environment:

| Variable | Default | |
|---|---|---|
| `CALIBRE_API` | `http://calibre.calibre.svc.cluster.local:8080` | the calibre-server that `/api/` proxies to |

On k3s it is `apps/calibre-web` in the media-rpi repo: a build job picks up new commits on `main`,
builds the image with kaniko and restarts the Deployment.
