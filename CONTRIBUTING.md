# Contributing

Thanks for stopping by the Information Superhighway. PRs welcome.

## Dev setup

There is no build step, and that's on purpose — vanilla JS, load-and-go:

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. After editing, hit ↻ on the extension card and re-test.

## Before sending a PR

```sh
# syntax-check every JS file
for f in src/*.js scripts/*.js; do node --check "$f"; done

# runtime smoke test (drives the content script's streaming protocol
# against stubbed DOM/chrome APIs)
node scripts/smoke-test.js
```

CI runs the same checks.

## Ground rules

- **No build tooling, no frameworks, no dependencies.** Part of the bit, and
  it keeps "Load unpacked" working with zero setup.
- **Security model:** generated HTML must only ever render inside the
  sandboxed iframe (no `allow-scripts`). Don't add code paths that put model
  output into the host page's DOM.
- The model never executes scripts in generated pages — animation is
  CSS/`<marquee>` only. Keep it that way.
- New retro features (themes, cursor trails, MIDI) are very welcome. See
  [PLAN.md](PLAN.md) for the roadmap.
