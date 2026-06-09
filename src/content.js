// Content script, injected on demand when the user clicks "Retro-fy".
// Extracts the page's readable content, shows a dial-up loading screen, and
// streams the generated retro page into a sandboxed iframe. Click again to
// toggle back.
//
// Why an iframe: sandbox WITHOUT allow-scripts makes script execution
// impossible at the platform level (the post-stream harden pass is
// defense-in-depth, not the only barrier), host and generated CSS can't
// bleed into each other, and contentDocument.write() hands chunks to the
// browser's own streaming parser — incomplete markup, open <style> blocks,
// and progressive image loading are all handled natively.

(() => {
  if (window.__retroWeb) {
    window.__retroWeb.toggle();
    return;
  }

  const state = { overlay: null, port: null, watchdog: null, returnBtn: null };

  window.__retroWeb = {
    toggle() {
      if (state.overlay) teardown();
      else start();
    },
  };

  // The background's ensure-on check (retro-mode navigation) reads this to
  // distinguish "overlay currently shown" from "script merely injected".
  Object.defineProperty(window, "__retroWebActive", {
    configurable: true,
    get: () => Boolean(state.overlay),
  });

  function teardown() {
    clearTimeout(state.watchdog);
    state.watchdog = null;
    if (state.port) {
      try {
        state.port.disconnect();
      } catch (_) {}
      state.port = null;
    }
    state.overlay?.remove();
    state.overlay = null;
    // Any dismissal exits retro mode — not just the eject button — so the
    // tab doesn't keep auto-retro-fying after the user opted out.
    try {
      chrome.runtime.sendMessage({ type: "retro-exit" });
    } catch (_) {}
    showReturnButton();
  }

  // Shortcut back into retro mode from the modern page. Re-entry is served
  // from the background's generation cache, so it's near-instant.
  function showReturnButton() {
    const btn = document.createElement("button");
    btn.textContent = "⏪ Back to 1996";
    btn.style.cssText = CORNER_BUTTON_CSS;
    btn.addEventListener("click", () => window.__retroWeb.toggle());
    document.documentElement.appendChild(btn);
    state.returnBtn = btn;
  }

  function start() {
    state.returnBtn?.remove();
    state.returnBtn = null;

    const ui = buildOverlay();
    state.overlay = ui.overlay;

    let content;
    try {
      content = extractContent();
    } catch (err) {
      ui.showError("Extraction failed: " + err.message);
      return;
    }

    const port = chrome.runtime.connect({ name: "retrofy" });
    state.port = port;

    let received = 0;
    let finished = false;

    const settle = () => {
      finished = true;
      clearTimeout(state.watchdog);
      state.port = null;
    };

    const armWatchdog = () => {
      clearTimeout(state.watchdog);
      state.watchdog = setTimeout(() => {
        const p = state.port;
        settle();
        ui.showError("Connection timed out — no data for 45s. Try again.");
        try {
          p?.disconnect();
        } catch (_) {}
      }, 45000);
    };
    armWatchdog();

    // A reaped service worker or extension reload severs the port — report
    // it immediately instead of waiting for the watchdog.
    port.onDisconnect.addListener(() => {
      if (finished) return;
      settle();
      ui.showError("Connection to the extension was lost. Try again.");
    });

    port.onMessage.addListener((msg) => {
      if (finished) return;
      if (msg.type === "delta") {
        armWatchdog();
        received += msg.text.length;
        ui.write(msg.text, received);
      } else if (msg.type === "done") {
        settle();
        ui.finish(msg.complete === false ? "truncated" : "ok");
      } else if (msg.type === "error") {
        settle();
        ui.showError(msg.message);
      }
    });

    port.postMessage({ type: "extract", url: location.href, content });
  }

  // ---------------------------------------------------------------- extract

  // Performance matters here: this runs on arbitrary (possibly huge) pages.
  // textContent only (innerText forces a reflow per call), a running length
  // counter (never re-join inside the loop), and hard per-category caps so
  // link-farm pages (search results, news fronts) can't blow up the prompt.
  const MAX_CHARS = 9000;
  const CAPS = { heading: 25, text: 50, image: 10, link: 25 };

  function extractContent() {
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

    parts.push(`TITLE: ${document.title}`);
    const desc = document.querySelector('meta[name="description"]')?.content;
    if (desc) parts.push(`DESCRIPTION: ${desc}`);
    totalLen = parts.join("\n").length;

    const root =
      document.querySelector("main, article, [role='main']") || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

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
        if (src && src.startsWith("http") && node.width > 80 && node.height > 80) {
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
  }

  function clean(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------- overlay

  // Windows-95 bevel button pinned to the top-right corner — shared by the
  // eject button and the post-exit return button.
  const CORNER_BUTTON_CSS = [
    "position:fixed",
    "top:8px",
    "right:8px",
    "z-index:2147483647",
    "font:bold 12px 'MS Sans Serif',Arial,sans-serif",
    "background:#c0c0c0",
    "color:#000",
    "border-top:2px solid #fff",
    "border-left:2px solid #fff",
    "border-right:2px solid #404040",
    "border-bottom:2px solid #404040",
    "padding:4px 10px",
    "cursor:pointer",
  ].join(";");

  function buildOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "__retro-web-overlay";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:#fff",
      "overflow:hidden",
      "color:#000",
    ].join(";");

    const eject = document.createElement("button");
    eject.textContent = "⏏ Back to 2026";
    eject.style.cssText = CORNER_BUTTON_CSS;
    eject.addEventListener("click", () => window.__retroWeb.toggle());

    // Sandboxed renderer. No allow-scripts: generated markup cannot execute
    // code. allow-same-origin: this script can stream into contentDocument
    // and intercept link clicks (scripts inside still can't run).
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "border:0",
      "display:none",
      "background:#fff",
    ].join(";");

    overlay.append(eject, iframe);
    document.documentElement.appendChild(overlay);

    const modem = startModemScreen(overlay);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><base href="${escapeAttr(
        location.href,
      )}" target="_self"></head><body>`,
    );
    // Attach AFTER doc.open() — open() clears listeners on the document.
    doc.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a) return;
      e.preventDefault();
      if (/^https?:/i.test(a.href)) {
        chrome.runtime.sendMessage({ type: "retro-nav", url: a.href });
      }
    });

    let revealed = false;
    let statusBar = null;

    // Structural reveal signal: the page is showable once the body has real
    // content (not just the leading <style> block). No substring matching
    // against model output.
    const maybeReveal = () => {
      if (revealed || !doc.body) return;
      for (const child of doc.body.children) {
        if (child.tagName !== "STYLE") {
          revealed = true;
          modem.remove();
          iframe.style.display = "block";
          statusBar = buildStatusBar(overlay);
          return;
        }
      }
    };

    let firstChunk = true;
    return {
      overlay,
      write(chunk, received) {
        // Strip a leading markdown fence if the model slips one in — it
        // would otherwise render as literal text at the top of the page.
        if (firstChunk) {
          firstChunk = false;
          chunk = chunk.replace(/^\s*```(?:html)?\s*/i, "");
        }
        doc.write(chunk);
        if (!revealed) {
          modem.progress(received, chunk);
          maybeReveal();
        } else {
          statusBar.update(received);
        }
      },
      finish(status) {
        try {
          doc.close();
        } catch (_) {}
        hardenDocument(doc);
        maybeReveal();
        statusBar?.remove();
        statusBar = null;
        if (!revealed) {
          modem.fail("The webmaster sent an empty page. Try again.");
        } else if (status === "truncated") {
          showBanner(
            overlay,
            "⚠ Transfer interrupted — page may be incomplete (not cached).",
          );
        }
      },
      showError(message) {
        statusBar?.remove();
        statusBar = null;
        if (revealed) showBanner(overlay, "💥 ERROR: " + message);
        else modem.fail(message);
      },
    };
  }

  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // Defense-in-depth pass after the stream closes. The sandbox already
  // prevents execution; this strips inert-but-unwanted active content and
  // external CSS imports.
  function hardenDocument(doc) {
    doc
      .querySelectorAll("script, object, embed, form, iframe, link, meta[http-equiv]")
      .forEach((el) => el.remove());
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (["href", "src", "formaction", "xlink:href"].includes(name)) {
          // Entity decoding can hide "javascript:" behind control chars —
          // strip them before the scheme check.
          const value = attr.value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
          if (
            value.startsWith("javascript:") ||
            value.startsWith("vbscript:") ||
            value.startsWith("data:text/html")
          ) {
            el.removeAttribute(attr.name);
          }
        }
      }
    }
    for (const style of doc.querySelectorAll("style")) {
      style.textContent = style.textContent.replace(/@import[^;]*;?/gi, "");
    }
  }

  // ---------------------------------------------------------- modem screen

  const MODEM_LINES = [
    "RETRO-WEB v0.1 — INFORMATION SUPERHIGHWAY ON-RAMP",
    "",
    "ATDT 555-0199 ...",
    "*** dialing ***",
    "♪ SCREEEEE — KRRRSHHHH — bing bong bing ♪",
    "CONNECT 28800/ARQ/V34/LAPM/V42BIS",
    "Logging in to GeoCities neighborhood: SiliconValley/Heights/4096 ...",
    "Negotiating with webmaster (this can take a moment, he is on lunch) ...",
    "Downloading page 1 of 1 — please do not pick up the phone ...",
  ];

  function startModemScreen(overlay) {
    const screen = document.createElement("div");
    screen.className = "__retro-modem";
    screen.style.cssText = [
      "position:absolute",
      "inset:0",
      "overflow:auto",
      "background:#000",
      "color:#33ff33",
      "font:14px/1.7 'Courier New',monospace",
      "padding:40px",
      "box-sizing:border-box",
      "white-space:pre-wrap",
      "word-break:break-all",
    ].join(";");

    const log = document.createElement("div");
    const progressLine = document.createElement("div");
    progressLine.style.cssText = "margin-top:12px;color:#ffff55";
    const echo = document.createElement("div");
    echo.style.cssText =
      "margin-top:12px;color:#117711;font-size:11px;line-height:1.4";

    screen.append(log, progressLine, echo);
    overlay.appendChild(screen);

    let i = 0;
    const timer = setInterval(() => {
      if (i < MODEM_LINES.length) {
        log.textContent += MODEM_LINES[i++] + "\n";
      }
    }, 450);

    let echoTail = "";
    return {
      // Live byte counter + raw stream echo so the screen is never static
      // while the style block streams.
      progress(bytes, chunk) {
        progressLine.textContent = `RECEIVING DATA ... ${(bytes / 1024).toFixed(1)} KB  ▒▒▒`;
        echoTail = (echoTail + chunk).slice(-600);
        echo.textContent = echoTail;
      },
      remove() {
        clearInterval(timer);
        screen.remove();
      },
      fail(message) {
        clearInterval(timer);
        log.textContent +=
          "\nNO CARRIER\n\nERROR: " + message + "\n\n(Click ⏏ to go back.)";
        screen.style.color = "#ff5555";
      },
    };
  }

  // ------------------------------------------------------------ status bar

  function buildStatusBar(overlay) {
    const bar = document.createElement("div");
    bar.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      "z-index:2147483647",
      "background:#c0c0c0",
      "color:#000",
      "font:12px 'MS Sans Serif',Arial,sans-serif",
      "padding:4px 10px",
      "border-top:2px solid #fff",
      "box-shadow:0 -1px 0 #404040",
    ].join(";");
    const text = document.createElement("span");
    const blink = document.createElement("span");
    blink.textContent = " ⏳";
    let visible = true;
    const blinkTimer = setInterval(() => {
      visible = !visible;
      blink.style.visibility = visible ? "visible" : "hidden";
    }, 500);
    bar.append(text, blink);
    overlay.appendChild(bar);

    const update = (bytes) => {
      text.textContent = `Transferring data from geocities.com ... ${(bytes / 1024).toFixed(1)} KB received (28.8 kbps)`;
    };
    update(0);

    return {
      update,
      remove() {
        clearInterval(blinkTimer);
        bar.remove();
      },
    };
  }

  function showBanner(overlay, message) {
    const banner = document.createElement("div");
    banner.textContent = message;
    banner.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      "z-index:2147483647",
      "background:#ffffcc",
      "color:#800000",
      "font:bold 12px 'MS Sans Serif',Arial,sans-serif",
      "padding:6px 10px",
      "border-top:2px solid #fff",
    ].join(";");
    overlay.appendChild(banner);
  }

  start();
})();
