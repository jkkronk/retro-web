// Background service worker: receives extracted page content from the content
// script over a Port, streams a retro-fied page back from the Claude API.
//
// Raw fetch instead of @anthropic-ai/sdk: this extension has no build step,
// and MV3 forbids loading remote code, so a bundler-free fetch client is the
// pragmatic choice for a service worker.

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";
// Output length is the dominant latency cost — a tight cap plus the
// "curate, don't transcribe" prompt rule keeps generation fast.
const MAX_TOKENS = 8192;

const SYSTEM_PROMPT = `You are "WebMaster Dave", a passionate amateur webmaster in the year 1998 running a hand-crafted homepage on Geocities. You rebuild modern web pages as authentic late-90s/early-2000s websites.

You will receive the extracted content of a modern web page. Rebuild it as a retro page, keeping the real content (titles, text, links, image references) but presenting it with full 90s commitment.

Output rules — follow these exactly:
- Output ONLY an HTML fragment: one <style> block followed by body markup. No <html>, <head>, <body>, or markdown fences.
- The page is rendered progressively while you stream, so keep the <style> block COMPACT (well under 60 lines) and close it quickly — get to visible body content fast. Put the most impressive content (banner, marquee, title table) first.
- NO JavaScript. No <script> tags, no event handler attributes. Animation must be CSS-only (plus <marquee> and <blink>-style CSS keyframes).
- No external resources: no external stylesheets, fonts, or images from the web. For the original page's images, you may reuse their src URLs in <img> tags with width attributes and chunky borders. For decorations, use emoji, ASCII art, and CSS.
- Use the period-correct toolkit: <table> layouts with visible borders, <marquee>, <center>, <font>-style CSS (Comic Sans MS, Times New Roman, monospace), web-safe colors (teal, fuchsia, lime, navy, yellow), tiled-looking CSS background patterns, beveled outset borders on everything clickable, visited-link purple, horizontal rules.
- Include period furniture where it fits: a hit counter (make up a number), "Best viewed in Netscape Navigator 4.0 at 800x600" badge, an under-construction section, a guestbook link, a webring footer ("<< prev | random | next >>"), "Sign my guestbook!!", a "last updated" date in the late 90s.
- Write in WebMaster Dave's voice for the chrome around the content (welcome marquee, footer, asides), but keep the actual page content faithful — same information, retro presentation.
- Keep it to one cohesive page. Make it genuinely fun, not lazy.
- SPEED MATTERS: keep the whole page under ~200 lines of markup. CURATE, don't transcribe — for link-heavy or content-heavy pages (news fronts, search results), pick the ~10 best items and present those well rather than including everything.`;

// ---------------------------------------------------------- retro mode
// A tab enters "retro mode" when the user clicks a link inside a retro page:
// we navigate the tab ourselves and re-inject the content script when the
// destination finishes loading, so the user keeps surfing in 1998.
// Tracked in storage.session so it survives service worker restarts.

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
  } else if (msg.type === "retro-exit") {
    setRetroMode(tabId, false);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!(await isRetroMode(tabId))) return;
  try {
    // Ensure-on, never toggle: re-running content.js on a page where the
    // overlay is already showing would toggle it OFF (duplicate "complete"
    // events fire for one load), so check before injecting.
    const [check] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__retroWebActive),
    });
    if (!check?.result) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content.js"],
      });
    }
  } catch (_) {
    // Restricted page (chrome://, web store, etc.) — drop out of retro mode
    // so we don't keep failing on every load in this tab.
    await setRetroMode(tabId, false);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => setRetroMode(tabId, false));

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
      await retrofy(msg, port, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        try {
          port.postMessage({ type: "error", message: err.message });
        } catch (_) {}
      }
    }
  });
});

async function retrofy(msg, port, signal) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) {
    port.postMessage({
      type: "error",
      message:
        "No API key set. Right-click the extension icon → Options, and paste your Anthropic API key.",
    });
    return;
  }

  const cacheKey = `cache::${model}::${msg.url}`;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached) {
    port.postMessage({ type: "delta", text: cached });
    port.postMessage({ type: "done", complete: true, fromCache: true });
    return;
  }

  const body = {
    model,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Rebuild this page as a retro website.\n\nURL: ${msg.url}\n\n${msg.content}`,
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
  let fullText = "";
  let stopReason = null;
  let complete = false;
  try {
    for await (const event of sseEvents(response.body)) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        fullText += event.delta.text;
        port.postMessage({ type: "delta", text: event.delta.text });
      } else if (event.type === "message_delta" && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      } else if (event.type === "message_stop") {
        complete = true;
      } else if (event.type === "error") {
        throw new Error(event.error?.message || "Stream error");
      }
    }
  } finally {
    clearInterval(keepalive);
  }

  // Only a cleanly finished generation may become the canonical cached page —
  // a max_tokens truncation or dropped connection must not replay forever.
  if (complete && stopReason === "end_turn") {
    try {
      await chrome.storage.local.set({ [cacheKey]: fullText });
    } catch (_) {
      // Cache full or unavailable; the page still rendered — never surface
      // a cache-write failure as a generation error.
    }
  }
  port.postMessage({ type: "done", complete, fromCache: false });
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
