#!/bin/sh
# Starts the dev server (http://localhost:5173) and the state service (reading marks in ./.state),
# signed in as DEV_USER. The library, covers and book files come from the deployed calibre-web.
#   ./run.sh                                         # user dev@localhost
#   DEV_USER=me@example.com ./run.sh                 # another user's marks
#   LIBRARY_DIR=/path/to/Calibre ./run.sh            # read this library's metadata.db locally instead
#   REMOTE=https://calibre-web.example.com ./run.sh  # another deployment for library, covers, files
set -eu
cd "$(dirname "$0")"
export DEV_USER="${DEV_USER:-dev@localhost}"
export STATE_DIR="${STATE_DIR:-$PWD/.state}" STATE_PORT="${STATE_PORT:-8081}"
echo "library: ${LIBRARY_DIR:-${REMOTE:-https://calibre-web.kubernetes.home.zemiak.dev}}"
echo "user:    $DEV_USER (state in $STATE_DIR)"
devbox run -- node --no-warnings=ExperimentalWarning server/state.mjs &
trap 'kill $! 2>/dev/null' EXIT INT TERM
devbox run -- npm run dev -- "$@"
