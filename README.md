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
- **Reading marks**: the position in each book and a *Finished* toggle on the book page (shown as a tick
  on covers, next to calibre's own *Finished* column). Behind the sign-in proxy they belong
  to the signed-in user and are kept on the server, so they follow the user across devices; without
  a sign-in they stay in the browser. They feed *Continue Reading* on the home page.
- **Search**: every word must appear in the title, authors, series, tags, description or publisher
  (calibre's own search language does the matching), plus the authors, series and tags whose names
  match. With an empty search box: a tag cloud.

Keyboard shortcuts in the reader: ←/→ or PageUp/PageDown or space turn pages, t contents, u hide the
controls, Esc back. A tap on the text hides and shows the controls; a swipe turns the page.

Books come from the content server's AJAX API (`/ajax/search`, `/ajax/books`, `/ajax/category`,
`/get/thumb`, `/get/<format>`); nothing is read from `metadata.db` directly, so the library can be
edited in calibre while this runs. The server must run with `--disable-auth` (or sit behind
something that signs the user in, like an oauth2-proxy; an expired session reloads the page).

Reading marks go to `/state`, a small dependency-free Node service (`server/state.mjs`) that keeps
one JSON file per user in `STATE_DIR`. The user is the `X-Forwarded-Email` header that oauth2-proxy
sets on every request it lets through; a request without it gets 401 and the app falls back to
localStorage. Anyone who can reach the service without the proxy could send that header
themselves, so it is bound to localhost and only nginx in the same pod talks to it.

## Development

Tooling comes from [devbox](https://www.jetify.com/devbox) (Node 22).

```sh
devbox run -- npm install
./run.sh                                                            # http://localhost:5173, API: calibre.kubernetes.home.zemiak.dev, state service, user dev@localhost
DEV_USER=me@example.com ./run.sh                                   # another user's marks
devbox run -- npm run dev                                           # API: http://localhost:8080, no state service (marks stay in the browser)
CALIBRE_API=https://calibre.example.com devbox run -- npm run dev   # another calibre-server
devbox run -- npm run build                                         # typecheck + dist/
```

`/api/*` is proxied to calibre-server and `/state/*` to the state service (`vite.config.ts` in
development, nginx in production), so the app, the API and the marks share an origin. In
development `DEV_USER` is sent as `X-Forwarded-Email`, standing in for the sign-in proxy.

## Deployment

`Dockerfile`: builds the app and serves it with nginx; the same image runs the state service as a
second container (`node /srv/state/state.mjs`, with a volume at `STATE_DIR`). Environment:

| Variable | Default | |
|---|---|---|
| `CALIBRE_API` | `http://calibre.calibre.svc.cluster.local:8080` | the calibre-server that `/api/` proxies to |
| `STATE_PORT` | `8081` | where nginx finds the state service (both containers) |
| `STATE_DIR` | `/data` | the state service's files, one per user |

On k3s it is `apps/calibre-web` in the media-rpi repo: a build job picks up new commits on `main`,
builds the image with kaniko and restarts the Deployment.
