// calibre's book descriptions ("comments") are HTML written by whoever edited the metadata or
// fetched from a store. Keep the formatting, drop everything that could run or load.

const ALLOWED = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "del", "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "span", "div", "hr", "sup", "sub", "code", "pre", "a",
  "table", "thead", "tbody", "tr", "th", "td", "dl", "dt", "dd", "small", "cite", "q",
]);

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        // Keep the text of unknown elements (e.g. <font>), not the element.
        child.replaceWith(...Array.from(child.childNodes));
        walk(node);
        return;
      }
      for (const attr of Array.from(child.attributes)) {
        if (tag === "a" && attr.name === "href" && /^https?:\/\//i.test(attr.value)) continue;
        child.removeAttribute(attr.name);
      }
      if (tag === "a") {
        if (!child.hasAttribute("href")) child.replaceWith(...Array.from(child.childNodes));
        else {
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noreferrer noopener");
        }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
