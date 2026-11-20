import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };

/** `virtual:history`: HISTORY.md's text, for the /history page (bundled into that page's chunk). */
function historyModule(): Plugin {
  const id = "virtual:history";
  const resolvedId = "\0" + id;
  const file = resolve("HISTORY.md");
  return {
    name: "calibre-web-history",
    resolveId: (source) => (source === id ? resolvedId : undefined),
    load(loadId) {
      if (loadId !== resolvedId) return undefined;
      this.addWatchFile(file);
      return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
    },
  };
}

// Development: covers, book files and (unless LIBRARY_DIR is set) the library come from a deployed
// calibre-web (REMOTE), which serves them from the calibre library folder. Reading state goes to the
// local state service (npm run state, or ./run.sh, which starts both).
const remote = process.env.REMOTE ?? "https://calibre-web.kubernetes.home.zemiak.dev";
const state = process.env.STATE_URL ?? "http://localhost:8081";
const localLibrary = !!process.env.LIBRARY_DIR;

// DEV_USER plays the sign-in proxy: it becomes the X-Forwarded-Email header, so the marks belong to
// that user, plus an unsigned stand-in for the Google ID token (DEV_NAME, DEV_PICTURE).
const devUser = process.env.DEV_USER;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const devToken = devUser
  ? `${b64({ alg: "none", typ: "JWT" })}.${b64({
      iss: "dev", sub: "dev", email: devUser, email_verified: true,
      name: process.env.DEV_NAME ?? devUser.split("@")[0], picture: process.env.DEV_PICTURE,
    })}.`
  : undefined;
const userHeaders = devUser ? { "X-Forwarded-Email": devUser, Authorization: `Bearer ${devToken}` } : {};
const toRemote = { target: remote, changeOrigin: true, secure: false };

export default defineConfig({
  plugins: [react(), historyModule()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    proxy: {
      // The first matching prefix wins.
      "/state/library": localLibrary ? { target: state } : toRemote,
      "/state": { target: state, headers: userHeaders },
      "/covers": toRemote,
      "/files": toRemote,
    },
  },
});
