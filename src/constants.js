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

  const g = typeof self !== "undefined" ? self : globalThis;
  g.RetroConst = { DEFAULT_MODEL, CACHE_INDEX_KEY, buildCacheKey, isCacheKey };
})();
