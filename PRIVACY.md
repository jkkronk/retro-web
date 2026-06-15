# Privacy Policy — Retro Web

_Last updated: 2026-06-15_

Retro Web is a Chrome extension that rebuilds the web page you are viewing as a
1990s-style website using the Anthropic (Claude) API. You bring your own API
key; there is no middleman server operated by this project.

## What data the extension handles

- **Page content.** When you explicitly retro-fy a page (by clicking the
  extension) or follow a link while in retro mode, the extension extracts the
  readable text content of that page — title, headings, paragraphs, image URLs,
  and links — and sends it to the Anthropic API to generate the retro version.
  The page's original markup and scripts are not sent.
- **Your Anthropic API key.** The key you enter in the extension's options is
  stored locally in `chrome.storage.local` on your own device.

## Where data is sent

- Page content and your API key are sent **only** to the Anthropic API at
  `https://api.anthropic.com`, directly from your browser, using your own key.
- Nothing is sent anywhere else. There is **no** telemetry, **no** analytics,
  and **no** third-party or developer-operated server. The project author never
  receives your API key or the pages you visit.
- Anthropic's handling of the data it receives is governed by Anthropic's own
  privacy policy and terms: https://www.anthropic.com/legal/privacy

## What is stored, and where

- **API key:** stored locally in `chrome.storage.local`. It never leaves your
  device except in requests to `api.anthropic.com`.
- **Generated pages:** cached locally per URL per model in
  `chrome.storage.local` so revisits are instant. This cache lives only on your
  device and is removed when you uninstall the extension or clear its storage.

## Data selling and sharing

This extension does **not** sell your data, does **not** share it with third
parties, and does **not** use it for any purpose beyond generating the retro
version of the page you requested.

## Permissions

- **`<all_urls>` host access:** required because retro mode follows links — after
  you click a link inside a retro page, the extension re-injects itself into the
  destination page. Chrome's `activeTab` grant is revoked on navigation, so
  standing host access is needed for this feature to work.
- **`webNavigation`:** used only to time injection in retro-mode tabs (paint the
  loading screen at navigation commit, start generation at DOMContentLoaded).
  Navigation events for tabs not in retro mode are ignored; nothing is
  collected, stored, or transmitted.
- **`storage`:** stores your API key and the local page cache described above.
- **`activeTab` / `scripting` / `offscreen`:** used to read the current page's
  content and render the generated retro page.

## Security

Generated HTML renders inside an iframe sandboxed without `allow-scripts`, so
model output cannot execute JavaScript regardless of its content, with an
additional sanitization pass as defense-in-depth. See
[SECURITY.md](SECURITY.md) for details.

## Contact

Questions or concerns: jonatan.kronander@synagen.ai, or open an issue on the
project's GitHub repository.
