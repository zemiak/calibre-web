# Build: typecheck + bundle.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: nginx serves dist/ and proxies /api/ to the calibre content server ($CALIBRE_API) and
# /state/ to the reading-state service. The same image runs that service in a second container:
#   node /srv/state/state.mjs   (STATE_DIR: where the per-user files go)
FROM nginx:1.28-alpine AS runtime
RUN apk add --no-cache nodejs
ENV CALIBRE_API=http://calibre.calibre.svc.cluster.local:8080 \
    STATE_PORT=8081 \
    STATE_DIR=/data
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY server /srv/state
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
