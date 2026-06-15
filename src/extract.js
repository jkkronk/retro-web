// Shared content extraction, used by BOTH the content script (live DOM) and
// the offscreen document (DOMParser-parsed prefetched HTML for speculative
// generation). Guarded global because content-script files can be injected
// into the same isolated world more than once.
//
// Performance matters here: this runs on arbitrary (possibly huge) pages.
// textContent only (innerText forces a reflow per call), a running length
// counter (never re-join inside the loop), and hard per-category caps so
// link-farm pages (search results, news fronts) can't blow up the prompt.

(() => {
  if (window.extractFromDocument) return;

  const MAX_CHARS = 6000;
  const CAPS = { heading: 25, text: 40, image: 10, link: 15 };

  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();

  window.extractFromDocument = function extractFromDocument(doc) {
    const parts = [];
    let totalLen = 0;
    const counts = { heading: 0, text: 0, image: 0, link: 0 };
    const seen = new Set();

    const push = (kind, entry) => {
      if (counts[kind] >= CAPS[kind] || seen.has(entry)) return;
      seen.add(entry);
      counts[kind]++;
      parts.push(entry);
      totalLen += entry.length + 1;
    };

    parts.push(`TITLE: ${doc.title}`);
    const desc = doc.querySelector('meta[name="description"]')?.content;
    if (desc) parts.push(`DESCRIPTION: ${desc}`);
    totalLen = parts.join("\n").length;

    const root =
      doc.querySelector("main, article, [role='main']") || doc.body;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (totalLen > MAX_CHARS) break;
      const tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
      if (/^H[1-4]$/.test(tag)) {
        const text = clean(node.textContent);
        if (text && text.length < 200) push("heading", `${tag}: ${text}`);
      } else if (tag === "P" || tag === "BLOCKQUOTE") {
        const text = clean(node.textContent);
        if (text && text.length > 20) push("text", text.slice(0, 500));
      } else if (tag === "IMG") {
        const src = node.currentSrc || node.src;
        // Only exclude images KNOWN to be small — lazy-loaded and parsed-but-
        // not-rendered images report 0×0 and would otherwise all be dropped.
        const w = node.width || 0;
        const h = node.height || 0;
        const knownSmall = w > 0 && h > 0 && (w <= 80 || h <= 80);
        if (src && src.startsWith("http") && !knownSmall) {
          push("image", `IMAGE: ${src} (alt: ${node.alt || "none"})`);
        }
      } else if (tag === "A") {
        const text = clean(node.textContent);
        const href = node.href;
        if (text && text.length > 2 && text.length < 80 && href?.startsWith("http")) {
          push("link", `LINK: "${text}" -> ${href}`);
        }
      }
    }
    return parts.join("\n");
  };
})();
