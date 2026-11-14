import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api is proxied to the calibre content server: CALIBRE_API, a local one by default
// (CALIBRE_API=https://calibre.example.com npm run dev for another). In production nginx does the same.
const target = process.env.CALIBRE_API ?? "http://localhost:8080";

// /state goes to the reading-state service (npm run state, or ./run.sh starts both). DEV_USER plays
// the sign-in proxy: it becomes the X-Forwarded-Email header, so the marks belong to that user.
const state = process.env.STATE_URL ?? "http://localhost:8081";
const devUser = process.env.DEV_USER;
// …and an unsigned stand-in for the Google ID token that oauth2-proxy forwards, so the account page
// has a profile to show (DEV_NAME, DEV_PICTURE).
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const devToken = devUser
  ? `${b64({ alg: "none", typ: "JWT" })}.${b64({
      iss: "dev", sub: "dev", email: devUser, email_verified: true,
      name: process.env.DEV_NAME ?? devUser.split("@")[0], picture: process.env.DEV_PICTURE,
    })}.`
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/state": {
        target: state,
        ...(devUser ? { headers: { "X-Forwarded-Email": devUser, Authorization: `Bearer ${devToken}` } } : {}),
      },
    },
  },
});
