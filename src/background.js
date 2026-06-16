// Background service worker: receives extracted page content from the content
// script over a Port, streams a retro-fied page back from the Claude API.
// For retro-mode link clicks, generation starts SPECULATIVELY at click time
// (prefetch destination → parse in offscreen doc → stream) so tokens are
// already flowing while the destination page is still loading.
//
// Raw fetch instead of @anthropic-ai/sdk: this extension has no build step,
// and MV3 forbids loading remote code, so a bundler-free fetch client is the
// pragmatic choice for a service worker.

importScripts("constants.js");
const { DEFAULT_MODEL, CACHE_INDEX_KEY, buildCacheKey, isRestrictedUrl } =
  self.RetroConst;

const API_URL = "https://api.anthropic.com/v1/messages";
// Output length is the dominant latency cost — a tight cap plus the
// "curate, don't transcribe" prompt rule keeps generation fast.
const MAX_TOKENS = 6144;

const SYSTEM_PROMPT = `You are "WebMaster Dave", a passionate amateur webmaster in the year 1998 running a hand-crafted homepage on Geocities. You rebuild modern web pages as authentic late-90s/early-2000s websites.

You will receive the extracted content of a modern web page. Rebuild it as a retro page, keeping the real content (titles, text, links, image references) but presenting it with full 90s commitment.

Output rules — follow these exactly:
- Output ONLY an HTML fragment: an opening <style> block followed by body markup. No <html>, <head>, <body>, or markdown fences.
- The page renders progressively while you stream. Your opening <style> block must be UNDER 25 LINES — just the palette, fonts, link colors, and table borders — then close it and start visible content immediately, leading with the flashiest part (banner, marquee, title table). You may add ONE extra <style> block with refinements at the very END of the page.
- NO JavaScript. No <script> tags, no event handler attributes. Animation must be CSS-only (plus <marquee> and <blink>-style CSS keyframes).
- No external resources: no external stylesheets, fonts, or images from the web. For the original page's images, you may reuse their src URLs in <img> tags with width attributes and chunky borders. For decorations, use emoji, ASCII art, and CSS.
- Use the period-correct toolkit: <table> layouts with visible borders, <marquee>, <center>, <font>-style CSS (Comic Sans MS, Times New Roman, monospace), web-safe colors (teal, fuchsia, lime, navy, yellow), tiled-looking CSS background patterns, beveled outset borders on everything clickable, visited-link purple, horizontal rules.
- Include period furniture where it fits: a hit counter (make up a number), "Best viewed in Netscape Navigator 4.0 at 800x600" badge, an under-construction section, a guestbook link, a webring footer ("<< prev | random | next >>"), "Sign my guestbook!!", a "last updated" date in the late 90s.
- Write in WebMaster Dave's voice for the chrome around the content (welcome marquee, footer, asides), but keep the actual page content faithful — same information, retro presentation.
- Keep it to one cohesive page. Make it genuinely fun, not lazy.
- SPEED MATTERS: keep the whole page under ~120 lines of markup, never more than 160. CURATE, don't transcribe — pick the ~8 best items and present them well rather than including everything. Cut item count, never the jokes.`;

// ---------------------------------------------------------- retro mode
// A tab enters "retro mode" when the user clicks a link inside a retro page:
// we navigate the tab ourselves and re-inject the content script when the
// destination loads, so the user keeps surfing in 1998. Tracked in
// storage.session so it survives service worker restarts.

const retroTabKey = (tabId) => `retrotab::${tabId}`;

async function setRetroMode(tabId, on) {
  if (on) {
    await chrome.storage.session.set({ [retroTabKey(tabId)]: true });
  } else {
    await chrome.storage.session.remove(retroTabKey(tabId));
  }
}

async function isRetroMode(tabId) {
  const stored = await chrome.storage.session.get(retroTabKey(tabId));
  return Boolean(stored[retroTabKey(tabId)]);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;
  if (msg.type === "retro-nav") {
    setRetroMode(tabId, true).then(() =>
      chrome.tabs.update(tabId, { url: msg.url }),
    );
    // We know the destination NOW — start generating while it loads.
    startSpeculative(tabId, msg.url);
  } else if (msg.type === "retro-nav-newtab") {
    // Modifier / middle clicks open the link in a NEW tab. The retro page lives
    // in a sandboxed iframe with no allow-popups, so it can't open the tab
    // itself — the background does it, carrying retro mode into the new tab.
    chrome.tabs
      .create({ url: msg.url, openerTabId: tabId, active: false })
      .then((tab) => {
        if (tab?.id == null) return;
        setRetroMode(tab.id, true);
        startSpeculative(tab.id, msg.url);
      });
  } else if (msg.type === "retro-exit") {
    setRetroMode(tabId, false);
    abortPending(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setRetroMode(tabId, false);
  abortPending(tabId);
});

// New tabs inherit retro mode from the tab that opened them, so links opened in
// a new tab (context-menu "Open in new tab", target=_blank, window.open) keep
// surfing in 1998. Fires before the new tab's navigation commits, so the
// onCommitted cover-paint + re-injection pipeline below then applies to it.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id == null || tab.openerTabId == null) return;
  if (await isRetroMode(tab.openerTabId)) {
    await setRetroMode(tab.id, true);
  }
});

// Runs in the page at document_start, before first paint: hides the modern
// page behind a terminal-style cover so retro-mode navigation never flashes
// the 2026 site. The content script removes it once the modem screen is up.
function paintCover() {
  if (window.__retroCover || window.__retroWebActive) return;
  const cover = document.createElement("div");
  cover.id = "__retro-web-cover";
  cover.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483646",
    "background:#000",
    "color:#33ff33",
    "font:14px/1.7 'Courier New',monospace",
    "padding:40px",
  ].join(";");
  cover.textContent =
    "RETRO-WEB v0.1\n\nATDT 555-0199 ...\n*** dialing ***\nrequesting page from the information superhighway ...";
  cover.style.whiteSpace = "pre-wrap";
  (document.documentElement || document).appendChild(cover);
  window.__retroCover = cover;
}

// Commit time is the earliest moment the new document exists — painting the
// cover here (injectImmediately) beats first paint, so the modern page is
// never visible between clicking a retro link and the modem screen.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0) return;
  if (!(await isRetroMode(tabId))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      injectImmediately: true,
      func: paintCover,
    });
  } catch (_) {
    // Restricted page; the load-complete handler drops retro mode.
  }
});

// Ensure-on, never toggle: re-running content.js on a page where the overlay
// is already showing would toggle it OFF, so check before injecting. Both
// load-progress listeners below funnel through this, which makes them safe
// to fire in any order or repeatedly.
async function ensureRetroInjected(tabId) {
  const [check] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__retroWebActive),
  });
  if (!check?.result) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/extract.js", "src/content.js"],
    });
  }
}

// Kick off extraction + generation at DOMContentLoaded — the text content is
// extractable then, and waiting for "complete" (all images/ads) costs seconds
// on heavy pages.
chrome.webNavigation.onDOMContentLoaded.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0) return;
  if (!(await isRetroMode(tabId))) return;
  try {
    await ensureRetroInjected(tabId);
  } catch (_) {
    // Handled (with retro-mode drop-out) by the complete listener below.
  }
});

// Fallback for loads where DOMContentLoaded was missed (e.g. injected mid-
// load), and the place restricted pages drop out of retro mode.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!(await isRetroMode(tabId))) return;
  try {
    await ensureRetroInjected(tabId);
  } catch (_) {
    // Only drop retro mode on genuinely restricted pages (chrome://, web
    // store, etc.). Transient injection failures during fast navigation also
    // throw here — clearing the flag for those would silently strand the tab
    // in modern mode for every later link and typed URL, so leave it set and
    // let the next load retry.
    if (isRestrictedUrl(tab?.url)) {
      await setRetroMode(tabId, false);
    }
  }
});

// ------------------------------------------------------------- generation

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "retrofy") return;
  // Abort the in-flight API request the moment the user ejects — stops
  // token billing instead of streaming to a dead port.
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "extract") return;
    try {
      await retrofy(msg, port, controller);
    } catch (err) {
      if (!controller.signal.aborted) {
        try {
          port.postMessage({ type: "error", message: err.message });
        } catch (_) {}
      }
    }
  });
});

async function retrofy(msg, port, controller) {
  // A speculative generation started at link-click time? Hand the port over
  // to it instead of starting a second (billed) request.
  const tabId = port.sender?.tab?.id;
  const pending = tabId != null ? pendingGenerations.get(tabId) : null;
  if (pending) {
    pendingGenerations.delete(tabId);
    if (pending.url === msg.url && pending.started) {
      attachToPending(pending, port, controller);
      return;
    }
    pending.abort(); // different page, or prefetch hasn't paid off yet
  }

  const { apiKey, model } = await getSettings();
  if (!apiKey) {
    port.postMessage({
      type: "error",
      message:
        "No API key set. Right-click the extension icon → Options, and paste your Anthropic API key.",
    });
    return;
  }

  const cacheKey = buildCacheKey(model, msg.url);
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached) {
    touchCache(cacheKey); // read counts as use — true LRU
    port.postMessage({ type: "delta", text: cached });
    port.postMessage({ type: "done", complete: true, fromCache: true });
    return;
  }

  const result = await runGeneration({
    apiKey,
    model,
    url: msg.url,
    content: msg.content,
    signal: controller.signal,
    cacheKey,
    onDelta: (text) => port.postMessage({ type: "delta", text }),
  });
  port.postMessage({ type: "done", complete: result.complete, fromCache: false });
}

// Core streaming call, shared by the normal (port-driven) flow and the
// speculative (click-time) flow. Writes the cache itself on clean completion.
async function runGeneration({ apiKey, model, url, content, signal, cacheKey, onDelta }) {
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Rebuild this page as a retro website.\n\nURL: ${url}\n\n${content}`,
      },
    ],
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let message = `API error (HTTP ${response.status})`;
    try {
      const err = await response.json();
      if (err.error?.message) message = err.error.message;
    } catch (_) {
      // non-JSON error body; keep the status message
    }
    throw new Error(message);
  }

  // MV3 service workers can be reaped during long idle stretches; cheap
  // periodic API calls count as activity and keep this worker alive while
  // the stream is open.
  const keepalive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  // Coalesce per-token deltas into ~100ms batches (or 4KB, whichever comes
  // first) before forwarding — cuts port messages ~10-50x. The size threshold
  // keeps first paint snappy; the timer keeps the stream feeling live.
  let pending = "";
  const flush = () => {
    if (!pending) return;
    const text = pending;
    pending = "";
    // Delivery is best-effort: on abort the port may already be gone, and a
    // post failure must not mask the real stream error from the finally block.
    try {
      onDelta(text);
    } catch (_) {}
  };
  const batcher = setInterval(flush, 100);
  let fullText = "";
  let stopReason = null;
  let complete = false;
  try {
    for await (const event of sseEvents(response.body)) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        fullText += event.delta.text;
        pending += event.delta.text;
        if (pending.length >= 4096) flush();
      } else if (event.type === "message_delta" && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      } else if (event.type === "message_stop") {
        complete = true;
      } else if (event.type === "error") {
        throw new Error(event.error?.message || "Stream error");
      }
    }
  } finally {
    clearInterval(batcher);
    clearInterval(keepalive);
    flush(); // never drop the tail
  }

  // Only a cleanly finished generation may become the canonical cached page —
  // a max_tokens truncation or dropped connection must not replay forever.
  if (complete && stopReason === "end_turn") {
    await recordCache(cacheKey, fullText);
  }
  return { complete };
}

// ------------------------------------------------------------------ cache LRU
// Entries live at `cache::${model}::${url}` (raw HTML string). Recency is kept
// in one side index `cache::__index` => { [cacheKey]: lastAccessMs } so the
// store stays bounded. All cache ops are best-effort: the page already
// rendered, so a storage failure must NEVER surface as a generation error.
//
// Caveat: the index read-modify-write isn't atomic across concurrent
// generations (rare here — at most a few tabs), and pre-upgrade entries are
// adopted into the index lazily on their next hit/rewrite, so eviction only
// governs indexed entries.

const MAX_CACHE = 50;

async function loadIndex() {
  return (await chrome.storage.local.get(CACHE_INDEX_KEY))[CACHE_INDEX_KEY] || {};
}

async function recordCache(cacheKey, html) {
  try {
    await chrome.storage.local.set({ [cacheKey]: html });
    const index = await loadIndex();
    index[cacheKey] = Date.now();
    const keys = Object.keys(index);
    if (keys.length > MAX_CACHE) {
      // Evict the oldest (least-recently-used) keys down to the cap.
      const stale = keys
        .sort((a, b) => index[a] - index[b])
        .slice(0, keys.length - MAX_CACHE);
      for (const k of stale) delete index[k];
      await chrome.storage.local.remove(stale);
    }
    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
  } catch (_) {
    // Cache full or unavailable; the page still rendered.
  }
}

async function touchCache(cacheKey) {
  try {
    const index = await loadIndex();
    index[cacheKey] = Date.now();
    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
  } catch (_) {
    // Best-effort recency bump; ignore.
  }
}

// ------------------------------------------------- speculative generation

// tabId -> pending entry. In-memory is fine: the keepalive interval keeps
// the worker alive while a speculative stream runs.
const pendingGenerations = new Map();

function abortPending(tabId) {
  const pending = pendingGenerations.get(tabId);
  if (pending) {
    pendingGenerations.delete(tabId);
    pending.abort();
  }
}

async function startSpeculative(tabId, url) {
  try {
    const { apiKey, model } = await getSettings();
    if (!apiKey) return;
    const cacheKey = buildCacheKey(model, url);
    if ((await chrome.storage.local.get(cacheKey))[cacheKey]) {
      touchCache(cacheKey); // cache serves instantly — still counts as a use
      return;
    }

    abortPending(tabId); // at most one speculative run per tab
    const controller = new AbortController();
    const entry = {
      url,
      started: false,
      attached: false,
      buffered: [],
      settled: null,
      onDelta: null,
      onSettle: null,
      abort: () => controller.abort(),
    };
    pendingGenerations.set(tabId, entry);
    // If the content script never claims it (navigation failed, tab gone),
    // stop paying for tokens.
    setTimeout(() => {
      if (pendingGenerations.get(tabId) === entry) {
        pendingGenerations.delete(tabId);
        controller.abort();
      }
    }, 90000);

    const content = await prefetchExtract(url, controller.signal);
    if (!content) {
      // Bot-walled, non-HTML, or too thin — fall back to the normal
      // extract-after-load flow by simply withdrawing the entry.
      if (pendingGenerations.get(tabId) === entry) pendingGenerations.delete(tabId);
      return;
    }
    entry.started = true;

    const settle = (message) => {
      if (entry.onSettle) entry.onSettle(message);
      else entry.settled = message;
    };
    try {
      const result = await runGeneration({
        apiKey,
        model,
        url,
        content,
        signal: controller.signal,
        cacheKey,
        onDelta: (text) => {
          if (entry.onDelta) entry.onDelta(text);
          else entry.buffered.push(text);
        },
      });
      settle({ type: "done", complete: result.complete, fromCache: false });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (entry.attached) {
        settle({ type: "error", message: err.message });
      } else if (pendingGenerations.get(tabId) === entry) {
        // Unclaimed failure: withdraw silently, normal flow takes over.
        pendingGenerations.delete(tabId);
      } else {
        entry.settled = { type: "error", message: err.message };
      }
    }
  } catch (_) {
    // Speculative generation is best-effort; the normal flow still works.
  }
}

function attachToPending(pending, port, controller) {
  pending.attached = true;
  if (pending.buffered.length) {
    try {
      port.postMessage({ type: "delta", text: pending.buffered.join("") });
    } catch (_) {}
    pending.buffered = [];
  }
  if (pending.settled) {
    try {
      port.postMessage(pending.settled);
    } catch (_) {}
    return;
  }
  pending.onDelta = (text) => {
    try {
      port.postMessage({ type: "delta", text });
    } catch (_) {}
  };
  pending.onSettle = (message) => {
    try {
      port.postMessage(message);
    } catch (_) {}
  };
  // Ejecting the overlay aborts the speculative stream too.
  controller.signal.addEventListener("abort", pending.abort);
}

// Fetch the destination page and extract its content in the offscreen
// document (service workers have no DOMParser). Returns null on any
// failure — speculative generation must degrade, never break, the flow.
async function prefetchExtract(url, signal) {
  let resp;
  try {
    const timeout = AbortSignal.timeout(12000);
    const merged = AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
    // credentials:include = the prefetch sees the same page a navigation
    // would (logged-in content), for http(s) GET only.
    resp = await fetch(url, { credentials: "include", signal: merged });
  } catch (_) {
    return null;
  }
  if (!resp.ok) return null;
  if (!(resp.headers.get("content-type") || "").includes("html")) return null;
  const html = (await resp.text()).slice(0, 800_000);
  await ensureOffscreen();
  const reply = await chrome.runtime.sendMessage({
    target: "retro-offscreen",
    type: "extract-html",
    html,
    url,
  });
  if (!reply?.ok || (reply.content || "").length < 400) return null;
  return reply.content;
}

let offscreenReady = null;
function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      if (await chrome.offscreen.hasDocument()) return;
      await chrome.offscreen.createDocument({
        url: "src/offscreen.html",
        reasons: ["DOM_PARSER"],
        justification:
          "Parse prefetched HTML to extract page content for retro generation",
      });
    })().catch((err) => {
      offscreenReady = null;
      throw err;
    });
  }
  return offscreenReady;
}

// Parse a Server-Sent Events stream into JSON event objects.
async function* sseEvents(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function* drain(lines) {
    for (const line of lines) {
      // "data:" with or without the space — both are spec-valid.
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        yield JSON.parse(data);
      } catch (_) {
        // partial/garbled frame; skip
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep the trailing partial line
    yield* drain(lines);
  }
  // Flush: without this, a final frame not terminated by a newline (and any
  // multibyte char split across the last chunk) is silently dropped.
  buffer += decoder.decode();
  if (buffer) yield* drain(buffer.split("\n"));
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["apiKey", "model"]);
  return {
    apiKey: stored.apiKey || "",
    model: stored.model || DEFAULT_MODEL,
  };
}
