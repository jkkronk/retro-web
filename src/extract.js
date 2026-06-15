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
    // Prefer the real <meta name="description">; fall back to the social-card
    // og:description so pages that only ship OpenGraph metadata still get a blurb.
    const desc =
      doc.querySelector('meta[name="description"]')?.content ||
      doc.querySelector('meta[property="og:description"]')?.content;
    if (desc) parts.push(`DESCRIPTION: ${desc}`);
    totalLen = parts.join("\n").length;

    // The social-card hero is usually the single best image on the page —
    // seed it before the walk so the per-category image cap can't crowd it out.
    const ogImage = doc.querySelector('meta[property="og:image"]')?.content;
    if (ogImage && ogImage.startsWith("http")) {
      push("image", `IMAGE: ${ogImage} (alt: none)`);
    }

    const root =
      doc.querySelector("main, article, [role='main']") || doc.body;
    // FILTER_REJECT skips the whole subtree, so nav/header/footer/aside links
    // never spend the link budget on "Privacy Policy" and friends. (SCRIPT/
    // STYLE/NOSCRIPT rejection replaces the old inline `continue`.)
    const SKIP =
      /^(SCRIPT|STYLE|NOSCRIPT|NAV|HEADER|FOOTER|ASIDE)$/;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) =>
        SKIP.test(node.tagName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });

    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (totalLen > MAX_CHARS) break;
      const tag = node.tagName;
      if (/^H[1-4]$/.test(tag)) {
        const text = clean(node.textContent);
        if (text && text.length < 200) push("heading", `${tag}: ${text}`);
      } else if (tag === "P" || tag === "BLOCKQUOTE") {
        const text = clean(node.textContent);
        if (text && text.length > 20) push("text", text.slice(0, 500));
      } else if (tag === "IMG") {
        const src = node.currentSrc || node.src;
        // Keep every http(s) image unless a source POSITIVELY says it's a small
        // icon. Use the HTML width/height attributes (the only dims available in
        // the offscreen DOMParser) and naturalWidth when loaded — never layout
        // width/height, which read 0 for lazy/offscreen images and dropped them.
        const aw = parseInt(node.getAttribute("width"), 10);
        const ah = parseInt(node.getAttribute("height"), 10);
        const nw = node.naturalWidth || 0;
        const nh = node.naturalHeight || 0;
        const knownSmall =
          (aw > 0 && ah > 0 && (aw <= 64 || ah <= 64)) ||
          (nw > 0 && nh > 0 && (nw <= 64 || nh <= 64));
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
