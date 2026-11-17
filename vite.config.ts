import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react()],
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
