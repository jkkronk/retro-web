// Offscreen document: the service worker has no DOMParser, so prefetched
// HTML (speculative generation at link-click time) is parsed and extracted
// here, with the same extractor the content script uses on live pages.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "retro-offscreen" || msg.type !== "extract-html") return;
  try {
    const doc = new DOMParser().parseFromString(msg.html, "text/html");
    // The parsed doc's base URL is this offscreen page — point it at the
    // real page so relative image/link URLs resolve correctly.
    const base = doc.createElement("base");
    base.href = msg.url;
    doc.head.prepend(base);
    sendResponse({ ok: true, content: window.extractFromDocument(doc) });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
});
