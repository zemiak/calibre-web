import { useMemo } from "react";
import { Link } from "react-router-dom";
// The repo's HISTORY.md, bundled at build time into this page's chunk only (vite.config.ts).
import historyMarkdown from "virtual:history";
import { useDocumentTitle } from "../hooks";

interface Section {
  title: string;
  html: string;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline Markdown: `code`, **bold**, *italic*, [text](https://…). The text is escaped first. */
function inline(s: string): string {
  return escape(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

/** The subset of Markdown HISTORY.md uses: paragraphs and "- " lists (continuation lines indented). */
function blocks(md: string): string {
  const out: string[] = [];
  let list: string[] | undefined;
  let para: string[] | undefined;
  const close = () => {
    if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
    if (para) out.push(`<p>${inline(para.join(" "))}</p>`);
    list = para = undefined;
  };
  for (const line of md.split("\n")) {
    if (!line.trim()) close();
    else if (/^\s*[-*] /.test(line)) {
      if (para) close();
      (list ??= []).push(line.replace(/^\s*[-*] /, ""));
    } else if (list && /^\s+/.test(line)) list[list.length - 1] += " " + line.trim();
    else (para ??= []).push(line.trim());
  }
  close();
  return out.join("");
}

/** "## title" sections; the text before the first one is the intro. */
function parse(md: string): { intro: string; sections: Section[] } {
  const [head, ...rest] = md.split(/^## /m);
  return {
    intro: blocks(head.replace(/^# .*$/m, "")),
    sections: rest.map((s) => {
      const nl = s.indexOf("\n");
      return { title: inline(s.slice(0, nl < 0 ? undefined : nl).trim()), html: blocks(nl < 0 ? "" : s.slice(nl + 1)) };
    }),
  };
}

/** What changed in each version, newest first. */
export function History() {
  useDocumentTitle("History");
  const { intro, sections } = useMemo(() => parse(historyMarkdown), []);
  return (
    <div className="page history-page">
      <header className="page-header">
        <div>
          <h1>History<span className="count">{__APP_VERSION__}</span></h1>
          <p className="intro muted">
            {sections.length} versions, newest first · <Link to="/me">Back to the account</Link>
          </p>
        </div>
      </header>
      <div className="history-intro muted" dangerouslySetInnerHTML={{ __html: intro }} />
      {sections.map((s, i) => (
        <article key={i} className="history-entry">
          <h2 dangerouslySetInnerHTML={{ __html: s.title }} />
          <div className="history-body" dangerouslySetInnerHTML={{ __html: s.html }} />
        </article>
      ))}
    </div>
  );
}
