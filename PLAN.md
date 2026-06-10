# Improvement Plan

Based on the 7-angle code review (2026-06-09). Ordered by phase; items within a
phase are independent unless noted.

> **Status:** Phase 0 (items 1–6) and Phase 1 (item 7) are implemented.
> Phases 2–3 are open.

## The key architectural move (Phase 1 centerpiece)

**Render the generated page into a sandboxed iframe instead of the host DOM.**
One change fixes five findings at once:

- `<iframe sandbox="allow-same-origin" srcdoc>` with **no** `allow-scripts`
  makes script execution impossible at the platform level — the hand-rolled
  sanitizer (which has confirmed bypasses: entity-obfuscated `javascript:`
  URLs, unsanitized `<style>` url()/@import, svg/srcset/formaction vectors)
  becomes defense-in-depth instead of the only barrier.
- Style isolation both ways: the generated `body { ... }` rules stop bleeding
  into the host page, and host CSS resets stop breaking the retro page.
- **Streaming becomes native:** write chunks with
  `iframe.contentDocument.write(chunk)` and the browser's own incremental
  parser handles incomplete markup, unterminated `<style>` blocks, and
  progressive image loading. This deletes the re-parse-everything-every-400ms
  renderer (O(n²), image flicker), the `</style>`-substring phase detection,
  the 6000-byte fallback, and the markdown-fence stripping hack.
- Link interception moves to a click listener on `contentDocument`
  (`allow-same-origin` permits access; scripts still can't run inside).
- `document.write` is also the period-correct 1998 API. Fitting.

## Phase 0 — Correctness fixes (small, do first)

1. **Idempotent injection.** Auto-injection (retro-mode navigation) must
   ensure-on, never toggle. Background first runs a tiny
   `executeScript({func})` presence check and only injects the file if the
   overlay is absent. Popup keeps toggle semantics. Delete the 1500ms
   `recentlyInjected` debounce (no longer needed) — fixes "second complete
   event kills the overlay".
2. **`retro-exit` on every toggle-off**, not just the ⏏ button, so dismissing
   via the popup actually leaves retro mode.
3. **Port lifecycle.** Register `port.onDisconnect` in content.js → show the
   error instantly when the service worker dies (today: 45s watchdog).
   Clear the watchdog on toggle-off; arm it only on delta. Error display must
   work in both phases (status-bar error state, not writes into the
   possibly-destroyed modem screen). Watchdog should disconnect the port.
4. **Cache only completed generations.** Track `message_stop` /
   `stop_reason` in the SSE loop; cache only on `end_turn`. A `max_tokens`
   truncation renders but is not cached. Wrap the cache write in try/catch so
   a failed write never surfaces as a generation error.
5. **SSE parser robustness.** Flush the trailing buffer + TextDecoder when
   the stream ends; accept `data:` without a space; delete the dead
   OpenAI `[DONE]` check.
6. **Abort properly.** Replace the `aborted` flag polling with an
   AbortController wired to `port.onDisconnect` so ejecting actually cancels
   the fetch (stops token billing) instead of streaming to a dead port.

## Phase 1 — The iframe renderer

7. Replace overlay-div rendering with the sandboxed-iframe streaming renderer
   described above. Keep the sanitizer as a final defense-in-depth pass on
   `done` (fix the `javascript:` check to strip control chars before
   matching; strip `@import`). Modem screen stays until the first body
   content paints in the iframe (structural signal: iframe body has children
   — no more `</style>` substring matching).

## Phase 2 — Quality of results

8. **Extraction upgrades:** don't filter images by layout width/height (use
   attribute/naturalWidth or just src presence); prefer links inside the
   main content container over header/nav/footer so the link cap isn't spent
   on "Privacy Policy"; include `og:image`/`og:description`. Consider
   bundling Mozilla Readability.
9. **Cache LRU:** cap at ~50 entries with timestamps, evict oldest on
   insert. Use `getKeys()` (Chrome 130+) or the key index in clearCache
   instead of `get(null)`.
10. **Batch deltas** in the background (flush per network read or ~100ms)
    to cut port messages 10-50x.

## Phase S — Speed (generation latency)

Latency budget for a retro-mode link click: navigation→DCL (1–5s, now
overlapped by the commit-time cover), time-to-first-token (2–5s), style
block streaming with nothing revealable (5–15s), body streaming (20–80s,
dominant). Levers, in expected-impact order:

S1. **Speculative generation at click time** (biggest perceived win,
    medium effort). We know the destination URL the moment a retro link is
    clicked — don't wait for the page to load to start generating. At click:
    background `fetch()`es the destination HTML, parses it in an
    **offscreen document** (`chrome.offscreen` — service workers have no
    DOMParser), runs the same extraction, and starts the API stream
    immediately, buffering deltas. When the content script connects after
    DOMContentLoaded, it drains the buffer and tails the live stream.
    Overlaps generation with navigation + page load: saves ~5–15s per hop.
    Fallback: if the fetch fails or returns bot-walled content (no
    headings/paragraphs extracted), fall back to today's extract-after-load
    flow. Mind cookies/auth: prefetch only for http(s) GET navigations.

S2. **Reveal sooner: two-stage CSS prompt rule** (small effort, big felt
    win). The page stays on the modem screen until the opening style block
    closes. Change the prompt: "opening <style> must be under 25 lines —
    just colors, fonts, table borders; you may emit a second <style> with
    refinements at the END of the page." Cuts time-to-first-visible-content
    from ~10–15s to ~3–5s.

S3. **Shorter pages by default** (zero effort, linear win). Output tokens
    dominate. Tighten "~200 lines" to "~120 lines, never more than 160" and
    drop max_tokens 8192 → 6144. A 35% shorter page is ~35% faster. Keep
    quality by telling the model to cut item COUNT (fewer curated links/
    sections), not the jokes.

S4. **"Surfing speed" model preset** (small effort, user choice). Retro
    mode hops are where speed matters most: optional setting to use Haiku
    4.5 for link-follow generations (~3–4× faster) while keeping the chosen
    model for explicitly retro-fied pages. Caches stay per-model.

S5. **Trim the input** (small effort, small win). 9KB content cap → 6KB,
    drop the LINK list to 15 for retro-mode hops. Faster time-to-first-token
    and cheaper.

S6. **Real transfer stats on the modem screen** (instrumentation, fun).
    Show actual tok/s and elapsed time in the status bar ("CONNECT 28800"
    becomes honest). Needed to measure S1–S5 instead of guessing.

Not planned: pre-generating pages for links the user *might* click — each
speculative page costs real API money; only generate what was actually
requested (S1 still only generates the clicked destination).

## Phase 3 — Cleanup & polish

11. Shared `win95.css` used by popup + options + (via insertCSS) the overlay
    chrome; one `constants.js` (DEFAULT_MODEL, cache-key helpers) loaded by
    options/popup and the worker via `importScripts`.
12. Remove derivable state: `bytes` (use `html.length`), the `phase` flag
    (derivable), the arm-then-immediately-clear watchdog pattern.
13. Extension icons (16/32/48/128) — also required for Web Store submission.
14. Smoke test v2: drive the port message handlers (delta/done/error) and
    sanitize() with fixture HTML, not just synchronous startup.
15. Optional: `webNavigation.onHistoryStateUpdated` (new permission) so
    retro mode follows SPA navigations.
