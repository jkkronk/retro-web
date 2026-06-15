// Runtime smoke test for src/content.js: executes the content script with
// stubbed DOM/chrome APIs and fails if startup OR the streaming message
// path throws (catches TDZ/order bugs and handler regressions that
// `node --check` cannot see).
//
// Usage: node scripts/smoke-test.js

const fakeDoc = () => ({
  open() {},
  write() {},
  close() {},
  addEventListener() {},
  querySelectorAll: () => [],
  body: { children: [] },
});

const el = () =>
  new Proxy(
    { style: {}, attributes: [], children: [] },
    {
      get(t, p) {
        if (p in t) return t[p];
        if (p === "contentDocument") {
          if (!t.__doc) t.__doc = fakeDoc();
          return t.__doc;
        }
        if (
          ["appendChild", "append", "remove", "addEventListener", "setAttribute", "removeAttribute"].includes(p)
        )
          return () => {};
        if (p === "querySelector") return () => el();
        if (p === "querySelectorAll") return () => [];
        return undefined;
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    },
  );

global.window = global;
global.location = { href: "https://example.com/" };
global.NodeFilter = { SHOW_ELEMENT: 1 };
global.DOMParser = class {
  parseFromString() {
    return { head: el(), body: el(), querySelectorAll: () => [] };
  }
};
global.document = {
  title: "Test page",
  createElement: () => el(),
  documentElement: el(),
  body: el(),
  querySelector: () => null,
  createTreeWalker: () => ({ currentNode: null, nextNode: () => null }),
};

// Capture the port so the test can drive the message handlers.
let portMessageHandler = null;
let portDisconnectHandler = null;
global.chrome = {
  runtime: {
    sendMessage: () => {},
    connect: () => ({
      onMessage: {
        addListener: (fn) => {
          portMessageHandler = fn;
        },
      },
      onDisconnect: {
        addListener: (fn) => {
          portDisconnectHandler = fn;
        },
      },
      postMessage: () => {},
      disconnect: () => {},
    }),
  },
};

// Load in the same order the extension injects them.
const path = require("path");
const fs = require("fs");
for (const file of ["extract.js", "content.js"]) {
  eval(fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"));
}

if (typeof portMessageHandler !== "function" || typeof portDisconnectHandler !== "function") {
  console.error("FAIL: content script did not register port listeners");
  process.exit(1);
}

// Drive the streaming protocol: deltas (style phase + body phase), then done.
portMessageHandler({ type: "delta", text: "<style>body{background:teal}" });
portMessageHandler({ type: "delta", text: "</style><h1>WELCOME</h1>" });
portMessageHandler({ type: "done", complete: true });

// A late message after settling must be ignored, not crash.
portMessageHandler({ type: "delta", text: "stray" });

// Fresh run: error path, then disconnect path.
window.__retroWeb.toggle(); // off (settled state)
window.__retroWeb.toggle(); // on again
portMessageHandler({ type: "error", message: "boom" });
window.__retroWeb.toggle(); // off
window.__retroWeb.toggle(); // on
portDisconnectHandler();

console.log("PASS: startup, delta/done, late-message, error, and disconnect paths all ran");
process.exit(0);
