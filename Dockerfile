# Build: typecheck + bundle.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: nginx serves dist/, covers and book files from the library folder ($LIBRARY_DIR), and
# proxies /state/ to the state service. The same image runs that service in a second container:
#   node /srv/state/state.mjs   (LIBRARY_DIR: the calibre library; STATE_DIR: per-user files)
FROM nginx:1.28-alpine AS runtime
RUN apk add --no-cache nodejs \
 && sed -i '1i load_module modules/ngx_http_image_filter_module.so;' /etc/nginx/nginx.conf
ENV CALIBRE_API=http://calibre:8080 \
    LIBRARY_DIR=/library \
    STATE_PORT=8081 \
    STATE_DIR=/data
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY server /srv/state
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
