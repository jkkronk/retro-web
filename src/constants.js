// Shared constants + cache-key helpers, dependency-free and side-effect-free
// so the same file is safe in every context: the service worker loads it with
// importScripts(), the options page with <script src>. Exposes one global
// (RetroConst) on whatever the ambient global object is.

(() => {
  const DEFAULT_MODEL = "claude-opus-4-8";
  const CACHE_INDEX_KEY = "cache::__index";

  // cache::${model}::${url} — model in the key so each model caches separately.
  const buildCacheKey = (model, url) => `cache::${model}::${url}`;
  // A real cached page (not the LRU bookkeeping index).
  const isCacheKey = (k) => k.startsWith("cache::") && k !== CACHE_INDEX_KEY;

  // Pages the extension can't inject into and must never retro-fy: browser-
  // internal schemes plus the Chrome Web Store (script injection is blocked
  // there). The single source of truth for "drop out of retro mode" decisions.
  const isRestrictedUrl = (url) =>
    !url ||
    /^(chrome|edge|about|chrome-extension|devtools|view-source):/.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore/.test(url);

  const g = typeof self !== "undefined" ? self : globalThis;
  g.RetroConst = {
    DEFAULT_MODEL,
    CACHE_INDEX_KEY,
    buildCacheKey,
    isCacheKey,
    isRestrictedUrl,
  };
})();
