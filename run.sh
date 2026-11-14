#!/bin/sh
# Starts the dev server (http://localhost:5173) against the calibre content server on the cluster,
# plus the reading-state service (files in ./.state), signed in as DEV_USER.
#   ./run.sh                                      # calibre.kubernetes.home.zemiak.dev, user dev@localhost
#   DEV_USER=me@example.com ./run.sh              # another user's marks
#   CALIBRE_API=http://localhost:8080 ./run.sh    # another calibre-server
set -eu
cd "$(dirname "$0")"
export CALIBRE_API="${CALIBRE_API:-https://calibre.kubernetes.home.zemiak.dev}"
export DEV_USER="${DEV_USER:-dev@localhost}"
export STATE_DIR="${STATE_DIR:-$PWD/.state}" STATE_PORT="${STATE_PORT:-8081}"
echo "backend: $CALIBRE_API"
echo "user:    $DEV_USER (state in $STATE_DIR)"
devbox run -- node server/state.mjs &
trap 'kill $! 2>/dev/null' EXIT INT TERM
devbox run -- npm run dev -- "$@"
