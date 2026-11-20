/** package.json's version (vite.config.ts). */
declare const __APP_VERSION__: string;

// Provided by the calibre-web-history plugin in vite.config.ts.
declare module "virtual:history" {
  /** HISTORY.md's text. */
  const markdown: string;
  export default markdown;
}
